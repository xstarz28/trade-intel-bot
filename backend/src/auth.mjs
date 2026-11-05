import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;
const SESSION_COOKIE = "__Host-xstarz_session";
const STATE_COOKIE = "__Host-xstarz_oauth_state";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function parseCookies(header = "") {
  const cookies = new Map();
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return cookies;
}

function cookieName(name, production) {
  if (!production) return name.replace("__Host-", "");
  return name;
}

function serializeCookie(name, value, { production, maxAge, clear = false }) {
  const parts = [
    `${cookieName(name, production)}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (production) parts.push("Secure");
  if (typeof maxAge === "number") parts.push(`Max-Age=${maxAge}`);
  return parts.join("; ");
}

function appendCookie(response, cookie) {
  const existing = response.getHeader("Set-Cookie");
  const cookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  response.setHeader("Set-Cookie", [...cookies, cookie]);
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function redirect(response, target) {
  response.writeHead(302, {
    location: target,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  response.end();
}

export function isAllowedOrigin(request, env) {
  const origin = request.headers.origin;
  const configured = env.APP_ORIGIN?.trim();
  if (!origin) return env.NODE_ENV !== "production";
  if (!configured) return env.NODE_ENV !== "production";
  return origin === configured;
}

function createRateLimiter(maximum,windowMs) {
  const buckets=new Map();
  return (request)=>{
    const forwarded=request.headers["x-forwarded-for"];
    const address=(typeof forwarded==="string"?forwarded.split(",").at(-1).trim():"")||
      request.socket.remoteAddress||"unknown";
    const now=Date.now();
    let bucket=buckets.get(address);
    if(!bucket||now-bucket.startedAt>=windowMs) {
      bucket={startedAt:now,count:0};
      buckets.set(address,bucket);
    }
    if(bucket.count>=maximum) return false;
    bucket.count+=1;
    if(buckets.size>5000) {
      for(const [key,value] of buckets) {
        if(now-value.startedAt>=windowMs) buckets.delete(key);
      }
    }
    return true;
  };
}

function sessionUser(database, request, production) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies.get(cookieName(SESSION_COOKIE, production));
  if (!token || token.length < 40 || token.length > 256) return null;

  const now = Date.now();
  const row = database.raw.prepare(`
    SELECT u.id, u.name, u.image, u.email, u.is_anonymous, u.role, s.id AS session_id
    FROM auth_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(sha256(token), now);

  if (!row) {
    database.raw.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(sha256(token));
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    image: row.image,
    email: row.email,
    isAnonymous: Boolean(row.is_anonymous),
    role: row.role,
    sessionId: row.session_id,
  };
}

export function getAuthenticatedUser(database, request, env = process.env) {
  const user = sessionUser(database, request, env.NODE_ENV === "production");
  if (!user) return null;
  delete user.sessionId;
  return user;
}

function issueSession(database, response, userId, production) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  database.raw.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, sha256(token), expiresAt, now, now);

  appendCookie(
    response,
    serializeCookie(SESSION_COOKIE, token, {
      production,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    }),
  );
}

function clearSessionCookie(response, production) {
  appendCookie(
    response,
    serializeCookie(SESSION_COOKIE, "", {
      production,
      maxAge: 0,
      clear: true,
    }),
  );
}

function decodeJwtPart(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

export async function verifyGoogleIdToken(idToken, { clientId, nonce, fetchImpl = fetch }) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Google returned a malformed ID token.");

  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Google ID token uses an unsupported signing algorithm.");
  }

  const keysResponse = await fetchImpl("https://www.googleapis.com/oauth2/v3/certs", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!keysResponse.ok) throw new Error("Unable to retrieve Google's signing keys.");
  const keySet = await keysResponse.json();
  const jwk = keySet.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Google signing key was not found.");

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (!verifySignature("RSA-SHA256", signingInput, publicKey, signature)) {
    throw new Error("Google ID token signature is invalid.");
  }

  const audienceValid = claims.aud === clientId ||
    (Array.isArray(claims.aud) && claims.aud.includes(clientId));
  const authorizedPartyValid = !Array.isArray(claims.aud) ||
    claims.aud.length <= 1 || claims.azp === clientId;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAtValid = typeof claims.iat === "number" &&
    claims.iat <= nowSeconds + 60 &&
    claims.iat >= nowSeconds - 600;
  if (
    !["https://accounts.google.com", "accounts.google.com"].includes(claims.iss) ||
    !audienceValid ||
    !authorizedPartyValid ||
    typeof claims.exp !== "number" ||
    claims.exp <= nowSeconds ||
    !issuedAtValid ||
    claims.nonce !== nonce ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.email !== "string" ||
    claims.email_verified !== true
  ) {
    throw new Error("Google ID token claims failed validation.");
  }

  return {
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    name: typeof claims.name === "string" ? claims.name : claims.email,
    image: typeof claims.picture === "string" ? claims.picture : null,
  };
}

export function upsertGoogleUser(database, profile, currentUser = null) {
  const now = Date.now();
  const existing = database.raw.prepare(
    "SELECT id, google_subject FROM users WHERE google_subject = ? OR email = ? COLLATE NOCASE LIMIT 1",
  ).get(profile.subject, profile.email);

  if (existing?.google_subject && existing.google_subject !== profile.subject) {
    throw new Error("This email is already linked to a different Google account.");
  }

  // Preserve a guest's existing data by upgrading that same account when the
  // Google identity is not already attached to another account.
  if (currentUser?.isAnonymous) {
    if (existing && existing.id !== currentUser.id) {
      const error = new Error("This Google account already has a separate Trade Intel account.");
      error.code = "anonymous_account_link_conflict";
      throw error;
    }
    const result = database.raw.prepare(`
      UPDATE users
      SET name = ?, image = ?, email = ?, email_verified_at = ?, is_anonymous = 0,
          google_subject = ?, updated_at = ?
      WHERE id = ? AND is_anonymous = 1
    `).run(profile.name, profile.image, profile.email, now, profile.subject, now, currentUser.id);
    if (result.changes !== 1) {
      throw new Error("The anonymous account could not be linked safely.");
    }
    return currentUser.id;
  }

  if (existing) {
    database.raw.prepare(`
      UPDATE users
      SET name = ?, image = ?, email = ?, email_verified_at = ?, is_anonymous = 0,
          google_subject = ?, updated_at = ?
      WHERE id = ?
    `).run(profile.name, profile.image, profile.email, now, profile.subject, now, existing.id);
    return existing.id;
  }

  const userId = randomUUID();
  database.raw.prepare(`
    INSERT INTO users
      (id, name, image, email, email_verified_at, is_anonymous, role, google_subject, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 'user', ?, ?, ?)
  `).run(userId, profile.name, profile.image, profile.email, now, profile.subject, now, now);
  return userId;
}

export function createAuthHandler({ database, env = process.env, fetchImpl = fetch }) {
  const production = env.NODE_ENV === "production";
  const appOrigin = env.APP_ORIGIN?.trim() || "http://localhost:5173";
  const backendOrigin = env.PUBLIC_BASE_URL?.trim();
  const allowAnonymousSignIn=createRateLimiter(10,10*60*1000);
  const allowGoogleStart=createRateLimiter(20,10*60*1000);

  return async function handleAuthRequest(request, response, url) {
    const path = url.pathname;
    const method = request.method ?? "GET";

    if (!path.startsWith("/api/v1/auth/")) return false;

    if (request.headers.origin && !isAllowedOrigin(request, env)) {
      sendJson(response, 403, { error: "origin_not_allowed" });
      return true;
    }
    if (method === "POST" && !request.headers.origin && production) {
      sendJson(response, 403, { error: "origin_required" });
      return true;
    }

    if (method === "GET" && path === "/api/v1/auth/session") {
      const user = sessionUser(database, request, production);
      if (user) delete user.sessionId;
      sendJson(response, 200, { user });
      return true;
    }

    if (method === "POST" && path === "/api/v1/auth/anonymous") {
      const existingUser = sessionUser(database, request, production);
      if (existingUser) {
        delete existingUser.sessionId;
        sendJson(response, 200, { user: existingUser });
        return true;
      }
      if(!allowAnonymousSignIn(request)) {
        response.setHeader("retry-after","600");
        sendJson(response,429,{error:"anonymous_sign_in_rate_limited"});
        return true;
      }
      const now = Date.now();
      const userId = randomUUID();
      database.raw.prepare(`
        INSERT INTO users (id, name, email, is_anonymous, role, created_at, updated_at)
        VALUES (?, 'Guest Trader', NULL, 1, 'user', ?, ?)
      `).run(userId, now, now);
      issueSession(database, response, userId, production);
      sendJson(response, 201, {
        user: { id: userId, name: "Guest Trader", email: null, isAnonymous: true, role: "user" },
      });
      return true;
    }

    if (method === "POST" && path === "/api/v1/auth/logout") {
      const user = sessionUser(database, request, production);
      if (user) {
        database.raw.prepare("DELETE FROM auth_sessions WHERE id = ?").run(user.sessionId);
      }
      clearSessionCookie(response, production);
      sendJson(response, 200, { success: true });
      return true;
    }

    if (method === "GET" && path === "/api/v1/auth/google") {
      if(!allowGoogleStart(request)) {
        response.setHeader("retry-after","600");
        sendJson(response,429,{error:"google_sign_in_rate_limited"});
        return true;
      }
      const clientId = env.GOOGLE_CLIENT_ID?.trim();
      if (!clientId || !env.GOOGLE_CLIENT_SECRET?.trim() || !backendOrigin) {
        if ((request.headers.accept ?? "").includes("text/html")) {
          redirect(response, new URL("/auth?error=google_auth_not_configured", appOrigin).toString());
        } else {
          sendJson(response, 503, { error: "google_auth_not_configured" });
        }
        return true;
      }

      const now = Date.now();
      database.raw.prepare("DELETE FROM oauth_flows WHERE expires_at <= ?").run(now);
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      const challenge = base64url(createHash("sha256").update(verifier).digest());
      const expiresAt = now + OAUTH_FLOW_TTL_MS;
      database.raw.prepare(
        "INSERT INTO oauth_flows (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)",
      ).run(sha256(state), nonce, verifier, expiresAt);

      appendCookie(
        response,
        serializeCookie(STATE_COOKIE, state, {
          production,
          maxAge: Math.floor(OAUTH_FLOW_TTL_MS / 1000),
        }),
      );

      const callbackUrl = new URL("/api/v1/auth/google/callback", backendOrigin).toString();
      const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authorization.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }).toString();
      redirect(response, authorization.toString());
      return true;
    }

    if (method === "GET" && path === "/api/v1/auth/google/callback") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const cookies = parseCookies(request.headers.cookie);
      const stateCookie = cookies.get(cookieName(STATE_COOKIE, production));
      const flow = state
        ? database.raw.prepare("SELECT nonce, code_verifier, expires_at FROM oauth_flows WHERE state_hash = ?")
            .get(sha256(state))
        : null;

      appendCookie(
        response,
        serializeCookie(STATE_COOKIE, "", { production, maxAge: 0, clear: true }),
      );

      if (
        !stateCookie ||
        !state ||
        stateCookie !== state ||
        !flow ||
        flow.expires_at <= Date.now() ||
        !code
      ) {
        redirect(response, new URL("/auth?error=google_state_invalid", appOrigin).toString());
        return true;
      }

      database.raw.prepare("DELETE FROM oauth_flows WHERE state_hash = ?").run(sha256(state));

      try {
        const callbackUrl = new URL("/api/v1/auth/google/callback", backendOrigin).toString();
        const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: callbackUrl,
            grant_type: "authorization_code",
            code_verifier: flow.code_verifier,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const tokens = await tokenResponse.json();
        if (!tokenResponse.ok || typeof tokens.id_token !== "string") {
          throw new Error("Google authorization-code exchange failed.");
        }

        const profile = await verifyGoogleIdToken(tokens.id_token, {
          clientId: env.GOOGLE_CLIENT_ID,
          nonce: flow.nonce,
          fetchImpl,
        });
        const currentUser = sessionUser(database, request, production);
        const userId = upsertGoogleUser(database, profile, currentUser);
        issueSession(database, response, userId, production);
        redirect(response, new URL("/dashboard", appOrigin).toString());
      } catch (error) {
        console.error("[auth] Google sign-in failed:", error);
        const errorCode = error?.code === "anonymous_account_link_conflict"
          ? "account_link_conflict"
          : "google_auth_failed";
        redirect(response, new URL(`/auth?error=${errorCode}`, appOrigin).toString());
      }
      return true;
    }

    sendJson(response, 404, { error: "auth_route_not_found" });
    return true;
  };
}
