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

async function runAnalysis(targetPage, instrument, type) {
  if (instrument === "BTC/USD") {
    const btc = targetPage.getByRole("button", { name: "BTC/USD", exact: true });
    if (await btc.count()) await btc.click();
  } else if (instrument === "XAU/USD") {
    const quick = targetPage.getByRole("button", { name: "XAU/USD", exact: true });
    if (await quick.count()) {
      await quick.click();
    } else {
      const input = targetPage.locator('input[placeholder="EUR/USD"]').first();
      await input.fill(instrument);
      const combos = targetPage.getByRole("combobox");
      await combos.nth(1).click();
      await targetPage.getByRole("option", { name: type, exact: true }).click();
    }
  }

  const run = targetPage.getByRole("button", { name: /run analysis/i });
  if (!(await run.count())) throw new Error(`Run Analysis control is missing for ${instrument}`);
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
      visibleText.includes("BIAS:") &&
      visibleText.includes("Price:") &&
      !visibleText.includes("analyzing...")
    );
  }, instrument, { timeout });

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
    const chart = targetPage.getByRole("img", { name: /provider OHLCV price structure chart/i });
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

  const btc = page.getByRole("button", { name: "BTC/USD", exact: true });
  await btc.waitFor({ state: "visible", timeout: 30000 });
  evidence.authenticated = true;

  const riskSizing = page.getByText("$ risk-sizing", { exact: true });
  if (!(await riskSizing.count())) throw new Error("Dashboard does not expose the risk-sizing control");
  await riskSizing.click();
  const equity = page.locator('input[placeholder="1000"]');
  const riskPct = page.locator('input[placeholder="1.0"]');
  const accountCcy = page.locator('input[placeholder="USD"]');
  if ((await equity.count()) !== 1 || (await riskPct.count()) !== 1 || (await accountCcy.count()) !== 1) {
    throw new Error("Risk-sizing inputs are incomplete");
  }
  await equity.fill("1000");
  await riskPct.fill("1");
  await accountCcy.fill("USD");
  evidence.productSurfaces.riskSizing = true;

  await runAnalysis(page, "BTC/USD", "crypto");
  await runAnalysis(page, "XAU/USD", "commodity");

  const googleContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const googlePage = await googleContext.newPage();
  wirePage(googlePage);
  await googlePage.goto(url, { waitUntil: "domcontentloaded", timeout });
  await googlePage.getByRole("button", { name: /start analysis/i }).click();
  await googlePage.getByText("XSTARZG Access", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await googlePage.getByRole("button", { name: /continue with google/i }).click();
  await googlePage.waitForTimeout(5000);
  const googleText = await googlePage.locator("body").innerText().catch(() => "");
  const googleUrl = googlePage.url();
  const mismatch = /redirect_uri_mismatch|Error 400|Access blocked/i.test(googleText) || /redirect_uri_mismatch/i.test(googleUrl);
  evidence.googleOAuth = {
    checked: true,
    finalUrl: googleUrl,
    reachedAuthorizationEndpoint: /accounts\.google\.com/i.test(googleUrl),
    redirectUriMismatch: mismatch,
  };
  if (mismatch) throw new Error("Google OAuth production flow still reports redirect_uri_mismatch");
  if (!evidence.googleOAuth.reachedAuthorizationEndpoint) {
    throw new Error(`Google OAuth did not reach accounts.google.com (final URL: ${googleUrl})`);
  }
  await googleContext.close();

  // Android-sized smoke: validate the initial/mobile path without consuming
  // the provider rate budget needed by the desktop BTC/XAU assertions.
  const mobileContext = await browser.newContext({ ...devices["Pixel 5"] });
  const mobilePage = await mobileContext.newPage();
  wirePage(mobilePage);
  await mobilePage.goto(url, { waitUntil: "domcontentloaded", timeout });
  await mobilePage.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  const brandLogo = mobilePage.locator('img[alt="XSTARZG"]');
  if (!(await brandLogo.count()) || !(await brandLogo.first().isVisible())) {
    throw new Error("Mobile production surface did not render the XSTARZG brand logo");
  }
  const instrumentCountText = await mobilePage.locator("text=/\\d{1,3}(?:,\\d{3})* instruments available/").first().textContent().catch(() => null);
  const instrumentCount = Number((instrumentCountText ?? "").replace(/[^0-9]/g, ""));
  if (!Number.isFinite(instrumentCount) || instrumentCount < 1000) {
    throw new Error(`Mobile production universe unexpectedly small: ${instrumentCountText ?? "missing"}`);
  }
  for (const timeframe of ["M1", "M5", "M15", "H1", "H4", "D1", "W1"]) {
    const option = mobilePage.locator(`option[value="${timeframe}"], [role="option"]:has-text("${timeframe}")`).first();
    if (!(await option.count())) throw new Error(`Mobile production timeframe missing: ${timeframe}`);
  }

  const mobileStart = mobilePage.getByRole("button", { name: /start analysis/i });
  if (!(await mobileStart.count()) || !(await mobileStart.first().isVisible())) {
    throw new Error("Mobile production surface did not render Start analysis");
  }
  await mobileStart.click();
  await mobilePage.getByText("XSTARZG Access", { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const mobileGuest = mobilePage.getByRole("button", { name: /continue without an account/i });
  if (!(await mobileGuest.count()) || !(await mobileGuest.first().isVisible())) {
    throw new Error("Mobile auth surface did not render guest sign-in");
  }
  await mobileGuest.click();
  await mobilePage.getByRole("button", { name: "BTC/USD", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await mobileContext.close();

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
