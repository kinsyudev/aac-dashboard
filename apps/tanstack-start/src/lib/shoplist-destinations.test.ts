import assert from "node:assert/strict";
import { test } from "node:test";

import { getAppendableShoplistDestinations } from "./shoplist-destinations.ts";

type TestList = Parameters<
  typeof getAppendableShoplistDestinations
>[0]["owned"][number];
type TestSharedList = Parameters<
  typeof getAppendableShoplistDestinations
>[0]["shared"][number];

function ownedList(
  overrides: Partial<{
    id: string;
    name: string;
    sourceKind: "empty" | "craft" | "simulator";
  }>,
): TestList {
  return {
    id: overrides.id ?? "list-1",
    name: overrides.name ?? "List",
    updatedAt: new Date("2026-06-08T00:00:00.000Z"),
    sourceKind: overrides.sourceKind ?? "craft",
  };
}

function sharedList(
  overrides: Partial<{
    id: string;
    name: string;
    role: "read" | "write";
    sourceKind: "empty" | "craft" | "simulator";
  }>,
): TestSharedList {
  return {
    ...ownedList(overrides),
    role: overrides.role ?? "write",
  };
}

void test("owned craft and empty lists are appendable destinations", () => {
  const destinations = getAppendableShoplistDestinations({
    owned: [
      ownedList({
        id: "owned-craft",
        name: "Owned Craft",
        sourceKind: "craft",
      }),
      ownedList({
        id: "owned-empty",
        name: "Owned Empty",
        sourceKind: "empty",
      }),
    ],
    shared: [],
  });

  assert.deepEqual(
    destinations.map((destination) => destination.id),
    ["owned-craft", "owned-empty"],
  );
});

void test("shared write craft and empty lists are appendable destinations", () => {
  const destinations = getAppendableShoplistDestinations({
    owned: [],
    shared: [
      sharedList({
        id: "shared-craft",
        name: "Shared Craft",
        role: "write",
        sourceKind: "craft",
      }),
      sharedList({
        id: "shared-empty",
        name: "Shared Empty",
        role: "write",
        sourceKind: "empty",
      }),
    ],
  });

  assert.deepEqual(
    destinations.map((destination) => destination.id),
    ["shared-craft", "shared-empty"],
  );
});

void test("shared read lists are not appendable destinations", () => {
  const destinations = getAppendableShoplistDestinations({
    owned: [],
    shared: [
      sharedList({
        id: "shared-read",
        name: "Shared Read",
        role: "read",
        sourceKind: "craft",
      }),
    ],
  });

  assert.deepEqual(destinations, []);
});

void test("simulator lists are not appendable destinations", () => {
  const destinations = getAppendableShoplistDestinations({
    owned: [
      ownedList({
        id: "owned-simulator",
        name: "Owned Simulator",
        sourceKind: "simulator",
      }),
    ],
    shared: [
      sharedList({
        id: "shared-simulator",
        name: "Shared Simulator",
        role: "write",
        sourceKind: "simulator",
      }),
    ],
  });

  assert.deepEqual(destinations, []);
});
