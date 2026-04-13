import type React from "react";

export function ItemDescription({ text }: { text: string }) {
  const lines = text
    .replace(/\|ni;/g, "")
    .replace(/\|nd;/g, "")
    .replace(/\|r/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: number) => {
    if (listBuffer.length === 0) return;

    elements.push(
      <ul key={key} className="list-disc pl-4">
        {listBuffer.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((line, index) => {
    if (!line) {
      flushList(index);
      return;
    }

    if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
      return;
    }

    flushList(index);
    elements.push(<p key={index}>{line}</p>);
  });

  flushList(lines.length);

  return (
    <div className="text-muted-foreground flex flex-col gap-1 text-sm">
      {elements}
    </div>
  );
}
