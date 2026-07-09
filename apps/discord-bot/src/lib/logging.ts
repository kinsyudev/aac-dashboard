export interface BotLogger {
  debug(message: string): unknown;
  info(message: string): unknown;
  warn(message: string): unknown;
  error(message: string): unknown;
}

export interface InteractionLogContext {
  interactionType: "chat_input" | "autocomplete" | "button";
  commandName: string;
  guildId: string | null;
  channelId: string | null;
  userId: string | null;
  options?: Record<string, unknown>;
}

export interface InteractionFinishInput extends InteractionLogContext {
  outcome: "ok" | "user_error" | "system_error";
  durationMs: number;
  result?: Record<string, unknown>;
}

export interface InteractionErrorInput extends InteractionLogContext {
  durationMs: number;
  error: unknown;
}

export interface SchedulerLogInput {
  event:
    | "scheduler_failed"
    | "scheduler_started"
    | "scheduler_poll"
    | "notification_delivered"
    | "notification_failed"
    | "notification_give_up";
  timerId?: string;
  notificationId?: string;
  notificationKind?: string;
  guildId?: string;
  channelId?: string | null;
  attemptCount?: number;
  durationMs?: number;
  dueCount?: number;
  error?: unknown;
}

function describeUnknown(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") {
    return value.description ?? value.toString();
  }
  if (typeof value === "function") {
    return value.name.length > 0 ? value.name : "anonymous";
  }

  return null;
}

function normalizeOptionValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeOptionValue);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") {
      return record.id;
    }

    const normalizedEntries = Object.entries(record)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, normalizeOptionValue(nestedValue)] as const);

    return Object.fromEntries(normalizedEntries);
  }

  return describeUnknown(value);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack:
        process.env.NODE_ENV === "production"
          ? error.stack?.split("\n").slice(0, 3).join("\n") ?? null
          : error.stack ?? null,
    };
  }

  return {
    name: "NonError",
    message: describeUnknown(error) ?? "Unserializable non-error value",
    stack: null,
  };
}

function createBaseEntry(input: InteractionLogContext) {
  return {
    interactionType: input.interactionType,
    commandName: input.commandName,
    guildId: input.guildId,
    channelId: input.channelId,
    userId: input.userId,
    options:
      input.options == null ? undefined : normalizeOptionValue(input.options),
  };
}

function emit(logger: BotLogger, level: keyof BotLogger, payload: Record<string, unknown>) {
  logger[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

export function logInteractionStart(logger: BotLogger, input: InteractionLogContext) {
  emit(logger, "info", {
    event: "interaction_started",
    ...createBaseEntry(input),
  });
}

export function logInteractionFinish(logger: BotLogger, input: InteractionFinishInput) {
  emit(logger, input.outcome === "ok" ? "info" : "warn", {
    event: "interaction_finished",
    ...createBaseEntry(input),
    outcome: input.outcome,
    durationMs: input.durationMs,
    result: input.result == null ? undefined : normalizeOptionValue(input.result),
  });
}

export function logInteractionError(logger: BotLogger, input: InteractionErrorInput) {
  emit(logger, "error", {
    event: "interaction_failed",
    ...createBaseEntry(input),
    durationMs: input.durationMs,
    error: serializeError(input.error),
  });
}

export function logSchedulerEvent(logger: BotLogger, input: SchedulerLogInput) {
  const level =
    input.event === "scheduler_failed" ||
    input.event === "notification_failed" ||
    input.event === "notification_give_up"
      ? "warn"
      : "info";

  emit(logger, level, {
    event: input.event,
    timerId: input.timerId,
    notificationId: input.notificationId,
    notificationKind: input.notificationKind,
    guildId: input.guildId,
    channelId: input.channelId,
    attemptCount: input.attemptCount,
    dueCount: input.dueCount,
    durationMs: input.durationMs,
    error: input.error == null ? undefined : serializeError(input.error),
  });
}
