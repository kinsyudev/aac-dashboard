export interface DescriptionSegment {
  color?: string;
  text: string;
}

export type DescriptionBlock =
  | { type: "paragraph"; lines: DescriptionSegment[][] }
  | { type: "list"; items: DescriptionSegment[][] }
  | {
      type: "stats";
      rows: { label: DescriptionSegment[]; value: DescriptionSegment[] }[];
    };

const COLOR_TAG = /\|c([0-9A-Fa-f]{8})/g;
const RESET_TOKEN = "|r";

function parseSegments(line: string): DescriptionSegment[] {
  const sanitized = line.replace(/\|ni;|\|nd;|\|n[ci];\d/g, "");
  const segments: DescriptionSegment[] = [];
  let color: string | undefined;
  let buffer = "";
  const push = () => {
    if (buffer) segments.push({ color, text: buffer });
    buffer = "";
  };
  for (let index = 0; index < sanitized.length; ) {
    if (sanitized.startsWith(RESET_TOKEN, index)) {
      push();
      color = undefined;
      index += RESET_TOKEN.length;
      continue;
    }
    COLOR_TAG.lastIndex = index;
    const match = COLOR_TAG.exec(sanitized);
    if (match?.index === index && match[1]) {
      push();
      color = `#${match[1].slice(2)}`;
      index += match[0].length;
      continue;
    }
    buffer += sanitized[index] ?? "";
    index += 1;
  }
  push();
  return segments;
}

function splitStatLine(segments: DescriptionSegment[]) {
  const index = segments.findIndex((segment) => segment.text.includes(":"));
  if (index < 0) return null;
  const target = segments[index];
  if (!target) return null;
  const [labelText, ...valueParts] = target.text.split(":");
  const label = [...segments.slice(0, index)];
  if (labelText?.trim()) label.push({ color: target.color, text: labelText });
  const value = valueParts.join(":").trimStart();
  const valueSegments: DescriptionSegment[] = value
    ? [{ color: target.color, text: value }]
    : [];
  valueSegments.push(...segments.slice(index + 1));
  return label.some((part) => part.text.trim()) &&
    valueSegments.some((part) => part.text.trim())
    ? { label, value: valueSegments }
    : null;
}

export function buildItemDescriptionBlocks(text: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let paragraphs: DescriptionSegment[][] = [];
  let list: DescriptionSegment[][] = [];
  let stats: { label: DescriptionSegment[]; value: DescriptionSegment[] }[] =
    [];
  const flush = () => {
    if (paragraphs.length)
      blocks.push({ type: "paragraph", lines: paragraphs });
    if (list.length) blocks.push({ type: "list", items: list });
    if (stats.length) blocks.push({ type: "stats", rows: stats });
    paragraphs = [];
    list = [];
    stats = [];
  };
  for (const line of text.split(/\r?\n/).map((part) => part.trim())) {
    if (!line) {
      flush();
      continue;
    }
    const listMatch = /^-\s+(.*)$/.exec(line);
    if (listMatch) {
      if (paragraphs.length || stats.length) flush();
      list.push(parseSegments(listMatch[1] ?? ""));
      continue;
    }
    const segments = parseSegments(line);
    const stat = splitStatLine(segments);
    if (stat) {
      if (paragraphs.length || list.length) flush();
      stats.push(stat);
      continue;
    }
    if (list.length || stats.length) flush();
    paragraphs.push(segments);
  }
  flush();
  return blocks;
}
