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

async function runAnalysis(targetPage, instrument, type, expectedTimeframe = "M5") {
  if (instrument === "BTC/USD") {
    const btc = targetPage.getByRole("button", { name: "BTC/USD", exact: true });
    if (await btc.count()) await btc.click();
  } else if (instrument === "XAU/USD") {
    const category = type === "crypto" ? "CRYPTO" : type === "commodity" ? "COMMODITIES" : type === "stock" ? "STOCKS" : "FOREX";
    await targetPage.getByRole("button", { name: category, exact: true }).click();
    const picker = targetPage.getByRole("combobox").first();
    await picker.click();
    const option = targetPage.getByRole("option").filter({ hasText: instrument }).first();
    await option.click();
  }

  const timeframeButton = targetPage.getByRole("button", { name: expectedTimeframe, exact: true });
  if (!(await timeframeButton.count()) || !(await timeframeButton.first().isVisible())) {
    throw new Error(`${instrument} production timeframe control missing: ${expectedTimeframe}`);
  }
  await timeframeButton.first().click();

  const run = targetPage.locator("button").filter({ hasText: /run analysis/i }).first();
  if (!(await run.count())) {
    const buttons = await targetPage.locator("button").allTextContents();
    throw new Error(`Run Analysis control is missing for ${instrument}. Rendered buttons: ${buttons.join(" | ")}`);
  }
  await run.click();

  await targetPage.waitForFunction((targetInstrument) => {
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
      visibleText.includes(`${targetInstrument} |`) &&
      visibleText.includes(`| ${targetTimeframe}`) &&
      visibleText.includes("BIAS:") &&
      visibleText.includes("Price:") &&
      !visibleText.includes("analyzing...")
    );
  }, { targetInstrument: instrument, targetTimeframe: expectedTimeframe }, { timeout });

  const body = await targetPage.locator("body").innerText();
  const priceLabel = targetPage.getByText("Price:", { exact: true });
  const sourceLabel = targetPage.getByText("Source:", { exact: true });
  const priceRow = await priceLabel.count() ? await priceLabel.first().locator("..").innerText() : "";
  const sourceRow = await sourceLabel.count() ? await sourceLabel.first().locator("..").innerText() : "";
  const priceMatch = priceRow.match(/Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  const sourceMatch = sourceRow.match(/Source:\s*(.+)$/i);
  const quality = /primary:\s*(GOOD|DEGRADED|INSUFFICIENT|STALE|UNAVAILABLE|INVALID)/i.exec(body)?.[1];

  const result = {
    instrument,
    price: priceMatch?.[1] ?? null,
    source: sourceMatch?.[1]?.trim() ?? null,
    primaryDataQuality: quality ?? null,
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

  await runAnalysis(page, "BTC/USD", "crypto", "M5");
  await runAnalysis(page, "XAU/USD", "commodity", "M5");

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
