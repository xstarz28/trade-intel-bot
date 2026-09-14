/**
 * Phase 197 — ALERTS / NOTIFICATIONS / PROTECTION PANEL localization.
 *
 * The detector reported five strings across these three components. A full
 * read found eleven, because six were in places the detector structurally
 * cannot see: a `title` attribute, four `toast` calls inside callbacks, and
 * two ternaries.
 *
 * Two of those are more than cosmetic:
 *
 *   - The toast messages live inside `useCallback`s. Localizing them without
 *     adding `t` to the dependency array creates a STALE CLOSURE: switch
 *     language, delete a rule, and the confirmation appears in the previous
 *     language. This suite pins the dependency contract.
 *
 *   - The notification filter's `value` is a canonical token (ALL / UNREAD /
 *     severity) used for filtering. Translating the value instead of the label
 *     would silently break the filter in every non-English locale.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import en from "@/lib/i18n/en";
import id from "@/lib/i18n/id";
import es from "@/lib/i18n/es";
import fr from "@/lib/i18n/fr";
import pt from "@/lib/i18n/pt";
import de from "@/lib/i18n/de";
import ja from "@/lib/i18n/ja";
import ko from "@/lib/i18n/ko";
import zh from "@/lib/i18n/zh";
import { ALL_LOCALES } from "@/lib/i18n/types";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;
type LocaleCode = keyof typeof BUNDLES;

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const ALERTS = "src/components/CustomAlertRulesPanel.tsx";
const NOTIFS = "src/components/NotificationCenter.tsx";
const PANEL = "src/components/PositionProtectionPanel.tsx";

describe("Phase 197 — no hardcoded English remains in these surfaces", () => {
  it("CustomAlertRulesPanel has no English toast or title literals", () => {
    const source = read(ALERTS);
    for (const literal of [
      '"Failed to create rule"',
      '"Failed to update rule"',
      '"Failed to delete rule"',
      '"Rule deleted"',
      '"Disable rule"',
      '"Enable rule"',
      '"New Rule"',
      '"Cancel"',
      '"Instrument"',
    ]) {
      expect(source, `${literal} is still hardcoded`).not.toContain(literal);
    }
  });

  it("NotificationCenter has no English heading or toggle literals", () => {
    const source = read(NOTIFS);
    for (const literal of [
      ">Categories<",
      ">Display<",
      '"Hide Prefs"',
      '"Preferences"',
    ]) {
      expect(source, `${literal} is still hardcoded`).not.toContain(literal);
    }
  });

  it("PositionProtectionPanel renders its thesis caption from the dictionary", () => {
    const source = read(PANEL);
    expect(source).not.toMatch(/>\s*Thesis\s*</);
    expect(source).toContain("{t.trader.thesisLabel}");
  });
});

describe("Phase 197 — localized toasts must not go stale on a locale switch", () => {
  it("every useCallback that renders copy depends on the translator", () => {
    const source = read(ALERTS);
    // Find each useCallback body and the dependency array that closes it.
    const blocks = source.split("useCallback(").slice(1);
    let checked = 0;
    for (const block of blocks) {
      const end = block.indexOf("\n  );");
      const body = end === -1 ? block : block.slice(0, end);
      const usesCopy = /\bt\.[a-zA-Z]|\btxi\(/.test(body);
      if (!usesCopy) continue;
      checked += 1;
      const deps = body.slice(body.lastIndexOf("["));
      expect(
        /\bt\b|\btxi\b/.test(deps),
        `a useCallback renders copy but omits the translator from its deps: ${deps.slice(0, 80)}`,
      ).toBe(true);
    }
    // Guard against the check silently matching nothing.
    expect(checked).toBeGreaterThan(0);
  });
});

describe("Phase 197 — filter values stay canonical", () => {
  it("keeps ALL / UNREAD / severity tokens untranslated in the filter", () => {
    const source = read(NOTIFS);
    for (const token of ["ALL", "UNREAD", "CRITICAL", "HIGH", "MEDIUM", "LOW"]) {
      expect(source).toContain(`value: "${token}"`);
    }
  });

  it("compares the filter against the canonical value, never a label", () => {
    const source = read(NOTIFS);
    expect(source).toContain('opt.value === "ALL"');
    expect(source).not.toMatch(/opt\.label\s*===/);
  });
});

describe("Phase 197 — new vocabulary is complete and distinct", () => {
  it("every locale defines the new keys with non-empty values", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const values = [
        t.notifications.categoriesHeading,
        t.notifications.displayHeading,
        t.notifications.filterAll,
        t.notifications.preferencesToggle,
        t.notifications.preferencesHide,
        t.alerts.ruleCreateFailed,
        t.alerts.ruleUpdateFailed,
        t.alerts.ruleDeleted,
        t.alerts.ruleDeleteFailed,
        t.alerts.ruleCreated,
      ];
      for (const value of values) {
        expect(value.trim().length, `${locale} has an empty key`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the rule-created toast interpolable in every locale", () => {
    // Losing {name} would make the confirmation ambiguous when several rules
    // exist — the user would not know which one was created.
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      expect(t.alerts.ruleCreated, `${locale} lost {name}`).toContain("{name}");
    }
  });

  it("distinguishes the show and hide states of the preferences toggle", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      expect(
        t.notifications.preferencesToggle,
        `${locale}: show and hide read identically`,
      ).not.toBe(t.notifications.preferencesHide);
    }
  });

  it("distinguishes success from failure in the rule toasts", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      expect(t.alerts.ruleDeleted).not.toBe(t.alerts.ruleDeleteFailed);
      expect(t.alerts.ruleCreateFailed).not.toBe(t.alerts.ruleUpdateFailed);
    }
  });
});

describe("Phase 197 — backend error messages are still preferred", () => {
  it("falls back to localized copy only when the provider gave no reason", () => {
    // `err?.message ?? t...` — a real backend reason must never be replaced by
    // generic localized copy, which would hide why an operation failed.
    const source = read(ALERTS);
    const fallbacks = source.match(/err\?\.message \?\? t\.alerts\.\w+/g) ?? [];
    expect(fallbacks.length).toBeGreaterThanOrEqual(3);
    expect(source).not.toMatch(/toast\.error\(t\.alerts\.rule\w*Failed\)/);
  });
});
