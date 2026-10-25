/**
 * Sealed-gear crafts that can proc a Glowing Sealed result (client DB, 2026-10-19).
 *
 * Only the Equipment Designer's Workbench (doodad 9351) recipes roll a product pack, and only the
 * Illustrious, Magnificent, Epherium and Delphinad tiers have Glowing Sealed items. Forge recipes for
 * the same Sealed item and every Sealed Ayanad craft never glow. The proc rate itself is server-side.
 */
export const GLOWING_ELIGIBLE_CRAFT_IDS: ReadonlySet<number> = new Set([
  7796, 7797, 7798, 7799, 7800, 7801, 7802, 7803, 7804, 7805, 7806, 7807, 7808,
  7809, 7810, 7811, 7812, 7813, 7814, 7815, 7816, 7817, 7818, 7819, 7820, 7821,
  7822, 7823, 7824, 7825, 7826, 7827, 7828, 7829, 7830, 7831, 7832, 7833, 7834,
  7835, 7836, 8093, 8094, 8095, 8096, 8097, 8098, 8099, 8100, 8101, 8102, 8103,
  8104, 8105, 8106, 8107, 8108, 8109, 8110, 8111, 8112, 8113, 8114, 8115, 8116,
  8117, 8118, 8119, 8120, 8121, 8122, 8123, 8124, 8125, 8126, 8127, 8128, 8129,
  8130, 8131, 8132, 8133, 8134, 8135, 8136, 8137, 8138, 8139, 8140, 8141, 8142,
  8143, 8144, 8145, 8146, 8147, 8148, 8149, 8150, 8151, 8152, 8153, 8154, 8155,
  8156, 8157, 8158, 8159, 8160, 8161, 8162, 8163, 8164, 8165, 8166, 8167, 8168,
  8169, 8170, 8171, 8172, 8173, 8174, 8175, 8176, 8177, 8178, 8179, 8180, 8181,
  8182, 8183, 8184, 8185, 8186, 8187, 8188, 8189, 8190, 8191, 8192, 8193, 8194,
  8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8203, 8204, 8205, 8206, 8207,
  8208, 8209, 8210, 8211, 8212, 8213, 8214, 8215, 9001177, 9001178, 9001179,
  9001180,
]);

export function canCraftProcGlowing(craftId: number): boolean {
  return GLOWING_ELIGIBLE_CRAFT_IDS.has(craftId);
}
