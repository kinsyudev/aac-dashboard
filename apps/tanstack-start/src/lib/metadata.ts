const APP_NAME = "AAC Dashboard";
const DEFAULT_DESCRIPTION =
  "ArcheAge Classic crafting, simulation, shared shopping lists, and profile tools.";

const MAX_DESCRIPTION_LENGTH = 160;

export function getAppName() {
  return APP_NAME;
}

export function getDefaultDescription() {
  return DEFAULT_DESCRIPTION;
}

export function buildPageTitle(...parts: (string | null | undefined)[]) {
  return [...parts.filter(Boolean), APP_NAME].join(" | ");
}

export function getItemIconUrl(icon: string | null | undefined) {
  return icon ? `https://aa-classic.com/game/icons/${icon}` : undefined;
}

export function normalizeMetaDescription(text: string | null | undefined) {
  if (!text) return undefined;

  const normalized = text
    .replace(/\|c[0-9A-Fa-f]{8}/g, "")
    .replace(/\|r/g, " ")
    .replace(/\|ni;|\|nd;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return undefined;
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized;

  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`;
}

export function buildMetaTags({
  description,
  image,
  title,
  type = "website",
}: {
  description: string;
  image?: string;
  title: string;
  type?: "article" | "website";
}) {
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: type },
    { property: "twitter:title", content: title },
    { property: "twitter:description", content: description },
    ...(image
      ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
}
