const MAX_DURATION_SECONDS = 14 * 24 * 60 * 60;

const UNIT_SECONDS = {
  d: 24 * 60 * 60,
  h: 60 * 60,
  m: 60,
  s: 1,
} as const;

export type DurationUnit = keyof typeof UNIT_SECONDS;

export function parseDurationSeconds(input: string) {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const matches = Array.from(normalized.matchAll(/(\d+)\s*([dhms])/g));
  if (matches.length === 0) return null;

  const consumed = matches.map((match) => match[0]).join(" ");
  if (consumed.replaceAll(/\s+/g, "") !== normalized.replaceAll(/\s+/g, "")) {
    return null;
  }

  let total = 0;
  for (const match of matches) {
    const rawValue = match[1];
    const rawUnit = match[2] as DurationUnit | undefined;
    if (!rawValue || !rawUnit) return null;

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value <= 0) return null;
    total += value * UNIT_SECONDS[rawUnit];
  }

  if (total <= 0 || total > MAX_DURATION_SECONDS) return null;
  return total;
}

export function formatDuration(totalSeconds: number) {
  let remaining = Math.max(0, Math.floor(totalSeconds));
  const parts: string[] = [];

  for (const unit of ["d", "h", "m", "s"] as const) {
    const unitSeconds = UNIT_SECONDS[unit];
    const value = Math.floor(remaining / unitSeconds);
    if (value === 0) continue;
    parts.push(`${value}${unit}`);
    remaining -= value * unitSeconds;
  }

  return parts.length > 0 ? parts.join(" ") : "0s";
}
