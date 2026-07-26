import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  PageHeading,
  PageSection,
  PageShell,
} from "~/component/page-composition";

describe("page composition", () => {
  it("renders one page title and labelled major sections", () => {
    render(
      <PageShell>
        <PageHeading
          title="Rising Star Stone"
          subtitle="Craft Plan · Machining"
          back={<a href="/craft">Back to Crafting</a>}
          actions={<button type="button">Save Plan</button>}
        />
        <PageSection title="Crafting Summary" description="Plan totals.">
          <p>12 Gold</p>
        </PageSection>
      </PageShell>,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Rising Star Stone" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to Crafting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Plan" })).toBeTruthy();

    const summary = screen.getByRole("region", { name: "Crafting Summary" });
    expect(within(summary).getByText("Plan totals.")).toBeTruthy();
    expect(within(summary).getByText("12 Gold")).toBeTruthy();
  });

  it.each(["normal", "wide", "narrow", "landing"] as const)(
    "exposes the %s layout intentionally",
    (layout) => {
      render(<PageShell layout={layout}>Content</PageShell>);
      expect(screen.getByText("Content").closest("main")?.dataset.layout).toBe(
        layout,
      );
    },
  );
});
