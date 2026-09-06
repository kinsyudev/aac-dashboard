import assert from "node:assert/strict";
import test from "node:test";
import { ComponentType } from "discord.js";

import {
  buildCropPicker,
  buildManagementList,
  buildManagementModal,
  buildTimerFarmPicker,
} from "./management-view";

void test("list payload omits content when it has no status notice", () => {
  const payload = buildManagementList(
    { kind: "farms", ownerId: "123456789", page: 0 },
    [],
  );

  assert.equal("content" in payload, false);
});

void test("every list control has a unique custom id", () => {
  const payload = buildManagementList(
    { kind: "farms", ownerId: "123456789", page: 0 },
    [],
  );
  const customIds = payload.components.flatMap((row) =>
    row
      .toJSON()
      .components.filter((component) => "custom_id" in component)
      .map((component) => component.custom_id),
  );

  assert.equal(new Set(customIds).size, customIds.length);
});

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

void test("active timer edit identifies that its farm can be changed or removed", () => {
  const modal = buildManagementModal(
    {
      kind: "timers",
      ownerId: "123456789",
      page: 0,
      id: "12345678-90ab-cdef-1234-567890abcdef",
    },
    { crop: "42", farm: "north-field" },
  ).toJSON();
  const farmRow = modal.components.find(
    (row) =>
      row.type === ComponentType.ActionRow &&
      row.components.some(
        (component) => component.custom_id === "farm",
      ),
  );
  assert.ok(farmRow?.type === ComponentType.ActionRow);
  const farmInput = farmRow.components[0];
  assert.ok(farmInput);

  assert.equal(farmInput.label, "Farm slug (blank removes farm)");
  assert.equal(farmInput.value, "north-field");
});

void test("active timer farm picker includes owned farms and a removal choice", () => {
  const payload = buildTimerFarmPicker(
    {
      kind: "timers",
      ownerId: "123456789",
      page: 0,
      id: "12345678-90ab-cdef-1234-567890abcdef",
    },
    [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "North Field",
        slug: "north-field",
      },
    ],
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
  const [select] = payload.components[0]?.toJSON().components ?? [];
  if (select == null || !("options" in select))
    throw new Error("Expected a farm select menu.");

  assert.deepEqual(
    select.options.map((option) => ({
      label: option.label,
      value: option.value,
      default: option.default,
    })),
    [
      { label: "No farm", value: "none", default: false },
      {
        label: "North Field",
        value: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        default: true,
      },
    ],
  );
});
