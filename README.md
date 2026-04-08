# aac-dashboard

A dashboard for ArcheAge Classic — tracks item prices and crafting recipes.

## Stack

- **[Turborepo](https://turborepo.com)** — monorepo build system
- **[TanStack Start](https://tanstack.com/start)** — web app (React 19, Tailwind v4)
- **[tRPC v11](https://trpc.io)** — end-to-end typesafe API
- **[Drizzle ORM](https://orm.drizzle.team)** + **[Supabase](https://supabase.com)** — database
- **[Better Auth](https://www.better-auth.com)** — authentication (Discord OAuth)

## Structure

```
apps
  ├─ tanstack-start   Web app
  └─ sync             Data sync scripts
packages
  ├─ api              tRPC router
  ├─ auth             Better Auth configuration
  ├─ db               Drizzle schema & client
  └─ ui               Shared UI components (shadcn)
tooling
  ├─ eslint
  ├─ prettier
  ├─ tailwind
  └─ typescript
```

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Fill in the required values:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string |
| `AUTH_SECRET` | Random secret — generate with `openssl rand -base64 32` |
| `AUTH_DISCORD_ID` | Discord OAuth app client ID |
| `AUTH_DISCORD_SECRET` | Discord OAuth app client secret |
| `AAC_AUTH` | Auth JWT for aa-classic.com API (required for item sync) |

### 3. Push database schema

```bash
pnpm db:push
```

### 4. Generate Better Auth schema

```bash
pnpm --filter @acme/auth generate
```

This reads `packages/auth/script/auth-cli.ts` and outputs the auth tables schema to `packages/db/src/auth-schema.ts`.

### 5. Sync game data

Populate the database with items, crafts, and prices:

```bash
# Sync items, crafts, products & materials from aa-classic.com
pnpm --filter @acme/sync sync-items

# Sync prices from the Google Spreadsheet
pnpm --filter @acme/sync sync-prices
```

Both scripts are incremental — they skip rows already in the database and can be safely re-run. To do a full re-sync from scratch:

```bash
pnpm --filter @acme/sync sync-items:full-refresh
```

## Authentication

This project uses [Better Auth](https://www.better-auth.com) with Discord OAuth. Access is restricted to an allowlist of Discord user IDs configured in `packages/auth`.

To add or remove users, update the allowlist in the auth configuration.

For more on the Better Auth CLI, see the [official docs](https://www.better-auth.com/docs/concepts/cli#generate).
