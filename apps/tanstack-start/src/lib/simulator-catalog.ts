export const SIMULATOR_TARGETS = [
  {
    wispKey: "cloth",
    wispLabel: "Cloth",
    representativeCraft: "Shirt",
    itemId: 23947,
    itemName: "Sealed Delphinad Shirt",
  },
  {
    wispKey: "leather",
    wispLabel: "Leather",
    representativeCraft: "Jerkin",
    itemId: 23975,
    itemName: "Sealed Delphinad Jerkin",
  },
  {
    wispKey: "plate",
    wispLabel: "Plate",
    representativeCraft: "Cuirass",
    itemId: 24003,
    itemName: "Sealed Delphinad Cuirass",
  },
  {
    wispKey: "one-hander",
    wispLabel: "One-Hander",
    representativeCraft: "Shortspear",
    itemId: 23885,
    itemName: "Sealed Delphinad Shortspear",
  },
  {
    wispKey: "two-hander",
    wispLabel: "Two-Hander",
    representativeCraft: "Longspear",
    itemId: 23912,
    itemName: "Sealed Delphinad Longspear",
  },
  {
    wispKey: "wooden",
    wispLabel: "Wooden",
    representativeCraft: "Bow",
    itemId: 23893,
    itemName: "Sealed Delphinad Bow",
  },
  {
    wispKey: "small-jewelry",
    wispLabel: "Small Jewelry",
    representativeCraft: "Ring",
    itemId: 24023,
    itemName: "Sealed Delphinad Ring",
  },
  {
    wispKey: "large-jewelry",
    wispLabel: "Large Jewelry",
    representativeCraft: "Necklace",
    itemId: 24018,
    itemName: "Sealed Delphinad Necklace",
  },
  {
    wispKey: "musical",
    wispLabel: "Musical",
    representativeCraft: "Lute",
    itemId: 23918,
    itemName: "Sealed Delphinad Lute",
  },
] as const;

export type SimulatorTarget = (typeof SIMULATOR_TARGETS)[number];
export type SimulatorWispKey = SimulatorTarget["wispKey"];

export function getSimulatorTargetByItemId(
  itemId: number,
): SimulatorTarget | null {
  return SIMULATOR_TARGETS.find((target) => target.itemId === itemId) ?? null;
}
