type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): unknown;
};

const ALLOWED_MODELS = new Set([
  "claude-opus-4-8",
  "claude-opus-5",
  "deepseek-v4-flash",
  "gpt-6-astra",
]);

const MAX_BODY_CHARS = 24_000;
const MAX_MESSAGE_CHARS = 12_000;
const ALLOWED_ORIGINS = new Set([
  "https://xstarzanalysis.vercel.app",
  "https://trade-intel-bot.vercel.app",
  "https://xstarzanalysis-xstarz.vercel.app",
]);

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Browser requests must originate from one of the production app domains.
  // Non-browser clients without Origin are rejected too; this endpoint is for the app.
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const apiKey = process.env.AGENTROUTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "AI provider is not configured" });
  }

  let body: unknown = req.body;
  if (typeof body === "string") {
    if (body.length > MAX_BODY_CHARS) {
      return res.status(413).json({ error: "Request is too large" });
    }
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "A JSON object is required" });
  }

  const input = body as Record<string, unknown>;
  const model = input.model;
  const messages = input.messages;
  const maxTokens = input.max_tokens;

  if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
    return res.status(400).json({ error: "Unsupported model" });
  }

  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 24 ||
    !messages.every(
      (message): message is ChatMessage =>
        !!message &&
        typeof message === "object" &&
        ["system", "user", "assistant"].includes(
          (message as ChatMessage).role,
        ) &&
        typeof (message as ChatMessage).content === "string" &&
        (message as ChatMessage).content.length <= MAX_MESSAGE_CHARS,
    )
  ) {
    return res.status(400).json({ error: "Invalid messages payload" });
  }

  const tokenLimit =
    typeof maxTokens === "number" && Number.isInteger(maxTokens)
      ? Math.min(Math.max(maxTokens, 1), 2048)
      : 1024;

  try {
    const upstream = await fetch("https://co.agentrouter.org/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: tokenLimit,
        stream: false,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const payload = (await upstream.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!upstream.ok) {
      // Do not forward upstream details that could disclose account/provider internals.
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({
        error:
          upstream.status === 401
            ? "AgentRouter rejected the API key"
            : upstream.status === 429
              ? "AgentRouter rate limit or quota reached"
              : "AgentRouter request failed",
      });
    }

    if (!payload || !Array.isArray(payload.choices)) {
      return res.status(502).json({ error: "Unexpected AI provider response" });
    }

    return res.status(200).json({
      id: payload.id,
      model: payload.model ?? model,
      choices: payload.choices,
      usage: payload.usage,
    });
  } catch {
    return res.status(502).json({ error: "Could not reach AgentRouter" });
  }
}
