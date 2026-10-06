import { chromium } from "playwright";

const url = process.env.XSTARZ_SMOKE_URL || "https://xstarzanalysis.vercel.app";
const timeout = Number(process.env.XSTARZ_SMOKE_TIMEOUT_MS || 120000);

if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app\/?$/i.test(url)) {
  throw new Error(`Refusing non-production Vercel target: ${url}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("request", (req) => {
  if (/\/api\/auth\//i.test(req.url())) authTraffic.push({ type: "request", method: req.method(), url: req.url() });
});
page.on("response", (res) => {
  if (/\/api\/auth\//i.test(res.url())) authTraffic.push({ type: "response", status: res.status(), url: res.url(), location: res.headers()["location"] ?? null });
  if (/convex\.(cloud|site)/i.test(res.url())) convexTraffic.push({ status: res.status(), url: res.url() });
});
page.on("websocket", (ws) => {
  socketTraffic.push({ url: ws.url() });
  ws.on("close", () => socketTraffic.push({ closed: ws.url() }));
  ws.on("socketerror", (error) => socketTraffic.push({ error: String(error) }));
});

const authTraffic = [];
const convexTraffic = [];
const socketTraffic = [];
const consoleErrors = [];
const evidence = {
  target: url,
  startedAt: new Date().toISOString(),
  authenticated: false,
  instrument: "BTC/USD",
  price: null,
  source: null,
  resultVisible: false,
};

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

  await btc.click();
  const run = page.getByRole("button", { name: /run analysis/i });
  if (!(await run.count())) throw new Error("Run Analysis control is missing from the running production UI");
  await run.click();

  await page.waitForFunction(() => {
    const visibleText = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0;
      })
      .map((el) => el.textContent || "")
      .join("\n");
    return visibleText.includes("BIAS:") && visibleText.includes("Price:");
  }, null, { timeout });

  const body = await page.locator("body").innerText();
  const priceLabel = page.getByText("Price:", { exact: true });
  const sourceLabel = page.getByText("Source:", { exact: true });
  const priceRow = await priceLabel.count() ? await priceLabel.first().locator("..").innerText() : "";
  const sourceRow = await sourceLabel.count() ? await sourceLabel.first().locator("..").innerText() : "";
  const priceMatch = priceRow.match(/Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
  const sourceMatch = sourceRow.match(/Source:\s*(.+)$/i);

  evidence.price = priceMatch?.[1] ?? null;
  evidence.source = sourceMatch?.[1]?.trim() ?? null;
  evidence.resultText = body.slice(0, 7000);
  evidence.resultVisible = true;

  if (!evidence.price) throw new Error("Analysis rendered without a live price snapshot");
  if (!evidence.source || /^unknown$/i.test(evidence.source)) {
    throw new Error("Analysis rendered without a provider source");
  }

  const quality = /primary:\s*(GOOD|DEGRADED|INSUFFICIENT|STALE|UNAVAILABLE|INVALID)/i.exec(body)?.[1];
  if (!quality) throw new Error("Analysis rendered without its primary data-quality status");

  evidence.primaryDataQuality = quality;
  evidence.completedAt = new Date().toISOString();
  evidence.authTraffic = authTraffic;
  evidence.convexTraffic = convexTraffic.slice(-30);
  evidence.socketTraffic = socketTraffic.slice(-20);
  evidence.cookies = (await page.context().cookies()).map(({name,domain,path}) => ({name,domain,path}));
  evidence.localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  evidence.consoleErrors = consoleErrors.slice(-20);
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  evidence.authTraffic = authTraffic;
  evidence.convexTraffic = convexTraffic.slice(-30);
  evidence.socketTraffic = socketTraffic.slice(-20);
  evidence.cookies = (await page.context().cookies()).map(({name,domain,path}) => ({name,domain,path}));
  evidence.localStorageKeys = await page.evaluate(() => Object.keys(localStorage));
  evidence.consoleErrors = consoleErrors.slice(-20);
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await browser.close();
}
