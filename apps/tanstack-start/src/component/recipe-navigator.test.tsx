import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecipeNavigator } from "~/component/recipe-navigator";

const recipeChoices = [
  {
    id: 10,
    name: "Rising Star Stone",
    output: 1,
    labor: 20,
    cost: "Missing Price",
    selected: true,
    recommended: true,
  },
  {
    id: 11,
    name: "Bulk Rising Star Stone",
    output: 10,
    labor: 180,
    cost: "95 Gold",
    costPerItem: "9.5 Gold / Item",
  },
];

describe("Recipe navigator", () => {
  it("shows a navigable production path and explicit Recipe Choices", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    const onRecipeChoice = vi.fn();

    render(
      <RecipeNavigator
        path={[
          { id: 1, name: "Epherium Sword" },
          { id: 2, name: "Rising Star Stone" },
        ]}
        focusedItemName="Rising Star Stone"
        choices={recipeChoices}
        materials={[]}
        onFocus={onFocus}
        onRecipeChoice={onRecipeChoice}
      />,
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Epherium Sword" }),
    );
    await user.keyboard("{Enter}");
    expect(onFocus).toHaveBeenCalledWith(1);

    const bulkChoice = screen.getByRole("button", {
      name: /Bulk Rising Star Stone/,
    });
    expect(bulkChoice.getAttribute("aria-pressed")).toBe("false");
    await user.click(bulkChoice);
    expect(onRecipeChoice).toHaveBeenCalledWith(11);
    expect(screen.getByText("Recommendation")).toBeTruthy();
    expect(screen.getByText("Missing Price")).toBeTruthy();
  });

  it("changes Acquisition Mode and inspects a crafted Material", async () => {
    const user = userEvent.setup();
    const onAcquisitionMode = vi.fn();
    const onInspect = vi.fn();

    const view = render(
      <RecipeNavigator
        path={[{ id: 1, name: "Rising Star Stone" }]}
        focusedItemName="Rising Star Stone"
        choices={recipeChoices.slice(0, 1)}
        materials={[
          {
            id: 3,
            name: "Sturdy Ingot",
            amount: 2,
            mode: "buy",
            craftable: true,
            price: "4 Gold",
          },
        ]}
        onFocus={vi.fn()}
        onRecipeChoice={vi.fn()}
        onAcquisitionMode={onAcquisitionMode}
        onInspect={onInspect}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Craft Sturdy Ingot" }),
    );
    expect(onAcquisitionMode).toHaveBeenCalledWith(3, "craft");

    view.rerender(
      <RecipeNavigator
        path={[{ id: 1, name: "Rising Star Stone" }]}
        focusedItemName="Rising Star Stone"
        choices={recipeChoices.slice(0, 1)}
        materials={[
          {
            id: 3,
            name: "Sturdy Ingot",
            amount: 2,
            mode: "craft",
            craftable: true,
            price: "4 Gold",
          },
        ]}
        onFocus={vi.fn()}
        onRecipeChoice={vi.fn()}
        onAcquisitionMode={onAcquisitionMode}
        onInspect={onInspect}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Inspect Sturdy Ingot" }),
    );
    expect(onInspect).toHaveBeenCalledWith(3);
  });
});
