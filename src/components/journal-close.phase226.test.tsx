/**
 * Phase 226 — Journal close-trade flow is wired end to end.
 *
 * Phase 225 found `handleClose` fully written but unreachable from the UI:
 * the "→ Closed" lifecycle button ran the generic transition, so an OPEN
 * trade could be closed without an exit price and the P/L, outcome and
 * pnlPercent fields the schema (and the Convex `journal.transition`
 * mutation) provide for were never populated. This suite pins the intended
 * behaviour on the real component:
 *
 *   1. "→ Closed" opens an exit-price prompt; nothing changes until confirm.
 *   2. Confirm with a valid price → CLOSED with exitPrice, pnl, pnlPercent
 *      and outcome derived by `computePnl` / `classifyOutcome` — the same
 *      pure functions the rest of the journal uses (no new arithmetic).
 *   3. Confirm without a price → CLOSED, but pnl stays UNDEFINED and the
 *      outcome is UNKNOWN. A fabricated 0 P/L is a defect (Phase 196 §4).
 *   4. Cancel → still OPEN, exit prompt gone.
 *   5. Direction comes from the immutable analysis snapshot; a NO_TRADE
 *      snapshot never yields a P/L, even with both prices known.
 *   6. Other lifecycle buttons still transition immediately (no regression).
 *
 * Authorization: this component holds local state only and does not call
 * Convex. The server side (`journal.transition`) still enforces ownership
 * and VALID_TRANSITIONS; the local flow uses the same VALID_TRANSITIONS
 * table so the UI can never offer a transition the server would reject.
 */
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import en from "@/lib/i18n/en";
import { Journal } from "./Journal";
import type { JournalEntry } from "@/types/journal";
import { VALID_TRANSITIONS } from "@/types/journal";

afterEach(cleanup);

function openEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "j-open",
    instrument: "BTC/USD",
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    status: "OPEN",
    entry: 50_000,
    stopLoss: 49_000,
    takeProfit: 53_000,
    positionSize: 2,
    analysisSnapshot: {
      analysisId: "a1",
      decision: "LONG",
      bias: "Bullish",
      confidence: 70,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "COMPLETE",
    },
    ...overrides,
  } as JournalEntry;
}

/** Render, open the detail view of the seeded entry, return helpers. */
function openDetail(entry: JournalEntry) {
  const onJournalCreated = { calls: 0 };
  render(
    <I18nProvider>
      <Journal initialEntries={[entry]} onJournalCreated={() => { onJournalCreated.calls++; }} />
    </I18nProvider>,
  );
  fireEvent.click(document.querySelector(`[data-journal-entry="${entry.id}"]`)!);
  return {
    onJournalCreated,
    button: (status: string) => document.querySelector(`[data-transition="${status}"]`) as HTMLButtonElement | null,
    closeForm: () => document.querySelector("[data-close-form]") as HTMLFormElement | null,
    exitInput: () => screen.getByLabelText(`${en.global.exit}:`) as HTMLInputElement,
    confirm: () => document.querySelector("[data-close-confirm]") as HTMLButtonElement,
    /** Rendered P/L cell text, or null when the cell is absent. */
    pnlText: () => {
      const label = Array.from(document.querySelectorAll("span")).find((s) => s.textContent === `${en.journal.pnlLabel}:`);
      return label?.parentElement?.textContent ?? null;
    },
    statusBadge: () => document.querySelector("[data-status]")?.getAttribute("data-status") ?? null,
  };
}

describe("226 — '→ Closed' opens an exit-price prompt instead of closing blindly", () => {
  it("shows the prompt and does NOT transition until confirmed", () => {
    const h = openDetail(openEntry());
    expect(h.closeForm()).toBeNull();
    fireEvent.click(h.button("CLOSED")!);
    expect(h.closeForm()).not.toBeNull();
    // Still OPEN: the lifecycle buttons for OPEN are still rendered.
    expect(h.button("CLOSED")).not.toBeNull();
    expect(h.button("INVALIDATED")).not.toBeNull();
    expect(h.pnlText()).toBeNull();
  });

  it("confirm with a price closes with exitPrice, pnl, pnlPercent and outcome from computePnl", () => {
    const h = openDetail(openEntry());
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.change(h.exitInput(), { target: { value: "52000" } });
    fireEvent.click(h.confirm());
    // Terminal: no more lifecycle buttons.
    expect(h.button("CLOSED")).toBeNull();
    expect(h.closeForm()).toBeNull();
    // (52000 − 50000) × 2 = 4000 profit, +4 %.
    expect(h.pnlText()).toContain("4000");
    expect(document.body.textContent).toContain(`${en.global.exit}: 52000`);
    expect(document.body.textContent).toContain("4.00%");
    expect(document.body.textContent).toContain(en.journal.outcomeWin);
  });

  it("a SHORT profits when price falls (direction taken from the snapshot)", () => {
    const h = openDetail(openEntry({ analysisSnapshot: { ...openEntry().analysisSnapshot, decision: "SHORT", bias: "Bearish" } }));
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.change(h.exitInput(), { target: { value: "49000" } });
    fireEvent.click(h.confirm());
    expect(h.pnlText()).toContain("2000");
    expect(h.pnlText()).not.toContain("-2000");
    expect(document.body.textContent).toContain(en.journal.outcomeWin);
  });

  it("confirm WITHOUT a price closes with pnl undefined and outcome UNKNOWN — never a fabricated 0", () => {
    const h = openDetail(openEntry());
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.click(h.confirm());
    expect(h.button("CLOSED")).toBeNull(); // closed
    expect(h.pnlText()).toBeNull(); // no P/L cell rendered at all
    expect(document.body.textContent).not.toContain(`${en.journal.pnlLabel}: 0`);
    expect(document.body.textContent).toContain(en.journal.outcomeUnknown);
  });

  it("a non-directional snapshot never yields a P/L even with both prices known", () => {
    const h = openDetail(openEntry({ analysisSnapshot: { ...openEntry().analysisSnapshot, decision: "NO_TRADE", bias: "Neutral" } }));
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.change(h.exitInput(), { target: { value: "52000" } });
    fireEvent.click(h.confirm());
    expect(document.body.textContent).toContain(`${en.global.exit}: 52000`);
    expect(h.pnlText()).toBeNull();
    expect(document.body.textContent).toContain(en.journal.outcomeUnknown);
  });

  it("cancel leaves the entry OPEN and removes the prompt", () => {
    const h = openDetail(openEntry());
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.change(h.exitInput(), { target: { value: "52000" } });
    fireEvent.click(screen.getByText(en.global.cancel));
    expect(h.closeForm()).toBeNull();
    expect(h.button("CLOSED")).not.toBeNull();
    expect(h.pnlText()).toBeNull();
  });

  it("other lifecycle buttons still transition immediately", () => {
    const h = openDetail(openEntry({ status: "PLANNED" }));
    fireEvent.click(h.button("OPEN")!);
    expect(h.closeForm()).toBeNull();
    expect(h.button("CLOSED")).not.toBeNull(); // now OPEN → CLOSED offered
  });

  it("closing a trade never fires the create callback (no accidental mutation path)", () => {
    const h = openDetail(openEntry());
    fireEvent.click(h.button("CLOSED")!);
    fireEvent.change(h.exitInput(), { target: { value: "52000" } });
    fireEvent.click(h.confirm());
    expect(h.onJournalCreated.calls).toBe(0);
  });
});

describe("226 — the UI can only offer transitions the server allows", () => {
  it("the lifecycle buttons for every status are exactly VALID_TRANSITIONS[status]", () => {
    for (const status of Object.keys(VALID_TRANSITIONS) as (keyof typeof VALID_TRANSITIONS)[]) {
      const h = openDetail(openEntry({ id: `j-${status}`, status }));
      const offered = Array.from(document.querySelectorAll("[data-transition]")).map((b) => b.getAttribute("data-transition"));
      expect(offered.sort()).toEqual([...VALID_TRANSITIONS[status]].sort());
      cleanup();
      void h;
    }
  });

  it("the component never calls a Convex mutation directly (server authorization owns persistence)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/Journal.tsx", "utf8");
    expect(src).not.toMatch(/useMutation|api\.journal/);
    expect(src).not.toContain("handleUpdateNotes"); // dead duplicate of handleUpdateReview removed
  });
});
