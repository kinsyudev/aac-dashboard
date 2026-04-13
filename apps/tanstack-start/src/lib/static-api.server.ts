import { readFile, stat } from "node:fs/promises";

const STATIC_API_CACHE_DIR = "/tmp/aac-dashboard-static-api";

type StaticPayloadName = "items-all" | "crafts-all";

interface CacheEntry {
  body: string;
  etag: string;
  lastModified: string;
  mtimeMs: number;
  size: number;
}

const payloadCache = new Map<StaticPayloadName, CacheEntry>();

async function loadPayload(name: StaticPayloadName): Promise<CacheEntry> {
  const path = `${STATIC_API_CACHE_DIR}/${name}.json`;
  const fileStat = await stat(path);
  const cached = payloadCache.get(name);

  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    return cached;
  }

  const body = await readFile(path, "utf8");
  const entry = {
    body,
    etag: `W/"${fileStat.size}-${Math.floor(fileStat.mtimeMs)}"`,
    lastModified: fileStat.mtime.toUTCString(),
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
  };

  payloadCache.set(name, entry);
  return entry;
}

export async function createStaticApiResponse(
  request: Request,
  name: StaticPayloadName,
) {
  try {
    const payload = await loadPayload(name);

    if (request.headers.get("if-none-match") === payload.etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: payload.etag,
          "Cache-Control": "private, max-age=300, stale-while-revalidate=86400",
          Vary: "Cookie",
        },
      });
    }

    return new Response(payload.body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": payload.size.toString(),
        "Cache-Control": "private, max-age=300, stale-while-revalidate=86400",
        ETag: payload.etag,
        "Last-Modified": payload.lastModified,
        Vary: "Cookie",
      },
    });
  } catch (error) {
    console.error(`Failed to load static API payload '${name}'`, error);
    return new Response(
      JSON.stringify({
        error: "Static API cache missing. Run the sync cache builder first.",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
