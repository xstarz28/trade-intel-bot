import { chromium } from "playwright";

const url = process.env.XSTARZ_SMOKE_URL || "https://xstarzanalysis.vercel.app";
const timeout = Number(process.env.XSTARZ_SMOKE_TIMEOUT_MS || 120000);

if (!/^https:\/\/[a-z0-9.-]+\.vercel\.app\/?$/i.test(url)) {
  throw new Error(`Refusing non-production Vercel target: ${url}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

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

  const guest = page.getByRole("button", { name: /continue without an account/i });
  if (await guest.count()) {
    await guest.click();
  }

  try {
    await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30000 });
  } catch {
    const authError = await page.locator("text=/Sign in failed|failed|error/i").allTextContents().catch(() => []);
    throw new Error(`Guest authentication did not reach /dashboard. Visible auth errors: ${authError.join(" | ") || "none"}; URL: ${page.url()}`);
  }
  evidence.authenticated = true;

  const btc = page.getByRole("button", { name: "BTC/USD", exact: true });
  if (!(await btc.count())) {
    const text = (await page.locator("body").innerText()).slice(0, 4000).replace(/\s+/g, " ");
    throw new Error(`BTC/USD quick-pick is missing from the running production UI. Body: ${text}`);
  }
  await btc.click();

  const run = page.getByRole("button", { name: /run analysis/i });
  if (!(await run.count())) throw new Error("Run Analysis control is missing from the running production UI");
  await run.click();

  await page.getByText(/BIAS:/i).first().waitFor({ state: "visible", timeout });

  const body = await page.locator("body").innerText();
  const sourceMatch = body.match(/Source:\s*([^\n]+)/i);
  const priceMatch = body.match(/Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);

  evidence.price = priceMatch?.[1] ?? null;
  evidence.source = sourceMatch?.[1]?.trim() ?? null;
  evidence.resultVisible = true;

  if (!evidence.price) throw new Error("Analysis rendered without a live price snapshot");
  if (!evidence.source || /^unknown$/i.test(evidence.source)) {
    throw new Error("Analysis rendered without a provider source");
  }

  const quality = /primary:\s*(GOOD|DEGRADED|INSUFFICIENT|STALE|UNAVAILABLE|INVALID)/i.exec(body)?.[1];
  if (!quality) throw new Error("Analysis rendered without its primary data-quality status");

  evidence.primaryDataQuality = quality;
  evidence.completedAt = new Date().toISOString();
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  evidence.completedAt = new Date().toISOString();
  console.error(JSON.stringify(evidence, null, 2));
  throw error;
} finally {
  await browser.close();
}
