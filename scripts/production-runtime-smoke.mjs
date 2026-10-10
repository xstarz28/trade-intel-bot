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
  productSurfaces: { chart: false, riskSizing: false },
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

  for (let index = 0; index < count; index += 1) {
    const candidate = forms.nth(index);
    const picker = candidate.locator('[data-slot="select-trigger"]').first();
    const timeframe = candidate.locator("button").filter({ hasText: new RegExp("^" + expectedTimeframe + "$") });
    if (
      (await picker.count()) > 0 &&
      (await timeframe.count()) > 0 &&
      (await timeframe.first().isVisible().catch(() => false))
    ) {
      return candidate;
    }
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

async function runAnalysis(targetPage, instrument, type, expectedTimeframe = "M5", useManualEntry = false) {
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
  if (type === "crypto") {
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
  await cryptoCategory.click();
  const instrumentPicker = page.getByRole("combobox").first();
  await instrumentPicker.click();
  await page.getByRole("option", { name: /BTC\/USD/i }).first().click();
  evidence.authenticated = true;

  // Real production coverage: one liquid instrument per supported market class.
  await runAnalysis(page, "BTC/USD", "crypto", "M5", true);
  await runAnalysis(page, "XAU/USD", "commodity", "M5");
  await runAnalysis(page, "EUR/USD", "forex", "M5");
  await runAnalysis(page, "AAPL", "stock", "M5");

  const missingMarketTypes = Object.entries(evidence.marketTypeCoverage)
    .filter(([, covered]) => !covered)
    .map(([marketType]) => marketType);
  if (missingMarketTypes.length > 0) {
    throw new Error("Production smoke missing successful analysis for market types: " + missingMarketTypes.join(", "));
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
