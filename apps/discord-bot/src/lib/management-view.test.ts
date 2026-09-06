import assert from "node:assert/strict";
import test from "node:test";

import { buildCropPicker } from "./management-view";

void test("crop picker exposes a selectable page of catalog suggestions", () => {
  const crops = Array.from({ length: 26 }, (_, index) => ({
    id: index + 1,
    name: `Crop ${index + 1}`,
  }));

  const result = buildCropPicker(
    { kind: "timers", ownerId: "123456789", page: 0 },
    crops,
  );
  const [picker, actions] = result.components;
  if (picker == null || actions == null)
    throw new Error("Expected picker and navigation rows.");
  const [select] = picker.toJSON().components;
  if (select == null || !("options" in select))
    throw new Error("Expected a string select menu.");

  assert.equal(select.options.length, 25);
  assert.equal(select.custom_id, "manage:timers:123456789:0:pick-crop:");
  assert.equal(actions.toJSON().components[1]?.disabled, false);
});
