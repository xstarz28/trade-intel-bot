import { chromium, devices } from "playwright";

const url = process.env.XSTARZ_SMOKE_URL || "https://xstarzanalysis.vercel.app";
const timeout = Number(process.env.XSTARZ_SMOKE_TIMEOUT_MS || 120000);

if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app\/?$/i.test(url)) {
  throw new Error(`Refusing non-production Vercel target: ${url}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const authTraffic = [];
const convexTraffic = [];
const socketTraffic = [];
const consoleErrors = [];
const evidence = {
  target: url,
  startedAt: new Date().toISOString(),
  authenticated: false,
  analyses: [],
  marketTypeCoverage: { forex: false, crypto: false, stock: false, commodity: false },
  cryptoContractCoverage: { spot: false, perpetual: false, futures: false },
  productSurfaces: { chart: false, riskSizing: false, recommendations: false },
  googleOAuth: { checked: false, reachedAuthorizationEndpoint: false, redirectUriMismatch: false },
};

function wirePage(targetPage) {
  targetPage.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  targetPage.on("request", (req) => {
    if (/\/api\/auth\//i.test(req.url())) {
      authTraffic.push({ type: "request", method: req.method(), url: req.url() });
    }
  });
  targetPage.on("response", (res) => {
    if (/\/api\/auth\//i.test(res.url())) {
      authTraffic.push({
        type: "response",
        status: res.status(),
        url: res.url(),
        location: res.headers()["location"] ?? null,
      });
    }
    if (/convex\.(cloud|site)/i.test(res.url())) {
      convexTraffic.push({ status: res.status(), url: res.url() });
    }
  });
  targetPage.on("websocket", (ws) => {
    socketTraffic.push({ url: ws.url() });
    ws.on("close", () => socketTraffic.push({ closed: ws.url() }));
    ws.on("socketerror", (error) => socketTraffic.push({ error: String(error) }));
  });
}

wirePage(page);

async function findAnalysisForm(targetPage, expectedTimeframe) {
  const forms = targetPage.locator("form");
  const count = await forms.count();
  const styleName = /^(M1|M5|M15)$/i.test(expectedTimeframe) ? "Scalping" : /^(H1)$/i.test(expectedTimeframe) ? "Intraday" : "Swing";

  for (let index = 0; index < count; index += 1) {
    const candidate = forms.nth(index);
    const picker = candidate.locator('[data-slot="select-trigger"]').first();
    if ((await picker.count()) === 0) continue;

    // Horizon controls now precede timeframe controls. Select the horizon
    // first when its allowed timeframe is not currently visible.
    let timeframe = candidate.locator("button").filter({ hasText: new RegExp("^" + expectedTimeframe + "$") });
    if ((await timeframe.count()) === 0 || !(await timeframe.first().isVisible().catch(() => false))) {
      const styleButton = candidate.locator("button").filter({ hasText: new RegExp("^" + styleName + "$", "i") }).first();
      if (await styleButton.count()) await styleButton.click();
      timeframe = candidate.locator("button").filter({ hasText: new RegExp("^" + expectedTimeframe + "$") });
    }
    if ((await timeframe.count()) > 0 && await timeframe.first().isVisible().catch(() => false)) return candidate;
  }
  const diagnostics = [];
  for (let index = 0; index < count; index += 1) {
    const candidate = forms.nth(index);
    diagnostics.push(
      "form#" + index + ": comboboxes=" + (await candidate.locator('[data-slot="select-trigger"]').count()) + ", buttons=" + (await candidate.locator("button").allTextContents()).join(" | "),
    );
  }
  throw new Error(
    "Could not locate the visible instrument-analysis form with timeframe " + expectedTimeframe + ". " + (diagnostics.join(" || ") || "No forms found"),
  );
}

async function runAnalysis(targetPage, instrument, type, expectedTimeframe = "M5", useManualEntry = false, cryptoContractType = null) {
  // Anchor every interaction to the actual analysis form. A page-global
  // combobox can belong to a different surface and lead to an empty ancestor
  // form, which made the production smoke fail before submitting an analysis.
  const form = await findAnalysisForm(targetPage, expectedTimeframe);
  const categoryIndex = type === "forex" ? 0 : type === "crypto" ? 1 : type === "stock" ? 2 : 3;
  const categoryButtons = form.locator("button[type='button']");
  if ((await categoryButtons.count()) < 4) {
    throw new Error("Production instrument form is missing its four market-category controls");
  }
  await categoryButtons.nth(categoryIndex).click();

  if (type === "crypto" && cryptoContractType) {
    const marketTypes = form.getByTestId("crypto-market-type");
    if (!(await marketTypes.count())) {
      throw new Error("Crypto contract-type selector is missing from the live instrument form");
    }
    const filterName = cryptoContractType === "perpetual" ? /PERPETUAL \/ SWAP/i : /DATED FUTURES/i;
    const filterButton = marketTypes.getByRole("button", { name: filterName });
    if (!(await filterButton.count())) {
      throw new Error("Crypto market-type filter is missing: " + cryptoContractType);
    }
    await filterButton.click();
  }

  let selectedText = "";
  if (useManualEntry) {
    const toggle = form.getByTestId("manual-search-toggle");
    if (!(await toggle.count())) throw new Error("Manual search toggle is missing from the production instrument form");
    await toggle.click();
    const manualInput = form.getByTestId("manual-instrument-search");
    await manualInput.waitFor({ state: "visible", timeout: 10000 });
    await manualInput.click();
    await manualInput.pressSequentially(instrument, { delay: 20 });
    selectedText = await manualInput.inputValue();
    if (selectedText !== instrument) {
      throw new Error(`Manual search did not accept typed symbol ${instrument}; actual value: ${selectedText}`);
    }
    // Type and SELECT the actual catalog suggestion, not just the search text.
    // This verifies the manual ticker is resolved to its canonical asset class.
    const suggestion = form.getByRole("option").filter({ hasText: instrument }).first();
    await suggestion.waitFor({ state: "visible", timeout: 10000 });
    const suggestionText = await suggestion.innerText();
    if (!suggestionText.includes(instrument)) {
      throw new Error(`Manual search returned a mismatched suggestion for ${instrument}: ${suggestionText}`);
    }
    await suggestion.click();
    const selectedCanonicalSymbol = await manualInput.inputValue();
    if (selectedCanonicalSymbol !== instrument) {
      throw new Error(`Manual search selection changed the canonical symbol unexpectedly: ${selectedCanonicalSymbol}`);
    }
  } else {
    const picker = form.locator('[data-slot="select-trigger"]').first();
    await picker.click();
    const option = targetPage.getByRole("option").filter({ hasText: instrument }).first();
    await option.click();

    const selectedInstrument = form.locator('[data-slot="select-trigger"]').first();
    selectedText = await selectedInstrument.innerText().catch(() => "");
    if (!selectedText.includes(instrument)) {
      throw new Error(`${instrument} was not selected before analysis. Picker text: ${selectedText}`);
    }
  }

  const timeframeButton = form.locator("button").filter({ hasText: new RegExp("^" + expectedTimeframe + "$") });
  if (!(await timeframeButton.count()) || !(await timeframeButton.isVisible())) {
    const controls = await form.locator("button").allTextContents();
    throw new Error(`${instrument} production timeframe control missing: ${expectedTimeframe}. Form buttons: ${controls.join(" | ")}`);
  }
  await timeframeButton.click();

  // Submit the authoritative instrument form directly. The visible label is localized,
  // so text-matching a translated button is not a reliable production smoke control.
  const run = form.locator("button[type=\"submit\"]").first();
  if (!(await run.count())) {
    const buttons = await form.locator("button").allTextContents();
    throw new Error(`Run Analysis submit control is missing for ${instrument}. Form buttons: ${buttons.join(" | ")}`);
  }
  if (!(await run.isEnabled())) {
    throw new Error("".concat("Run Analysis submit control is disabled for ", instrument, ". Picker text: ", selectedText));
  }
  // Prefer the real browser click. If React did not consume the click (for
  // example while a Radix state transition is settling), fall back to the form
  // submit boundary without issuing a second analysis once the button disables.
  await run.click();
  await targetPage.waitForTimeout(750);
  const postClickState = {
    disabled: await run.isDisabled().catch(() => false),
    text: (await run.innerText().catch(() => "")).trim(),
  };
  if (!postClickState.disabled) {
    await run.evaluate((button) => {
      const form = button.closest("form");
      if (!form) throw new Error("Run Analysis submit control is not inside a form");
      form.requestSubmit(button);
    });
  }

  let analysisOutcome;
  try {
    const outcomeHandle = await targetPage.waitForFunction(({ targetInstrument, targetTimeframe }) => {
      // AnimatePresence can keep an exiting error panel in the DOM after it
      // is no longer visible. Only treat an on-screen, non-transparent panel
      // as a real analysis error.
      const errorPanel = Array.from(document.querySelectorAll('[data-analysis-error="true"]')).find((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0 &&
          Boolean((el.innerText || el.textContent || "").trim())
        );
      });
      if (errorPanel) return "error";

      const visibleText = Array.from(document.querySelectorAll("*"))
        .filter((el) => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
        })
        .map((el) => el.textContent || "")
        .join("\n");
      return (
        visibleText.includes(`${targetInstrument} |`) &&
        visibleText.includes(`| ${targetTimeframe}`) &&
        visibleText.includes("BIAS:") &&
        visibleText.includes("Price:") &&
        !visibleText.includes("analyzing...")
      ) ? "success" : false;
    }, { targetInstrument: instrument, targetTimeframe: expectedTimeframe }, { timeout });
    analysisOutcome = await outcomeHandle.jsonValue();
    await outcomeHandle.dispose();
  } catch (error) {
    const visibleState = await targetPage.locator("body").innerText().catch(() => "<body unavailable>");
    throw new Error(
      `${instrument} analysis produced neither a result nor a surfaced provider error within ${timeout}ms. Visible page state:\\n${visibleState.slice(-3500)}\\nOriginal wait error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (analysisOutcome !== "success") {
    const errorPanel = targetPage.locator('[data-analysis-error="true"]:visible').first();
    const diagnostic = await errorPanel.evaluate((el) => el.textContent?.trim() || el.innerText?.trim() || "").catch(() => "");
    const visibleState = await targetPage.locator("body").innerText().catch(() => "<body unavailable>");
    throw new Error(
      `${instrument} analysis failed visibly: ${diagnostic || "error panel has no readable text"}. Page state:\\n${visibleState.slice(-2500)}`,
    );
  }

  if (useManualEntry) {
    await form.getByTestId("manual-search-toggle").click();
  }

  const body = await targetPage.locator("body").innerText();
  const priceLabel = targetPage.getByText("Price:", { exact: true });
  const sourceLabel = targetPage.getByText("Source:", { exact: true });
  const priceRow = await priceLabel.count() ? await priceLabel.first().locator("..").innerText() : "";
  const sourceRow = await sourceLabel.count() ? await sourceLabel.first().locator("..").innerText() : "";
  const priceMatch = priceRow.match(/Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  const sourceMatch = sourceRow.match(/Source:\s*(.+)$/i);
  const quality = /primary:\s*(GOOD|DEGRADED|INSUFFICIENT|STALE|UNAVAILABLE|INVALID)/i.exec(body)?.[1];

  let cryptoIntelligence = null;
  // The supplemental crypto-intelligence panel is a spot dashboard surface.
  // Derivatives must still pass real price/provider/quality/chart checks, but
  // are not rejected simply because this optional spot-only panel is absent.
  if (type === "crypto" && (!cryptoContractType || cryptoContractType === "spot")) {
    const panel = targetPage.getByTestId("crypto-intelligence-panel");
    await panel.waitFor({ state: "visible", timeout: 10000 });
    const panelText = await panel.innerText();
    const headerText = await panel.locator("h4").locator("..").innerText().catch(() => "");
    const normalizedHeader = headerText.toLowerCase();
    const pickStatus = (values) => values.find((value) =>
      new RegExp("\\b" + value + "\\b", "i").test(normalizedHeader),
    ) ?? null;
    const missingIndex = panelText.toLowerCase().indexOf("missing intelligence");
    const summaryIndex = panelText.toLowerCase().indexOf("crypto intelligence is informational");
    const missingText = missingIndex < 0
      ? ""
      : panelText.slice(missingIndex + "missing intelligence".length, summaryIndex > missingIndex ? summaryIndex : undefined).trim();
    cryptoIntelligence = {
      panelVisible: true,
      overallAvailability: pickStatus(["full", "partial", "minimal", "unavailable"]),
      overallQuality: pickStatus(["verified", "degraded", "stale", "insufficient", "unavailable"]),
      providers: await (async () => {
        const status = async (name) => {
          const section = panel.locator('[data-provider="' + name + '"]').first();
          const visible = (await section.count()) > 0;
          return {
            visible,
            provider: visible ? await section.getAttribute("data-provider-name") : null,
            available: visible && (await section.getAttribute("data-provider-available")) === "true",
          };
        };
        return {
          derivatives: await status("derivatives"),
          defiLlama: await status("defillama"),
          tokenomist: await status("tokenomist"),
        };
      })(),
      missingInformation: missingText.slice(0, 1200),
      panelText: panelText.slice(0, 5000),
    };
  }

  const result = {
    instrument,
    instrumentType: type,
    timeframe: expectedTimeframe,
    price: priceMatch?.[1] ?? null,
    source: sourceMatch?.[1]?.trim() ?? null,
    primaryDataQuality: quality ?? null,
    cryptoIntelligence,
    resultText: body.slice(0, 7000),
    resultVisible: true,
  };

  if (!result.price) throw new Error(`${instrument} rendered without a price snapshot`);
  if (!result.source || /^unknown$/i.test(result.source)) {
    throw new Error(`${instrument} rendered without a provider source`);
  }
  if (!result.primaryDataQuality) {
    throw new Error(`${instrument} rendered without its primary data-quality status`);
  }
  if (["INVALID", "UNAVAILABLE"].includes(result.primaryDataQuality)) {
    throw new Error(`${instrument} primary data quality is ${result.primaryDataQuality}; a rendered card is not evidence of a usable market analysis.\\n${body.slice(-2400)}`);
  }
  if (!body.includes(`${instrument} |`)) {
    throw new Error(`${instrument} smoke captured a stale result from another instrument`);
  }

  if (!evidence.productSurfaces.chart) {
    const chart = targetPage.getByRole("img", { name: /provider OHLCV market structure chart/i });
    if (!(await chart.count())) {
      throw new Error(`${instrument} rendered without the provider OHLCV price-structure chart`);
    }
    evidence.productSurfaces.chart = true;
  }

  evidence.marketTypeCoverage[type] = true;
  evidence.analyses.push(result);
  return result;
}

/**
 * The production key is on an 8-credit/minute tier. The smoke exercises
 * several asset classes; a shared quota may be exhausted by earlier valid
 * analyses. Retry only explicit rate-limit/budget failures after the window
 * resets. Other failures remain hard failures.
 */
async function runAnalysisWithQuotaRetry(...args) {
  try {
    return await runAnalysis(...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/credits for the current minute|REQUEST_BUDGET|request budget|rate.?limit|\\[429\\]/i.test(message)) {
      throw error;
    }
    console.warn("Provider minute quota reached; waiting 65 seconds before one smoke retry.");
    await page.waitForTimeout(65_000);
    return runAnalysis(...args);
  }
}

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

  const start = page.getByRole("button", { name: /start analysis/i });
  if (!(await start.count())) throw new Error("Landing page did not expose Start analysis");
  await start.click();
  await page.getByText("XSTARZG Access", { exact: true }).waitFor({ state: "visible", timeout: 10000 });

  const guest = page.getByRole("button", { name: /continue without an account/i });
  if (!(await guest.count())) throw new Error("Auth page did not expose guest sign-in");
  await guest.click();

  const cryptoCategory = page.getByRole("button", { name: "CRYPTO", exact: true });
  await cryptoCategory.waitFor({ state: "visible", timeout: 30000 });

  // Wait for guest navigation to settle before asserting dashboard surfaces.
  const riskSizingHeading = page.getByText("$ risk-sizing", { exact: true });
  const equityInput = page.getByPlaceholder("1000", { exact: true });
  const riskPercentInput = page.getByPlaceholder("1.0", { exact: true });
  const accountCurrencyInput = page.getByPlaceholder("USD", { exact: true });
  evidence.productSurfaces.riskSizing =
    (await riskSizingHeading.count()) > 0 &&
    (await equityInput.count()) > 0 &&
    (await riskPercentInput.count()) > 0 &&
    (await accountCurrencyInput.count()) > 0 &&
    await riskSizingHeading.isVisible() &&
    await equityInput.isVisible() &&
    await riskPercentInput.isVisible() &&
    await accountCurrencyInput.isVisible();
  if (!evidence.productSurfaces.riskSizing) {
    throw new Error("Risk-sizing surface did not render all three user-owned account inputs after dashboard navigation.");
  }
  await cryptoCategory.click();
  const instrumentPicker = page.getByRole("combobox").first();
  await instrumentPicker.click();
  await page.getByRole("option", { name: /BTC\/USD/i }).first().click();
  evidence.authenticated = true;

  // Real production coverage: spot crypto + forex, commodity, and equity.
  await runAnalysisWithQuotaRetry(page, "BTC/USD", "crypto", "M5", true);
  evidence.cryptoContractCoverage.spot = true;
  await runAnalysisWithQuotaRetry(page, "XAU/USD", "commodity", "M5");
  await runAnalysisWithQuotaRetry(page, "EUR/USD", "forex", "M5");
  await runAnalysisWithQuotaRetry(page, "AAPL", "stock", "M5");

  // The scanner must render qualified recommendations or an explicit no-opportunity
  // state. Neutral discovery candidates must not masquerade as recommendations.
  const monitorList = page.getByTestId("market-monitoring-list");
  const qualifiedList = page.getByTestId("market-ranked-list");
  const noOpportunity = page.getByTestId("market-no-opportunity");
  evidence.productSurfaces.recommendations =
    (await monitorList.count()) > 0 ||
    (await qualifiedList.count()) > 0 ||
    (await noOpportunity.count()) > 0;
  if (!evidence.productSurfaces.recommendations) {
    throw new Error("Live scanner evaluated instruments but displayed neither qualified rankings nor monitor-only candidates.");
  }

  // Verify the real OKX SWAP selector, exact native contract, and OHLCV analysis.
  await runAnalysisWithQuotaRetry(page, "BTC-USDT-SWAP", "crypto", "M5", false, "perpetual");
  evidence.cryptoContractCoverage.perpetual = true;

  // Pick a currently available dated FUTURES contract from the production
  // discovery result, rather than assuming a specific expiry symbol exists.
  const form = await findAnalysisForm(page, "M5");
  const cryptoButton = form.getByRole("button", { name: "CRYPTO", exact: true });
  await cryptoButton.click();
  const futuresFilter = form.getByTestId("crypto-market-type")
    .getByRole("button", { name: /DATED FUTURES/i });
  await futuresFilter.click();
  await page.waitForTimeout(150);
  const pickerText = await form.locator('[data-slot="select-trigger"]').first().innerText();
  const futuresMatch = pickerText.match(/[A-Z0-9]+(?:[-_][A-Z0-9]+)*-\d{6}/);
  if (!futuresMatch) {
    throw new Error("Live OKX DATED FUTURES filter returned no selected contract. Picker text: " + pickerText);
  }
  await runAnalysisWithQuotaRetry(page, futuresMatch[0], "crypto", "M5", false, "futures");
  evidence.cryptoContractCoverage.futures = true;

  const missingMarketTypes = Object.entries(evidence.marketTypeCoverage)
    .filter(([, covered]) => !covered)
    .map(([marketType]) => marketType);
  if (missingMarketTypes.length > 0) {
    throw new Error("Production smoke missing successful analysis for market types: " + missingMarketTypes.join(", "));
  }
  const missingContractTypes = Object.entries(evidence.cryptoContractCoverage)
    .filter(([, covered]) => !covered)
    .map(([contractType]) => contractType);
  if (missingContractTypes.length > 0) {
    throw new Error("Production smoke missing successful real-crypto analysis for contract types: " + missingContractTypes.join(", "));
  }

  evidence.completedAt = new Date().toISOString();
  evidence.authTraffic = authTraffic;
  evidence.convexTraffic = convexTraffic.slice(-40);
  evidence.socketTraffic = socketTraffic.slice(-30);
  evidence.cookies = (await context.cookies()).map(({ name, domain, path }) => ({ name, domain, path }));
  evidence.localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  evidence.consoleErrors = consoleErrors.slice(-20);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  evidence.authTraffic = authTraffic;
  evidence.convexTraffic = convexTraffic.slice(-40);
  evidence.socketTraffic = socketTraffic.slice(-30);
  evidence.cookies = (await context.cookies()).map(({ name, domain, path }) => ({ name, domain, path }));
  evidence.consoleErrors = consoleErrors.slice(-20);
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
