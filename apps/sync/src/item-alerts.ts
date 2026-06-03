import { eq, getTableColumns, sql } from "@acme/db";
import type { db as appDb } from "@acme/db/client";
import {
  discordItemAlertDestinations,
  itemAlertDeliveries,
  itemDiscoveries,
  items,
} from "@acme/db/schema";

const DISCORD_API_BASE_URL = "https://discord.com/api/v10";
const DASHBOARD_BASE_URL = "https://aac.kinsyu.dev";
const AA_CLASSIC_BASE_URL = "https://aa-classic.com";

export interface AlertItem {
  id: number;
  name: string;
  category: string;
  level: number;
  icon: string | null;
  maxStackSize: number;
}

export interface AlertDestination {
  id: string;
  name: string;
  channelId: string;
  enabled: boolean;
  createdAt: Date;
}

export interface AlertDiscovery {
  item: AlertItem;
  discoveredAt: Date;
}

export interface AlertDelivery {
  itemId: number;
  destinationId: string;
  sentAt: Date | null;
}

export interface PendingItemAlertDelivery {
  item: AlertItem;
  discoveredAt: Date;
  destination: AlertDestination;
}

interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  thumbnail?: { url: string };
  fields: { name: string; value: string; inline: boolean }[];
}

interface DiscordMessagePayload {
  embeds: DiscordEmbed[];
}

interface RecordAttemptInput {
  itemId: number;
  destinationId: string;
  attemptedAt: Date;
  success: boolean;
  discordMessageId?: string;
  error?: string;
}

interface SendPendingItemAlertsInput {
  botToken: string;
  deliveries: PendingItemAlertDelivery[];
  fetch?: typeof fetch;
  now?: () => Date;
  recordAttempt: (event: RecordAttemptInput) => Promise<void>;
}

export function getPendingItemAlertDeliveries({
  deliveries,
  destinations,
  discoveries,
}: {
  deliveries: AlertDelivery[];
  destinations: AlertDestination[];
  discoveries: AlertDiscovery[];
}) {
  const sent = new Set(
    deliveries
      .filter((delivery) => delivery.sentAt != null)
      .map((delivery) => `${delivery.itemId}:${delivery.destinationId}`),
  );

  return discoveries.flatMap((discovery) =>
    destinations
      .filter(
        (destination) =>
          destination.enabled && destination.createdAt <= discovery.discoveredAt,
      )
      .filter(
        (destination) =>
          !sent.has(`${discovery.item.id}:${destination.id}`),
      )
      .map((destination) => ({
        item: discovery.item,
        discoveredAt: discovery.discoveredAt,
        destination,
      })),
  );
}

export function buildDiscordItemMessage(
  item: AlertItem,
): DiscordMessagePayload {
  const dashboardUrl = `${DASHBOARD_BASE_URL}/item/${item.id}`;
  const aaClassicUrl = `${AA_CLASSIC_BASE_URL}/database/items/${item.id}`;
  const thumbnail = item.icon
    ? { url: `${AA_CLASSIC_BASE_URL}/game/icons/${item.icon}` }
    : undefined;

  return {
    embeds: [
      {
        title: `New item: ${item.name}`,
        url: dashboardUrl,
        color: 0x3b82f6,
        ...(thumbnail ? { thumbnail } : {}),
        fields: [
          { name: "ID", value: String(item.id), inline: true },
          { name: "Category", value: item.category, inline: true },
          { name: "Level", value: String(item.level), inline: true },
          {
            name: "Max stack",
            value: String(item.maxStackSize),
            inline: true,
          },
          {
            name: "Links",
            value: `[Dashboard](${dashboardUrl}) | [AA Classic DB](${aaClassicUrl})`,
            inline: false,
          },
        ],
      },
    ],
  };
}

export async function sendPendingItemAlerts({
  botToken,
  deliveries,
  fetch: fetchImpl = fetch,
  now = () => new Date(),
  recordAttempt,
}: SendPendingItemAlertsInput) {
  for (const delivery of deliveries) {
    const attemptedAt = now();
    try {
      const response = await fetchImpl(
        `${DISCORD_API_BASE_URL}/channels/${delivery.destination.channelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildDiscordItemMessage(delivery.item)),
        },
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Discord HTTP ${response.status}: ${body}`);
      }

      const body = (await response.json()) as { id?: unknown };
      await recordAttempt({
        itemId: delivery.item.id,
        destinationId: delivery.destination.id,
        attemptedAt,
        success: true,
        discordMessageId:
          typeof body.id === "string" ? body.id : undefined,
      });
    } catch (error) {
      await recordAttempt({
        itemId: delivery.item.id,
        destinationId: delivery.destination.id,
        attemptedAt,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function recordItemDiscoveries(
  database: typeof appDb,
  discoveredItems: AlertItem[],
  discoveredAt = new Date(),
) {
  if (discoveredItems.length === 0) return;

  await database
    .insert(itemDiscoveries)
    .values(
      discoveredItems.map((item) => ({
        itemId: item.id,
        discoveredAt,
      })),
    )
    .onConflictDoNothing();
}

export async function sendItemDiscoveryAlerts({
  botToken,
  database,
}: {
  botToken: string;
  database: typeof appDb;
}) {
  const [destinationRows, discoveryRows, deliveryRows] = await Promise.all([
    database
      .select({
        id: discordItemAlertDestinations.id,
        name: discordItemAlertDestinations.name,
        channelId: discordItemAlertDestinations.channelId,
        enabled: discordItemAlertDestinations.enabled,
        createdAt: discordItemAlertDestinations.createdAt,
      })
      .from(discordItemAlertDestinations)
      .where(eq(discordItemAlertDestinations.enabled, true)),
    database
      .select({
        item: getTableColumns(items),
        discoveredAt: itemDiscoveries.discoveredAt,
      })
      .from(itemDiscoveries)
      .innerJoin(items, eq(items.id, itemDiscoveries.itemId)),
    database
      .select({
        itemId: itemAlertDeliveries.itemId,
        destinationId: itemAlertDeliveries.destinationId,
        sentAt: itemAlertDeliveries.sentAt,
      })
      .from(itemAlertDeliveries),
  ]);

  const pending = getPendingItemAlertDeliveries({
    destinations: destinationRows,
    deliveries: deliveryRows,
    discoveries: discoveryRows,
  });

  if (pending.length === 0) {
    console.log("No pending item Discord alerts.");
    return;
  }

  await sendPendingItemAlerts({
    botToken,
    deliveries: pending,
    recordAttempt: (event) => recordDeliveryAttempt(database, event),
  });
}

async function recordDeliveryAttempt(
  database: typeof appDb,
  event: RecordAttemptInput,
) {
  await database
    .insert(itemAlertDeliveries)
    .values({
      itemId: event.itemId,
      destinationId: event.destinationId,
      attemptCount: 1,
      lastAttemptAt: event.attemptedAt,
      lastError: event.success ? null : (event.error ?? "Unknown error"),
      sentAt: event.success ? event.attemptedAt : null,
      discordMessageId: event.success
        ? (event.discordMessageId ?? null)
        : null,
    })
    .onConflictDoUpdate({
      target: [
        itemAlertDeliveries.itemId,
        itemAlertDeliveries.destinationId,
      ],
      set: {
        attemptCount: sql`${itemAlertDeliveries.attemptCount} + 1`,
        lastAttemptAt: event.attemptedAt,
        lastError: event.success ? null : (event.error ?? "Unknown error"),
        sentAt: event.success ? event.attemptedAt : null,
        discordMessageId: event.success
          ? (event.discordMessageId ?? null)
          : null,
      },
    });
}
