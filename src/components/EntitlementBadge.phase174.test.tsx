/**
 * Phase 174 — the entitlement UI must mirror the server, never invent state.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import {
  EntitlementBadge,
  LockedSignalNotice,
  type ServerEntitlement,
} from "./EntitlementBadge";
import { FREE_PROFIT_SIGNAL_LIMIT } from "@/lib/entitlement/entitlement";

function renderBadge(entitlement: ServerEntitlement | undefined) {
  return render(
    <I18nProvider>
      <EntitlementBadge entitlement={entitlement} />
    </I18nProvider>,
  );
}

const GUEST: ServerEntitlement = {
  authenticated: true,
  plan: "GUEST",
  remaining: 2,
  limit: FREE_PROFIT_SIGNAL_LIMIT,
  upgradeRequired: false,
};

describe("the badge renders only what the server reported", () => {
  it("renders nothing before the server responds", () => {
    // A guessed plan would be a lie the moment it disagreed with the database.
    const { container } = renderBadge(undefined);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for an unauthenticated caller", () => {
    const { container } = renderBadge({ ...GUEST, authenticated: false });
    expect(container.textContent).toBe("");
  });

  it("shows the trial state with the server's remaining count", () => {
    const { container } = renderBadge({ ...GUEST, remaining: 2 });
    expect(container.textContent).toContain("Trial");
    expect(container.textContent).toContain("2");
  });

  it("uses the singular form at exactly one remaining", () => {
    const { container } = renderBadge({ ...GUEST, remaining: 1 });
    expect(container.textContent).toContain("1 free signal left");
  });

  it("shows the exhausted state at zero", () => {
    const { container } = renderBadge({ ...GUEST, remaining: 0 });
    expect(container.textContent).toContain("Free signals used");
  });

  it("shows Premium as unlimited", () => {
    const { container } = renderBadge({
      ...GUEST,
      plan: "PREMIUM",
      remaining: null,
    });
    expect(container.textContent).toContain("Premium");
    expect(container.textContent).toContain("Unlimited");
  });

  it("trusts the server even when its numbers look inconsistent", () => {
    // The UI must not 'correct' the server. If the server says PREMIUM with a
    // remaining of 0, that is still PREMIUM.
    const { container } = renderBadge({
      ...GUEST,
      plan: "PREMIUM",
      remaining: 0,
    });
    expect(container.textContent).toContain("Premium");
    expect(container.textContent).not.toContain("Free signals used");
  });

  it("does not recompute remaining from the limit", () => {
    // Server says 5 left despite a limit of 2 — render 5, do not clamp.
    const { container } = renderBadge({ ...GUEST, remaining: 5 });
    expect(container.textContent).toContain("5");
  });
});

describe("the locked notice never masquerades as a refusal", () => {
  function renderNotice() {
    return render(
      <I18nProvider>
        <LockedSignalNotice instrument="BTC-USDT" />
      </I18nProvider>,
    );
  }

  it("states the signal is locked", () => {
    const { container } = renderNotice();
    expect(container.textContent).toContain("Actionable signal locked");
  });

  it("names the instrument analysed", () => {
    const { container } = renderNotice();
    expect(container.textContent).toContain("BTC-USDT");
  });

  it("explicitly says it is NOT a Wait / No-Trade verdict", () => {
    const { container } = renderNotice();
    expect(container.textContent).toContain(
      "not a Wait or No-Trade verdict",
    );
  });

  it("never displays a direction", () => {
    const { container } = renderNotice();
    const text = container.textContent ?? "";

    for (const dir of ["LONG", "SHORT", "BUY", "SELL"]) {
      expect(text).not.toContain(dir);
    }
  });

  it("tells the user non-actionable results stay free", () => {
    const { container } = renderNotice();
    expect(container.textContent).toContain("always free");
  });

  it("offers an upgrade path with no pricing", () => {
    const { container } = renderNotice();
    const text = container.textContent ?? "";

    expect(text).toContain("Unlock with Premium");

    // Commercial terms are deferred — nothing priced may appear yet.
    // NB: "USD" is deliberately absent from this list; it appears inside the
    // instrument id (BTC-USDT), which is not a price.
    for (const token of ["$", "€", "£", "Rp", "/mo", "per month", "/month"]) {
      expect(text).not.toContain(token);
    }

    // A currency amount would look like a number next to a symbol/code.
    expect(text).not.toMatch(/\d+(\.\d+)?\s*(USD|EUR|IDR)\b/);
  });
});
