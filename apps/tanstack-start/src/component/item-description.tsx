interface Segment {
  color?: string;
  text: string;
}

interface ParagraphBlock {
  type: "paragraph";
  lines: Segment[][];
}

interface ListBlock {
  type: "list";
  items: Segment[][];
}

interface StatsRow {
  label: Segment[];
  value: Segment[];
}

interface StatsBlock {
  type: "stats";
  rows: StatsRow[];
}

type ContentBlock = ParagraphBlock | ListBlock | StatsBlock;

interface ItemDescriptionProps {
  text: string;
}

const COLOR_TAG = /\|c([0-9A-Fa-f]{8})/g;
const RESET_TOKEN = "|r";

function parseSegments(line: string) {
  const sanitized = line.replace(/\|ni;|\|nd;/g, "");
  const segments: Segment[] = [];
  let activeColor: string | undefined;
  let buffer = "";
  let index = 0;

  const pushBuffer = () => {
    if (!buffer) return;
    segments.push({ color: activeColor, text: buffer });
    buffer = "";
  };

  while (index < sanitized.length) {
    if (sanitized.startsWith(RESET_TOKEN, index)) {
      pushBuffer();
      activeColor = undefined;
      index += RESET_TOKEN.length;
      continue;
    }

    COLOR_TAG.lastIndex = index;
    const colorMatch = COLOR_TAG.exec(sanitized);
    if (colorMatch?.index === index) {
      const argbHex = colorMatch[1];
      if (!argbHex) {
        index += colorMatch[0].length;
        continue;
      }
      pushBuffer();
      activeColor = `#${argbHex.slice(2)}`;
      index += colorMatch[0].length;
      continue;
    }

    buffer += sanitized[index] ?? "";
    index += 1;
  }

  pushBuffer();

  return segments.filter((segment) => segment.text.length > 0);
}

function renderSegments(segments: Segment[]) {
  return segments.map((segment, index) => (
    <span
      key={index}
      style={segment.color ? { color: segment.color } : undefined}
      className={segment.color ? "font-medium" : undefined}
    >
      {segment.text}
    </span>
  ));
}

function hasVisibleText(segments: Segment[]) {
  return segments.some((segment) => segment.text.trim().length > 0);
}

function splitStatLine(segments: Segment[]) {
  const colonIndex = segments.findIndex((segment) =>
    segment.text.includes(":"),
  );
  if (colonIndex === -1) return null;

  const before = segments.slice(0, colonIndex);
  const target = segments[colonIndex];
  if (!target) return null;

  const [rawLabelPart, ...valueParts] = target.text.split(":");
  const labelPart = rawLabelPart ?? "";
  const labelSegments = [...before];

  if (labelPart.trim()) {
    labelSegments.push({ color: target.color, text: labelPart });
  }

  const valueSegments: Segment[] = [];
  const firstValuePart = valueParts.join(":");

  if (firstValuePart.trim()) {
    valueSegments.push({
      color: target.color,
      text: firstValuePart.trimStart(),
    });
  }

  valueSegments.push(...segments.slice(colonIndex + 1));

  if (!hasVisibleText(labelSegments) || !hasVisibleText(valueSegments)) {
    return null;
  }

  return { label: labelSegments, value: valueSegments };
}

function buildBlocks(text: string) {
  const lines = text.split(RESET_TOKEN).map((line) => line.trim());
  const blocks: ContentBlock[] = [];
  let paragraphBuffer: Segment[][] = [];
  let listBuffer: Segment[][] = [];
  let statsBuffer: StatsRow[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    blocks.push({ type: "paragraph", lines: paragraphBuffer });
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push({ type: "list", items: listBuffer });
    listBuffer = [];
  };

  const flushStats = () => {
    if (statsBuffer.length === 0) return;
    blocks.push({ type: "stats", rows: statsBuffer });
    statsBuffer = [];
  };

  for (const rawLine of lines) {
    if (!rawLine) {
      flushParagraph();
      flushList();
      flushStats();
      continue;
    }

    const listMatch = /^-\s+(.*)$/.exec(rawLine);
    if (listMatch) {
      flushParagraph();
      flushStats();
      listBuffer.push(parseSegments(listMatch[1] ?? ""));
      continue;
    }

    const segments = parseSegments(rawLine);
    const statRow = splitStatLine(segments);

    if (statRow) {
      flushParagraph();
      flushList();
      statsBuffer.push(statRow);
      continue;
    }

    flushList();
    flushStats();
    paragraphBuffer.push(segments);
  }

  flushParagraph();
  flushList();
  flushStats();

  return blocks;
}

export function ItemDescription({ text }: ItemDescriptionProps) {
  const blocks = buildBlocks(text);

  return (
    <div className="text-muted-foreground flex flex-col gap-3 text-sm leading-6">
      {blocks.map((block, index) => {
        if (block.type === "paragraph") {
          return (
            <div key={index} className="flex flex-col gap-2">
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex}>{renderSegments(line)}</p>
              ))}
            </div>
          );
        }

        if (block.type === "list") {
          return (
            <ul
              key={index}
              className="marker:text-foreground/60 list-disc space-y-1 pl-5"
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderSegments(item)}</li>
              ))}
            </ul>
          );
        }

        return (
          <div
            key={index}
            className="bg-muted/35 divide-border/60 grid gap-2 rounded-lg border px-4 py-3"
          >
            {block.rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="grid gap-1 border-b border-inherit pb-2 last:border-b-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
              >
                <span>{renderSegments(row.label)}</span>
                <span className="text-foreground sm:text-right">
                  {renderSegments(row.value)}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
