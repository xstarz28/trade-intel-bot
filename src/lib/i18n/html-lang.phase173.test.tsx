/**
 * Phase 173 — <html lang> must follow the active locale.
 *
 * Found while grounding the UAT matrix in what a human can actually observe.
 * `index.html` hardcodes `lang="en"` and nothing ever updated it, so all 9
 * locales were announced to assistive tech as English and indexed as English.
 * Screen readers select pronunciation rules from this attribute, so a Japanese
 * or Korean UI was read aloud with English phonetics.
 *
 * This is an accessibility defect, not cosmetics: WCAG 3.1.1 (Language of Page).
 */

import { describe, expect, it, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { SUPPORTED_LOCALES } from "@/lib/i18n/locales";
import type { Locale } from "@/lib/i18n/types";

function LocaleProbe({ onReady }: { onReady: (set: (l: Locale) => void) => void }) {
  const { setLocale } = useI18n();
  onReady(setLocale);
  return null;
}

function mount() {
  let setLocale!: (l: Locale) => void;
  render(
    <I18nProvider>
      <LocaleProbe onReady={(s) => (setLocale = s)} />
    </I18nProvider>,
  );
  return { setLocale };
}

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.lang = "en";
});

describe("document language reflects the active locale", () => {
  it("sets lang on first render", () => {
    document.documentElement.lang = "";
    mount();
    expect(document.documentElement.lang).not.toBe("");
  });

  it.each(SUPPORTED_LOCALES)("updates lang to %s when the locale changes", (loc) => {
    const { setLocale } = mount();

    act(() => setLocale(loc as Locale));

    expect(document.documentElement.lang).toBe(loc);
  });

  it("does not leave a stale language behind after switching twice", () => {
    const { setLocale } = mount();

    act(() => setLocale("ja" as Locale));
    expect(document.documentElement.lang).toBe("ja");

    act(() => setLocale("de" as Locale));
    // The bug shape to guard against: first value sticking.
    expect(document.documentElement.lang).toBe("de");
  });
});
