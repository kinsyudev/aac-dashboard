import { queryOptions } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import type { RouterOutputs } from "@acme/api";

import { getBaseUrl } from "~/lib/url";

type AllItemsOutput = RouterOutputs["items"]["all"];
type AllCraftsOutput = RouterOutputs["crafts"]["all"];

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Static API request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

const fetchItemsAll = createIsomorphicFn()
  .server(async () => {
    const headers = new Headers(getRequestHeaders());
    const response = await fetch(`${getBaseUrl()}/api/static/items-all`, {
      headers,
    });

    return parseJsonResponse<AllItemsOutput>(response);
  })
  .client(async () => {
    const response = await fetch("/api/static/items-all");
    return parseJsonResponse<AllItemsOutput>(response);
  });

export function itemsAllQueryOptions() {
  return queryOptions({
    queryKey: ["static-api", "items-all"],
    queryFn: () => fetchItemsAll(),
    staleTime: 5 * 60 * 1000,
  });
}

const fetchCraftsAll = createIsomorphicFn()
  .server(async () => {
    const headers = new Headers(getRequestHeaders());
    const response = await fetch(`${getBaseUrl()}/api/static/crafts-all`, {
      headers,
    });

    return parseJsonResponse<AllCraftsOutput>(response);
  })
  .client(async () => {
    const response = await fetch("/api/static/crafts-all");
    return parseJsonResponse<AllCraftsOutput>(response);
  });

export function craftsAllQueryOptions() {
  return queryOptions({
    queryKey: ["static-api", "crafts-all"],
    queryFn: () => fetchCraftsAll(),
    staleTime: 5 * 60 * 1000,
  });
}
