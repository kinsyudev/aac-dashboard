import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { asc } from "@acme/db";
import { db } from "@acme/db/client";
import { crafts, items } from "@acme/db/schema";

const STATIC_API_CACHE_DIR = "/tmp/aac-dashboard-static-api";
const FALLBACK_CACHE_TTL_MS = 5 * 60 * 1000;
const UNSUPPORTED_CRAFT_NAME_PREFIXES = ["trash_"];

type StaticPayloadName = "items-all" | "crafts-all";

interface CacheEntry {
  body: string;
  etag: string;
  lastModified: string;
  mtimeMs: number;
  size: number;
}

const payloadCache = new Map<StaticPayloadName, CacheEntry>();
const payloadLoaders = {
  "items-all": async () =>
    db.select().from(items).orderBy(asc(items.category), asc(items.name)),
  "crafts-all": async () =>
    db.select().from(crafts).then((rows) =>
      rows.filter((craft) => {
        const normalized = craft.name.trim().toLowerCase();
        return !UNSUPPORTED_CRAFT_NAME_PREFIXES.some((prefix) =>
          normalized.startsWith(prefix),
        );
      }),
    ),
} satisfies Record<StaticPayloadName, () => Promise<unknown>>;

function createCacheEntry(
  name: StaticPayloadName,
  body: string,
  lastModifiedAt: Date,
): CacheEntry {
  const size = Buffer.byteLength(body, "utf8");
  const hash = createHash("sha1").update(name).update(body).digest("base64url");

  return {
    body,
    etag: `W/"${size}-${hash}"`,
    lastModified: lastModifiedAt.toUTCString(),
    mtimeMs: lastModifiedAt.getTime(),
    size,
  };
}

async function loadPayloadFromDb(name: StaticPayloadName): Promise<CacheEntry> {
  const cached = payloadCache.get(name);

  if (cached && Date.now() - cached.mtimeMs < FALLBACK_CACHE_TTL_MS) {
    return cached;
  }

  const body = JSON.stringify(await payloadLoaders[name]());
  const entry = createCacheEntry(name, body, new Date());

  payloadCache.set(name, entry);
  return entry;
}

async function loadPayload(name: StaticPayloadName): Promise<CacheEntry> {
  const path = `${STATIC_API_CACHE_DIR}/${name}.json`;
  try {
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
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return loadPayloadFromDb(name);
    }

    throw error;
  }
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
        error:
          "Static API payload unavailable. Build the cache or check database connectivity.",
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
