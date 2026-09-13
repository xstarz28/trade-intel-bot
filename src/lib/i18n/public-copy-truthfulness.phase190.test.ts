/**
 * Phase 190 — public copy truthfulness and locale parity.
 *
 * A marketing page is a security surface. Overclaiming on the landing page is
 * as much a defect as leaking a credential: it induces a user to trust output
 * the system does not actually produce. These tests hold public copy to the
 * same standard as the engine — **every claim must correspond to implemented
 * capability**, in all nine locales.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const LOCALES = ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"] as const;

const LANDING_KEYS = [
  "signIn", "launch", "heroBadge", "heroRole", "heroBody", "openTerminal",
  "guestMode", "coverageLabel", "instrumentsLabel", "coverageNote",
  "assetForex", "assetCrypto", "assetStock", "assetCommodity",
  "frameworkTitle", "frameworkBody", "featureStructureTitle",
  "featureStructureBody", "featureSupplyTitle", "featureSupplyBody",
  "featureMtfTitle", "featureMtfBody", "featureFlowTitle", "featureFlowBody",
  "convictionBadge", "convictionTitle", "convictionTitleEmphasis",
  "convictionBody", "weightStructure", "weightLiquidity", "weightFundamental",
  "weightSentiment", "outputTechnicalLabel", "outputTechnicalDesc",
  "outputFundamentalLabel", "outputFundamentalDesc", "outputPlanLabel",
  "outputPlanDesc", "outputConvictionLabel", "outputConvictionDesc",
  "outputInvalidationLabel", "outputInvalidationDesc",
  "principleNoFabricationTitle", "principleNoFabricationBody",
  "principleCapitalTitle", "principleCapitalBody", "principleNoAutoTitle",
  "principleNoAutoBody", "disclaimerTitle", "disclaimerBody", "ctaTitle",
  "ctaBody", "ctaButton", "footerTagline", "homeAriaLabel",
] as const;

/** Extract a top-level section block from a locale module. */
function blockOf(src: string, name: string): string {
  const start = src.indexOf(`\n  ${name}: {`);
  if (start === -1) return "";
  return src.slice(start, src.indexOf("\n  },", start));
}

/** All string VALUES in a section — never the key names. */
function valuesOf(block: string): string[] {
  return [...block.matchAll(/:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

const landingBlocks = Object.fromEntries(
  LOCALES.map((l) => [l, blockOf(read(`src/lib/i18n/${l}.ts`), "landing")]),
) as Record<(typeof LOCALES)[number], string>;

/**
 * Strip comments before scanning source.
 *
 * These tests assert on what SHIPS. A code comment that explains *why* a
 * claim was removed ("the `+ any symbol` badge was replaced because…") must
 * not itself be flagged as making that claim — otherwise documenting a fix
 * would break the build and engineers would stop documenting fixes.
 */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, "")             // /* block */
    .replace(/^\s*\/\/.*$/gm, "");                  // // line
}

const LANDING_SRC = stripComments(read("src/pages/Landing.tsx"));

/**
 * Negation-aware claim detection.
 *
 * "does not guarantee profit" and "guarantees profit" contain the same words
 * and opposite meanings. A naive substring scan flags the disclaimer — the
 * very sentence that makes the page honest — so claims are only counted when
 * no negator appears immediately before them.
 */
const NEGATORS =
  /\b(not|never|no|without|cannot|tidak|bukan|tanpa|nunca|jamais|aucune?|ne|nicht|keine?|não|n[ãa]o)\b|않|없|不|无|せず|ありません|ません/i;

function affirmativeClaims(text: string, pattern: RegExp): string[] {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const hits: string[] = [];
  for (const match of text.matchAll(global)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 28), match.index);
    if (!NEGATORS.test(before)) hits.push(match[0]);
  }
  return hits;
}

// ════════════════ 1. LOCALE PARITY ════════════════

describe("190.1 — landing copy exists in all nine locales", () => {
  it("every locale defines a landing section", () => {
    for (const locale of LOCALES) {
      expect(landingBlocks[locale], `${locale} has no landing block`).not.toBe("");
    }
  });

  it("every locale defines every landing key", () => {
    for (const locale of LOCALES) {
      for (const key of LANDING_KEYS) {
        expect(
          landingBlocks[locale],
          `${locale} missing landing.${key}`,
        ).toContain(`${key}:`);
      }
    }
  });

  it("no locale carries an extra or misspelled landing key", () => {
    const expected = [...LANDING_KEYS].sort();
    for (const locale of LOCALES) {
      const found = [...landingBlocks[locale].matchAll(/^\s{4}(\w+):/gm)]
        .map((m) => m[1])
        .sort();
      expect(found, `${locale} key set drifted`).toEqual(expected);
    }
  });

  it("no locale leaves a value empty", () => {
    for (const locale of LOCALES) {
      for (const value of valuesOf(landingBlocks[locale])) {
        expect(value.trim().length, `${locale} has an empty landing value`).toBeGreaterThan(0);
      }
    }
  });
});

// ════════════════ 2. NO ENGLISH FALLBACK / NO ID LEAKAGE ════════════════

describe("190.2 — translations are genuine, not copies", () => {
  /** Prose keys; short UI tokens legitimately coincide across languages. */
  const PROSE = [
    "heroBody", "frameworkBody", "convictionBody", "disclaimerBody",
    "coverageNote", "principleNoFabricationBody", "principleNoAutoBody",
    "featureStructureBody", "ctaBody",
  ] as const;

  const valueFor = (locale: string, key: string) =>
    landingBlocks[locale as (typeof LOCALES)[number]].match(
      new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    )?.[1];

  it("no locale silently falls back to the English sentence", () => {
    for (const key of PROSE) {
      const en = valueFor("en", key);
      expect(en, `en.${key} missing`).toBeTruthy();
      for (const locale of LOCALES.filter((l) => l !== "en")) {
        expect(valueFor(locale, key), `${locale}.${key} is still English`).not.toBe(en);
      }
    }
  });

  it("Indonesian prose does not leak into other locales", () => {
    // The Phase 189 finding: the page shipped Indonesian copy to every
    // language. These markers are distinctive Indonesian function words.
    const ID_MARKERS = [
      " yang ", " dengan ", " tidak ", " dan ", " bukan ", " untuk ", " bisa ",
    ];
    for (const locale of LOCALES.filter((l) => l !== "id")) {
      const joined = ` ${valuesOf(landingBlocks[locale]).join(" ")} `.toLowerCase();
      for (const marker of ID_MARKERS) {
        expect(joined, `${locale} contains Indonesian marker "${marker.trim()}"`).not.toContain(
          marker,
        );
      }
    }
  });

  it("the brand stays untranslated wherever it appears", () => {
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join(" ");
      if (joined.toLowerCase().includes("xstarz")) {
        expect(joined, `${locale} altered the brand`).toContain("Xstarz Analysis");
      }
    }
  });
});

// ════════════════ 3. NO OVERCLAIMING ════════════════

describe("190.3 — public copy never claims accuracy or profit", () => {
  /**
   * Forbidden across every locale. Matching is done on VALUES so a key name
   * can never trip the check, and each pattern is written per-language
   * because a translated overclaim is still an overclaim.
   */
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["guaranteed profit (en)", /guarantee[sd]?\s+(a\s+)?(profit|return|gain|win)/i],
    ["guaranteed accuracy (en)", /guarantee[sd]?\s+(accuracy|accurate)/i],
    ["win rate promise (en)", /\b(high|guaranteed|proven)\s+win[\s-]?rate\b/i],
    ["risk-free (en)", /\brisk[\s-]free\b/i],
    ["never loses (en)", /\bnever\s+lose/i],
    ["always profitable (en)", /\balways\s+profitab/i],
    ["profit guarantee (id)", /menjamin\s+(profit|keuntungan|laba)/i],
    ["profit guarantee (es)", /garantiza\s+(beneficios?|ganancias?|rentabilidad)/i],
    ["profit guarantee (fr)", /garantit\s+(un\s+)?(profit|gain|b[ée]n[ée]fice)/i],
    ["profit guarantee (pt)", /garante\s+(lucro|ganhos?)/i],
    ["profit guarantee (de)", /garantiert\s+(Gewinn|Profit)/i],
    ["profit guarantee (ja)", /利益を保証(?!し)/],
    ["profit guarantee (ko)", /수익을\s*보장(?!하지)/],
    ["profit guarantee (zh)", /保证(盈利|收益|获利)/],
  ];

  it("no locale promises profit, accuracy or a win rate", () => {
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      for (const [label, pattern] of FORBIDDEN) {
        expect(
          affirmativeClaims(joined, pattern),
          `${locale} contains ${label}`,
        ).toEqual([]);
      }
    }
  });

  it("the overclaim detector is not vacuous — it catches a planted claim", () => {
    // Without this, a broken regex or an over-eager negation window would let
    // every overclaim through and the suite above would pass on nothing.
    const PLANTED = [
      "Xstarz Analysis guarantees profit on every trade.",
      "Our engine guarantees accuracy for all setups.",
      "A proven win rate on every instrument.",
      "This is a risk-free way to trade.",
    ];
    const patterns = FORBIDDEN.map(([, p]) => p);
    for (const sentence of PLANTED) {
      const caught = patterns.some((p) => affirmativeClaims(sentence, p).length > 0);
      expect(caught, `detector missed: ${sentence}`).toBe(true);
    }
    // …and it must NOT fire on the honest negated form.
    const HONEST = [
      "It does not guarantee profit.",
      "Xstarz Analysis does not guarantee accuracy.",
      "Tidak menjamin keuntungan.",
    ];
    for (const sentence of HONEST) {
      const fired = patterns.some((p) => affirmativeClaims(sentence, p).length > 0);
      expect(fired, `detector false-positived on: ${sentence}`).toBe(false);
    }
  });

  it("every locale explicitly denies a profit guarantee", () => {
    // Denial is not optional: the disclaimer must state it.
    const DENIAL: Record<string, RegExp> = {
      en: /does not guarantee profit/i,
      id: /tidak menjamin keuntungan/i,
      es: /no garantiza beneficios/i,
      fr: /ne garantit aucun profit/i,
      pt: /não garante lucro/i,
      de: /garantiert keinen Gewinn/i,
      ja: /利益を保証せず/,
      ko: /수익을 보장하지 않/,
      zh: /不保证盈利/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} lacks a profit-guarantee denial`).toMatch(DENIAL[locale]);
    }
  });

  it("conviction is described as evidence agreement, not probability", () => {
    // Implementation: ConvictionLevel is "High" | "Medium" | "Low" — an
    // ordinal label, with no probability anywhere in the engine.
    const NOT_PROBABILITY: Record<string, RegExp> = {
      en: /not a win rate and not a probability/i,
      id: /bukan win rate dan bukan probabilitas/i,
      es: /no es una tasa de acierto ni una probabilidad/i,
      fr: /n'est ni un taux de r[ée]ussite ni une probabilit[ée]/i,
      pt: /não é taxa de acerto nem probabilidade/i,
      de: /weder eine Trefferquote noch eine Wahrscheinlichkeit/i,
      ja: /勝率でも確率でもありません/,
      ko: /승률도 확률도 아닙니다/,
      zh: /既不是胜率也不是概率/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} does not disclaim probability`).toMatch(
        NOT_PROBABILITY[locale],
      );
    }
  });

  it("no locale invents a security or regulatory claim", () => {
    const FORBIDDEN_TRUST = [
      /\bbank[\s-]grade\b/i, /\bmilitary[\s-]grade\b/i, /\bfully secure\b/i,
      /\bguaranteed safe\b/i, /\bSOC\s?2\b/i, /\bISO\s?27001\b/i,
      /\bGDPR[\s-]certified\b/i, /\bregulated by\b/i, /\blicensed broker\b/i,
      /\bFCA\b|\bSEC[\s-]registered\b/i, /\bWCAG[\s-]?(AA|AAA)?\s*(certified|compliant)\b/i,
    ];
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      for (const pattern of FORBIDDEN_TRUST) {
        expect(joined, `${locale} invents a trust claim ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("no locale claims institutional grade or unverifiable precision", () => {
    // Phase 190 removed "institutional-grade AI" and "presisi tinggi":
    // neither corresponds to a measurable implemented property.
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} claims institutional grade`).not.toMatch(
        /institutional[\s-]grade/i,
      );
      expect(joined, `${locale} claims high precision`).not.toMatch(
        /high[\s-]precision|presisi tinggi|alta precisi[óo]n/i,
      );
    }
  });
});

// ════════════════ 4. LIVE-DATA WORDING ════════════════

describe("190.4 — live-data claims match conditional reality", () => {
  it("no locale makes a blanket real-time guarantee", () => {
    // Providers are credential-gated (COINGLASS_API_KEY, TICKATLAS_API_KEY,
    // TWELVE_DATA_API_KEY) and can fail, so "always real-time" is false.
    const ABSOLUTE = [
      /\balways\s+(real[\s-]?time|live)\b/i,
      /\b(24\/7|around the clock)\s+(real[\s-]?time|live)\s+data\b/i,
      /\breal[\s-]?time\s+data\s+(for\s+)?(all|every)\b/i,
      /\bguaranteed\s+(live|real[\s-]?time)\b/i,
      /\buninterrupted\s+(live|real[\s-]?time)\b/i,
    ];
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      for (const pattern of ABSOLUTE) {
        expect(joined, `${locale} makes an absolute live claim`).not.toMatch(pattern);
      }
    }
  });

  it("flow/positioning data is described as conditional on the feed", () => {
    // coinglass.ts returns undefined legs when the key is absent or the call
    // fails, so this capability genuinely is conditional.
    const CONDITIONAL: Record<string, RegExp> = {
      en: /when those feeds are configured and responding/i,
      id: /bila feed tersebut dikonfigurasi dan merespons/i,
      es: /cuando esas fuentes est[áa]n configuradas y responden/i,
      fr: /lorsque ces flux sont configur[ée]s et r[ée]pondent/i,
      pt: /quando essas fontes est[ãa]o configuradas e respondem/i,
      de: /sofern diese Feeds konfiguriert sind und antworten/i,
      ja: /設定され応答している場合/,
      ko: /구성되어 응답할 때/,
      zh: /已配置并正常响应时/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} states flow data unconditionally`).toMatch(
        CONDITIONAL[locale],
      );
    }
  });

  it("every locale states the no-fabrication guarantee", () => {
    const NO_FAB: Record<string, RegExp> = {
      en: /never invented|says so/i,
      id: /tidak pernah dikarang|menyatakan hal itu/i,
      es: /nunca se inventan|lo indica/i,
      fr: /jamais invent[ée]s|le dit/i,
      pt: /nunca são inventados|diz isso/i,
      de: /nie erfunden|sagt das Ergebnis/i,
      ja: /作り出すことはありません|明示します/,
      ko: /만들어 내지 않습니다|밝힙니다/,
      zh: /绝不会为填补空缺而编造|如实说明/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} lacks the no-fabrication guarantee`).toMatch(NO_FAB[locale]);
    }
  });

  it("every locale states that no orders are placed", () => {
    const NO_EXEC: Record<string, RegExp> = {
      en: /places no orders|does not execute trades/i,
      id: /tidak menempatkan order|tidak mengeksekusi/i,
      es: /no coloca [óo]rdenes|no ejecuta operaciones/i,
      fr: /ne passe aucun ordre|n'ex[ée]cute pas/i,
      pt: /não coloca ordens|não executa negocia/i,
      de: /erteilt keine Orders|führt keine Trades aus/i,
      ja: /注文を出さず|取引を執行せず/,
      ko: /주문을 내지 않으며|거래를 실행하지 않/,
      zh: /不会下单|不执行交易/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} lacks the no-execution guarantee`).toMatch(NO_EXEC[locale]);
    }
  });
});

// ════════════════ 5. "ANY SYMBOL" CLAIM ════════════════

describe("190.5 — instrument coverage matches real capability", () => {
  it('the unconditional "any symbol" badge is gone', () => {
    // The old copy promised arbitrary symbol support. Acquisition is bounded
    // by what the configured providers return, so the promise was not true.
    expect(LANDING_SRC).not.toMatch(/\+\s*any symbol/i);
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} still promises any symbol`).not.toMatch(
        /\bany symbol\b|\bevery symbol\b|\ball symbols\b|instrumen apa pun\b/i,
      );
    }
  });

  it("coverage is explicitly conditional on provider response", () => {
    const CONDITIONAL: Record<string, RegExp> = {
      en: /depends on what the connected data providers return/i,
      id: /bergantung pada data yang dikembalikan penyedia data/i,
      es: /depende de lo que devuelvan los proveedores de datos/i,
      fr: /d[ée]pend de ce que les fournisseurs de donn[ée]es connect[ée]s renvoient/i,
      pt: /depende do que os provedores de dados conectados devolvem/i,
      de: /h[äa]ngt davon ab, was die verbundenen Datenanbieter/i,
      ja: /接続されたデータ提供元がその銘柄について返す内容/,
      ko: /연결된 데이터 제공자가 해당 심볼에 대해 반환하는 내용/,
      zh: /取决于已连接的数据提供方针对该品种返回的内容/,
    };
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} lacks the coverage caveat`).toMatch(CONDITIONAL[locale]);
    }
  });

  it("advertised asset classes are exactly those the UI can select", () => {
    // Truth source: the instrument-type <Select> in InstrumentInput.
    const input = read("src/components/InstrumentInput.tsx");
    const selectable = [...input.matchAll(/<SelectItem value="(forex|crypto|stock|commodity|indices)"/g)]
      .map((m) => m[1])
      .sort();
    expect(selectable).toEqual(["commodity", "crypto", "forex", "stock"]);

    // The landing page advertises exactly four asset-class keys.
    const advertised = LANDING_KEYS.filter((k) => k.startsWith("asset"));
    expect(advertised.length).toBe(selectable.length);
  });

  it("no index/futures example is advertised while indices is unselectable", () => {
    // `indices` is a valid backend type but absent from the UI selector, so
    // showing US30 would advertise a path the user cannot take.
    const input = read("src/components/InstrumentInput.tsx");
    const indicesSelectable = input.includes('<SelectItem value="indices"');
    if (!indicesSelectable) {
      expect(LANDING_SRC).not.toMatch(/\bUS30\b|\bNAS100\b|\bindex futures\b/i);
      for (const locale of LOCALES) {
        const joined = valuesOf(landingBlocks[locale]).join("\n");
        expect(joined, `${locale} advertises indices`).not.toMatch(
          /index futures|indeks berjangka|futuros de [íi]ndice/i,
        );
      }
    }
  });

  it("example symbols are labelled as examples, not as full coverage", () => {
    expect(LANDING_SRC).toContain("INSTRUMENT_EXAMPLES");
    const en = landingBlocks.en;
    expect(en).toMatch(/instrumentsLabel:\s*"\$ examples:"/);
  });
});

// ════════════════ 6. BRANDING / DEPENDENCY HYGIENE ════════════════

describe("190.6 — no retired branding or internals in public copy", () => {
  const PUBLIC_PAGES = [
    "src/pages/Landing.tsx",
    "src/pages/Auth.tsx",
    "src/pages/Download.tsx",
    "src/pages/NotFound.tsx",
  ];

  it("no retired Freebuff branding in public page source", () => {
    for (const page of PUBLIC_PAGES) {
      const src = read(page).toLowerCase();
      for (const term of ["freebuff", "vly.ai", "vly.sh"]) {
        expect(src, `${page} mentions ${term}`).not.toContain(term);
      }
    }
  });

  it("no retired branding in any locale's landing copy", () => {
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n").toLowerCase();
      for (const term of ["freebuff", "vly", "convex", "resend", "smtp2go", "twelve data"]) {
        expect(joined, `${locale} leaks ${term}`).not.toContain(term);
      }
    }
  });

  it("no environment variable name appears in public copy", () => {
    for (const locale of LOCALES) {
      const joined = valuesOf(landingBlocks[locale]).join("\n");
      expect(joined, `${locale} names an env var`).not.toMatch(/[A-Z][A-Z0-9]*_API_KEY|VITE_[A-Z_]+/);
    }
    for (const page of PUBLIC_PAGES) {
      expect(read(page), `${page} names an env var`).not.toMatch(
        /[A-Z][A-Z0-9]*_API_KEY/,
      );
    }
  });

  it("no development URL is referenced by a public page", () => {
    for (const page of PUBLIC_PAGES) {
      const src = read(page);
      expect(src, `${page} references localhost`).not.toMatch(/localhost:\d+|127\.0\.0\.1/);
    }
  });
});

// ════════════════ 7. METADATA ════════════════

describe("190.7 — public metadata is honest", () => {
  const html = read("index.html");

  it("the document title names the product and its nature", () => {
    expect(html).toMatch(/<title>[^<]*Xstarz Analysis[^<]*<\/title>/);
    expect(html.toLowerCase()).not.toContain("freebuff");
    expect(html.toLowerCase()).not.toContain("vly");
  });

  it("a description exists and claims nothing untrue", () => {
    const desc = html.match(/<meta\s+name="description"[\s\S]*?content="([^"]+)"/)?.[1];
    expect(desc, "no meta description").toBeTruthy();
    expect(desc!).toMatch(/decision[\s-]support/i);
    // No live-data claim at all, and any mention of profit/guarantee must be
    // a denial ("does not guarantee profit"), never an affirmative claim.
    expect(desc!).not.toMatch(/real[\s-]?time/i);
    expect(
      affirmativeClaims(desc!, /guarantee[sd]?\s+(a\s+)?(profit|return|accuracy)/i),
    ).toEqual([]);
  });

  it("no canonical URL or og:url invents a production domain", () => {
    // No domain is registered; a fabricated canonical would be a false claim
    // and would also break SEO once a real domain exists.
    expect(html).not.toMatch(/rel="canonical"/);
    expect(html).not.toMatch(/property="og:url"/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)[a-z0-9-]+\.(com|io|app|ai)/i);
  });

  it("the root document declares a language", () => {
    expect(html).toMatch(/<html[^>]+lang="[a-z]{2}"/);
  });
});

// ════════════════ 8. ACCESSIBILITY ════════════════

describe("190.8 — public page accessibility", () => {
  it("the landing page uses a single h1 and ordered sections", () => {
    expect((LANDING_SRC.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect((LANDING_SRC.match(/<h2[\s>]/g) ?? []).length).toBeGreaterThan(1);
  });

  it("no hardcoded aria-label survives on the landing page", () => {
    const hardcoded = [...LANDING_SRC.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(hardcoded, `hardcoded aria-labels: ${hardcoded.join(", ")}`).toEqual([]);
  });

  it("decorative icons are hidden from assistive technology", () => {
    // Emoji used as visual bullets must not be announced.
    expect(LANDING_SRC).toMatch(/aria-hidden="true"/);
  });

  it("interactive controls are real buttons, not clickable divs", () => {
    expect(LANDING_SRC).not.toMatch(/<div[^>]*onClick=/);
  });
});

// ════════════════ 9. LAYOUT RESILIENCE ════════════════

describe("190.9 — layout tolerates longer translations", () => {
  it("the weight rows no longer force nowrap", () => {
    // German and Portuguese labels are materially longer than the English
    // originals; `whitespace-nowrap` here produced horizontal overflow.
    const weightRow = LANDING_SRC.slice(
      LANDING_SRC.indexOf("weightStructure"),
      LANDING_SRC.indexOf("outputTechnicalLabel"),
    );
    expect(weightRow).not.toContain("whitespace-nowrap");
    expect(weightRow).toContain("min-w-0");
  });

  it("the hero badge can wrap instead of overflowing", () => {
    const badge = LANDING_SRC.slice(
      LANDING_SRC.indexOf("heroBadge") - 400,
      LANDING_SRC.indexOf("heroBadge") + 60,
    );
    expect(badge).toContain("whitespace-normal");
  });

  it("headings allow word breaking", () => {
    expect((LANDING_SRC.match(/break-words/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("icons beside text cannot be squashed", () => {
    expect((LANDING_SRC.match(/shrink-0/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("no fixed pixel width constrains translated text", () => {
    expect(LANDING_SRC).not.toMatch(/className="[^"]*\bw-\[\d+px\]/);
  });
});

// ════════════════ 10. LANDING IS FULLY LOCALIZED ════════════════

describe("190.10 — the landing page holds no hardcoded copy", () => {
  it("renders its text from the catalogue", () => {
    expect(LANDING_SRC).toContain("useI18n");
    expect((LANDING_SRC.match(/t\.landing\./g) ?? []).length).toBeGreaterThan(40);
  });

  it("every landing key is actually consumed — no dead keys", () => {
    // Phase 189 shipped `errors.checkApiKey` to nine locales with zero
    // consumers, leaking an internal env var name. A declared-but-unused key
    // is dead weight at best and an information leak at worst.
    const unused = LANDING_KEYS.filter((k) => !LANDING_SRC.includes(`t.landing.${k}`));
    expect(unused, `landing keys declared but never rendered: ${unused.join(", ")}`).toEqual([]);
  });

  it("no Indonesian prose remains in the component", () => {
    for (const marker of ["yang bisa", "tidak ada", "dengan setiap", "bukan zona"]) {
      expect(LANDING_SRC.toLowerCase(), `Landing still contains "${marker}"`).not.toContain(
        marker,
      );
    }
  });

  it("the only literal JSX text is the untranslatable brand", () => {
    const texts = [...LANDING_SRC.matchAll(/>([^<>{}]+)</g)]
      .map((m) => m[1].replace(/\s+/g, " ").trim())
      .filter((t) => /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t));
    expect([...new Set(texts)]).toEqual(["Xstarz Analysis"]);
  });
});
