# Discord bot across multiple servers

Status: Draft — proposed scope; product choices remain open
Date: 2026-09-06

## Outcome

A Discord server administrator can install the centrally hosted AAC farm bot, configure where reminders are allowed, and let Players use the existing Farm and Farm Timer tools. Each server has independent data and configuration. Adding a server requires no separate deployment, database, bot token, or AAC Dashboard Account.

“Shared amongst multiple servers” means sharing the bot service. Farms, Farm Timers, and personal settings remain separate in each server, including for the same Discord Identity. No implementation or Discord configuration has been changed as part of this scoping exercise.

## Proposed first release

- One hosted Discord application and worker, using the existing database and shared Game Data.
- Access is restricted to server IDs explicitly approved by the operator. If the bot joins an unapproved server, it refuses commands and immediately leaves.
- Existing farming commands and management interactions available in each enabled server.
- Farms, Farm Timers, crop overrides, and personal preferences remain server-specific and owner-specific. The same Discord Identity can have a Farm named `main` in two servers without either affecting the other.
- A server administrator controls setup, allowed reminder destinations, and permitted role mentions. Players continue to manage only their own Farms and Farm Timers.
- Discord-native use remains independent of website access. Installing the bot grants no AAC Dashboard permissions.

Restricted distribution, allowlist enforcement, separate data per server, owner-only management, administrator-controlled reminder channels, and reminder audiences are confirmed. The other first-release choices remain recommendations until resolved in the interview.

## Confirmed decisions

- Only specific, explicitly approved servers may use the bot. Unrestricted public distribution is outside the intended scope.
- Enforce approval through an allowlist of Discord server IDs. Briefly joining an unapproved server is acceptable: the bot must refuse commands and immediately leave. This permits installation by other server administrators. Where the operator maintains the allowlist remains open.
- Farms, Farm Timers, crop overrides, and personal settings remain separate in each server, even for the same Discord Identity. A timer created in server A is managed and announced only in A; no cross-server sharing or synchronization is included.
- Only the owning Player can manage their Farms and Farm Timers, including editing, deleting, canceling, and Replant. Server administrator permissions do not grant management rights over another Player's entries. Server configuration and operator lifecycle procedures are separate from Player management rights.
- Each server administrator selects the allowed reminder channels and one default channel from that set. Players may choose any allowed destination for their Farms and Farm Timers, subject to their own channel permissions. A server can start with just one allowed channel.
- Ready reminders ping the planting Player by default. Players may instead choose a role from an administrator-approved list. Advance reminders always ping only the planting Player. The precedence of explicit and saved role choices remains to be finalized.

## Current implementation and gaps

| Area | Evidence in the repository | Implication |
| --- | --- | --- |
| Data ownership | `packages/db/src/bot-schema.ts` keys preferences by server and Discord Identity, and stores server and owner IDs on Farms and Farm Timers. | Reuse the existing ownership model; a database per server is unnecessary for this proposal. |
| Management | `apps/discord-bot/src/lib/management.ts` scopes Farm and Farm Timer lookups by server and owner. | Extend this invariant to every entry point. |
| Replant | `apps/discord-bot/src/interaction-handlers/replant.ts` loads the original timer by ID and checks its owner, but not its server; it copies saved destination and Farm IDs. | Require server and owner checks before reading or copying the original. This is a missing invariant, not a demonstrated cross-server exploit. |
| Destinations | `/plant` and Farm defaults accept channel/role choices; `lib/scheduler.ts` fetches a saved channel and checks only whether it is sendable. | Validate server membership, permitted use, and effective channel permissions at creation and delivery. |
| Installation and commands | Commands call Sapphire registration without a guild-specific override. `AAC_DISCORD_GUILD_ID` is declared but unused outside env tests. No join/remove handlers or server settings table were found. | Verify deployed command registration and add deliberate production/development registration, installation, and lifecycle handling. Current Developer Portal settings were not inspected. |
| Scheduling | `lib/scheduler.ts` selects the oldest 25 notifications globally every 60 seconds, sends sequentially, and retries up to five times. Its overlap guard is process-local. | A burst in one server can delay another. Deployment overlap can duplicate sends. |
| Persistence | `lib/timers.ts` inserts a timer and its notifications separately. | Make reminder creation atomic so a database failure cannot leave a timer with no scheduled delivery. |
| Account access | `lib/identity.ts` optionally links a Discord Identity to an Account; website auth uses a configured Discord server and role in `packages/auth` and `apps/tanstack-start/src/auth/server.ts`. | Preserve optional linking and the separate website authorization boundary. |
| Tests | `lib/scheduler.test.ts` currently covers only the retry-count helper. | Add behavioral coverage of scheduling and server isolation before rollout. |

## Requirements for the pilot

### 1. Installation and activation

- Provide a documented install link and a short administrator guide. Server administrators must not need the bot token or repository access.
- Configure Guild Install with `bot` and `applications.commands` scopes. Discord requires the installing member to have Manage Server permission. A private bot setting allows only the application owner to install it; an approved-server pilot with external installers therefore needs an explicit admission mechanism. [Discord application documentation](https://docs.discord.com/developers/resources/application)
- Request only the permissions needed for supported channels and messages: initially View Channel, Send Messages, and Embed Links. Keep the existing Guilds intent unless a concrete feature needs more. Do not request Administrator or blanket mention permissions.
- Make commands explicitly available in server contexts, with a tested production registration path and an isolated development path. Resolve the misleading unused `AAC_DISCORD_GUILD_ID` setting. [Discord command contexts and registration](https://docs.discord.com/developers/interactions/application-commands)
- An unapproved server cannot invoke commands, autocomplete, buttons, or modals or receive scheduled reminders. On joining it, the bot immediately leaves; startup reconciliation also removes unapproved memberships.
- An approved but unconfigured server receives an actionable setup message and cannot create timers or bypass activation through old buttons or modals.

Acceptance: an administrator of a second approved server installs and activates the bot without a code change, deployment, or dashboard login. The original server continues working.

### 2. Server configuration and permissions

- Add persistent configuration keyed by Discord server ID, separate from Player preferences. Track admission/activation state, default reminder channel, allowed reminder channels, allowed ping roles, setup actor, and update time.
- Require the server's default reminder channel to be in its allowed channel set. Player-selected Farm and Farm Timer destinations must also be in that set; channel configuration does not grant access the Player lacks in Discord.
- Provide setup, configuration inspection, and a diagnostic/test reminder flow. Configuration changes require the invoking member's current Manage Server permission, checked on the server side for commands and subsequent interactions.
- Proposed delivery-channel precedence: explicit selection, Farm default, personal default, server default, invoking channel. Every candidate must satisfy server policy. An invalid explicit or saved selection produces an actionable error rather than silently posting elsewhere.
- Proposed ready-mention policy: explicit role, Farm default role, personal default role, then the planting Player. Role choices must be allowed by server configuration. Advance reminders continue to mention only the planting Player.
- Start with ordinary server text channels; define and enforce behavior when a command is invoked in a thread, forum, or other unsupported channel.
- Ensure the Player can use the selected destination as well as the bot. Resolve channel overwrites and bot permissions, rather than relying only on permissions granted during installation. [Discord permissions](https://docs.discord.com/developers/topics/permissions)
- Check role existence, server ownership, server allowlist, and whether the bot can actually mention it. Restrict outgoing `allowedMentions` to the intended target; never allow `@everyone`, `@here`, or arbitrary content to expand the notification audience.

Acceptance: a regular member cannot change server settings, use the bot to post into an unauthorized channel, or choose a disallowed role. Setup diagnostics identify missing permissions precisely.

### 3. Data and interaction isolation

- Enforce current server ID and owner Discord Identity on all Farm and Farm Timer reads and mutations, including autocomplete, cancel, edit, delete, Replant, component IDs, and modal submissions.
- Validate that related Farms, saved channels, and roles belong to the same server; validate Farm ownership before resolving crop overrides or attaching a Farm to a timer.
- At delivery time, verify the fetched destination's server against the timer's server and recheck current server policy. Never route a reminder across servers.
- Preserve private command responses. Reminders are visible to everyone with access to the configured destination channel; document that distinction.
- Optional Account linking must not widen access or join together server-specific records. No cross-server sharing, synchronization, or global personal settings are included.

Acceptance: tests use two servers, the same Discord Identity in both, and another Player. Identical Farm slugs remain independent; foreign record IDs and stale interaction state cannot read, mutate, copy, or deliver another server's data.

### 4. Reliable shared reminder delivery

- Persist timer creation and its notification schedule atomically.
- Claim delivery work so only one worker owns a notification at a time, including during rolling deployment. Either enforce a database-backed single scheduler or use recoverable per-notification claims; extra infrastructure is not required solely for the pilot.
- Define handling for a crash after Discord accepts a message but before delivery is recorded. Prevent routine duplicate sends and test crash recovery; do not promise exactly-once external delivery without a supported deduplication design.
- Process due work fairly across servers with bounded concurrency and capacity suitable for the agreed pilot load. Replace the fixed global 25-per-minute bottleneck.
- Distinguish transient failures from deleted channels, removed access, and invalid destinations. Use bounded retries with backoff, and respect Discord's rate-limit responses. [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits)
- After downtime, skip obsolete advance reminders when the ready time has already passed; send the ready reminder with lateness shown. Give Players an actionable failed/blocked delivery state.
- Recheck cancellation and current timer schedule when claiming delivery work. Define the remaining race once an external send has begun.

Acceptance: a burst in server A does not indefinitely delay server B; restarts preserve reminders; overlapping workers do not ordinarily send the same notification; permanent failures stop retrying; retries do not generate obsolete advance reminders. Set a delivery-latency target and test volume before implementation is considered ready.

### 5. Removal, changes, and data lifecycle

- Reconcile installed servers at startup and handle joins/removals. Distinguish temporary Discord unavailability from actual removal.
- On actual removal or operator suspension, disable server activity and stop pending sends. Reinstallation must not release a flood of old reminders.
- Revalidate destinations and roles when permissions or configuration change. Proposed behavior: pending timers keep their original destination; if it becomes invalid, mark delivery blocked rather than redirecting it automatically. Replant validates everything again.
- Publish the chosen retention and deletion behavior. The existing plan keeps timers indefinitely; multi-server rollout needs an explicit decision on history, removed-server data, screenshot references, and logs.
- Proposed pilot member-departure policy: timers remain owner-bound and continue according to server policy until canceled, expired, or the bot is removed. Automatic cancellation on member departure is a separate decision because it changes membership tracking requirements.
- Provide an operator procedure to suspend one server and delete its data without affecting other servers. Any administrator-triggered deletion flow must clearly describe its scope and require deliberate confirmation.

Acceptance: removing the bot from A stops A's sends and leaves B unaffected. Reinstallation behavior and retention are documented and tested, including temporary outages.

### 6. Limits and operations

- Set enforceable limits for active timers per Player per server, active timers per server, saved Farms, and timer-creation bursts. Select numeric defaults from expected pilot use; make limits visible in rejection messages.
- Apply limits to slash commands, management UI, and Replant, including concurrent requests.
- Retain useful server/timer correlation in logs and measure due backlog, oldest overdue notification, delivery failures, and worker health. Avoid logging free-text notes and screenshot URLs by default; current interaction logging can include options.
- Document deployment ownership, migrations, backup/recovery, token management, and the single-server suspension procedure.
- Backfill the original server's configuration and preserve existing data. Review its existing destinations and ping roles so the new policy has a deliberate migration rather than unexpectedly stopping reminders.

Acceptance: one server cannot consume unbounded scheduling capacity; operators can diagnose and suspend its activity without affecting others; rollout preserves existing timers and ownership.

## Public launch additions

After the pilot, unrestricted installation would add self-service onboarding, published support and data-deletion instructions, finalized retention, abuse reporting and suspension procedures, and capacity testing at the expected public load. Review current Discord distribution/verification requirements at that launch decision. Sharding is not proposed for the pilot; Discord requires it at 2,500 or more servers. [Discord Gateway documentation](https://docs.discord.com/developers/events/gateway)

## Outside this scope

- Shared ownership of Farms, shared timers, or cross-server announcements.
- Opening website access to every server, a web administration panel, or new dashboard Farm views.
- Personal installs, direct-message reminders, automatic member-departure cleanup, billing, white labeling, or separate deployments per server.
- Gameplay automation; this remains companion tooling consistent with `docs/adr/0001-no-in-game-automation.md`.

## Decisions needed to finalize

1. Allowlist administration: server-ID approval with immediate departure from unapproved servers is confirmed. Where should the operator maintain approvals, and what happens when an existing approval is revoked?
2. Reminder defaults: the permitted channels and audiences are confirmed. Finalize the precedence of explicit choices, Farm defaults, personal defaults, and the server default, including what happens when a saved destination or role becomes invalid.
3. Scale: expected number of servers, active Players, active timers, peak simultaneous reminders, and acceptable lateness? These determine quotas and the delivery acceptance target.
4. Lifecycle: how long to retain completed timers and removed-server data, what reinstallation restores, and whether member departure should cancel timers? Recommendation: stop sends on bot removal and require fresh activation; settle retention before rollout.

## Suggested implementation sequence

1. Confirm the product decisions and numeric operating targets above.
2. Close server/owner isolation gaps and add database-backed behavioral tests.
3. Implement server admission/configuration, permission validation, installation docs, and command registration.
4. Add atomic timer persistence, delivery ownership, fairness, retries, and lifecycle handling.
5. Add quotas, diagnostics, retention/deletion procedures, and migrate the existing server.
6. Run a two-server acceptance exercise, including concurrent load, permission revocation, removal, and worker restart, before expanding the pilot.

Implementation tickets should be created separately under `issues/` once the unresolved choices are settled. Repository inspection and official Discord documentation informed this draft; no live installation, database isolation test, or load test was performed during scoping.
