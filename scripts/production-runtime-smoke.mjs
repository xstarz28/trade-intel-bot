import { chromium } from "playwright";

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

async function runAnalysis(targetPage, instrument, type, evidenceKey) {
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

  await targetPage.waitForFunction(() => {
    const visibleText = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      })
      .map((el) => el.textContent || "")
      .join("\n");
    return (
      visibleText.includes(`${instrument} |`) &&
      visibleText.includes("BIAS:") &&
      visibleText.includes("Price:") &&
      !visibleText.includes("analyzing...")
    );
  }, null, { timeout });

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

  await runAnalysis(page, "BTC/USD", "crypto", "btc");
  await runAnalysis(page, "XAU/USD", "commodity", "xau");

  // Google OAuth preflight: no credentials are entered. We only verify that
  // the production flow reaches Google's authorization endpoint rather than
  // stopping at Google's redirect_uri_mismatch error.
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
  if (mismatch) {
    throw new Error("Google OAuth production flow still reports redirect_uri_mismatch");
  }
  if (!evidence.googleOAuth.reachedAuthorizationEndpoint) {
    throw new Error(`Google OAuth did not reach accounts.google.com (final URL: ${googleUrl})`);
  }
  await googleContext.close();

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
  evidence.localStorageKeys = await page.evaluate(() => Object.keys(localStorage).catch?.(() => []));
  evidence.consoleErrors = consoleErrors.slice(-20);
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
