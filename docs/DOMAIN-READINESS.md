# Domain readiness

Phase 186. Single authoritative checklist for everything that becomes
unblocked the moment a real domain exists.

**No domain has been purchased.** This document does not name one. Every
placeholder below is written `<domain>` and must be replaced with the real
value by the operator — never invented by an automated change.

Current status: **BLOCKED — no registered domain.**

---

## 1. Why one domain unblocks several unrelated things

The same hostname is required by four independent subsystems. They are listed
together because buying one domain clears all four at once, and because
choosing a different host for any of them later is expensive.

| Consumer | What it needs | Currently |
| --- | --- | --- |
| ~~Email OTP~~ | ~~A verified sender domain with SPF/DKIM/DMARC~~ | **RETIRED (Phase 270)** — no email auth path exists; a sender domain is no longer a prerequisite for anything |
| Web app | An HTTPS origin serving the SPA | BLOCKED |
| Convex auth | `CONVEX_SITE_URL` matching the deployed origin | BLOCKED |
| Android App Links / iOS Universal Links | A domain serving `assetlinks.json` / AASA | BLOCKED |

---

## 2. Sender domain DNS

> **RETIRED — Phase 270.** There is no OTP delivery anymore (the email-OTP
> sign-in path was removed). The procedure below is preserved for the day the
> project acquires a domain for the *site* — it may still be useful if any
> future transactional-mail need returns, but today there is no requirement.

A subdomain dedicated to transactional mail is recommended (for example
`mail.<domain>`), so that a future marketing sender cannot damage the
reputation that OTP delivery depended on.

| Record | Host | Purpose | Status |
| --- | --- | --- | --- |
| SPF (TXT) | `mail.<domain>` | Authorises the provider's servers to send | NOT VERIFIED |
| DKIM (CNAME/TXT) | Provider-specified selector | Signs outbound mail | NOT VERIFIED |
| DMARC (TXT) | `_dmarc.<domain>` | Declares policy and collects reports | NOT VERIFIED |
| MX | `mail.<domain>` | Only if inbound/bounce handling is wanted | NOT VERIFIED |

Sequence, once the domain exists:

1. Add the sending domain in the provider dashboard (Resend by default).
2. Publish the SPF record the provider specifies. One SPF record per host —
   merge, never add a second.
3. Publish the DKIM records exactly as generated.
4. Publish DMARC starting at `p=none` with an `rua=` reporting address.
   Tighten to `p=quarantine` only after reports show authenticated mail.
5. Wait for the provider to report the domain **verified**. Do not set the
   sender address before this: sends will fail, and failures against an
   unverified domain harm reputation.
6. Set `XSTARZ_EMAIL_SENDER_ADDRESS=no-reply@mail.<domain>`.
7. Send a real OTP and confirm **inbox placement**, not merely an HTTP 200.

DMARC tightening is deliberately staged. Jumping straight to `p=reject` before
DKIM is confirmed causes silent delivery loss, which for OTP mail is
indistinguishable from the product being broken.

---

## 3. Application origins

| Setting | Value once the domain exists | Status |
| --- | --- | --- |
| Web origin | `https://<domain>` | NOT VERIFIED |
| `CONVEX_SITE_URL` | The deployed Convex site origin | NOT VERIFIED |
| `VITE_CONVEX_URL` | The deployed Convex cloud URL | NOT VERIFIED |

`CONVEX_SITE_URL` is also the **self-issuer** that production trusts for JWTs
(see `docs/AUTHENTICATION.md`). If it does not match the deployed origin,
sign-in fails — and under Phase 185b policy it fails closed rather than
falling back to an external issuer.

---

## 4. Required public routes

These already render locally and are asserted by the route tests. They remain
unverified in production only because no production origin exists.

| Route | Purpose | Local | Production |
| --- | --- | --- | --- |
| `/` | Landing | PASS | NOT VERIFIED |
| `/download` | App downloads; both channels currently render unavailable | PASS | NOT VERIFIED |
| `/privacy` | Privacy policy — required by both app stores | PASS | NOT VERIFIED |
| `/terms` | Terms of service — required by both app stores | PASS | NOT VERIFIED |

Store review rejects listings whose privacy policy URL 404s, so these must
return HTTP 200 with `text/html` from the real origin before any submission.

---

## 5. Deep-link association files

| File | Path | Blocker |
| --- | --- | --- |
| Android App Links | `/.well-known/assetlinks.json` | Needs the release signing certificate SHA-256 |
| iOS Universal Links | `/.well-known/apple-app-site-association` | Needs the Apple Team ID |

Both currently contain the placeholders `REPLACE_WITH_RELEASE_CERT_SHA` and
`REPLACE_WITH_APPLE_TEAM_ID`. These must be replaced only with real values
produced by the actual signing material. A plausible-looking fake value
produces association files that silently fail to verify on device.

Both must be served over HTTPS with `Content-Type: application/json` and no
redirect. Verified locally; NOT VERIFIED in production.

---

## 6. Verification commands

Run these **against the real domain** once it exists. Recording their output is
what converts the rows above from NOT VERIFIED to PASS.

```bash
# DNS authentication records
dig +short TXT mail.<domain>                 # SPF
dig +short TXT <selector>._domainkey.<domain> # DKIM
dig +short TXT _dmarc.<domain>               # DMARC

# Public routes must be 200 text/html
for p in / /download /privacy /terms; do
  curl -sI "https://<domain>$p" | head -1
done

# Association files must be 200 application/json
curl -sI https://<domain>/.well-known/assetlinks.json | head -2
curl -sI https://<domain>/.well-known/apple-app-site-association | head -2
```

---

## 7. Status summary

| Item | Status |
| --- | --- |
| Domain registered | BLOCKED |
| SPF / DKIM / DMARC published | BLOCKED (needs domain) |
| Provider domain verified | BLOCKED (needs domain + provider account) |
| Production origin serving the SPA | BLOCKED (needs domain) |
| `CONVEX_SITE_URL` matching production | BLOCKED (needs Convex deployment) |
| App Links / Universal Links verified | BLOCKED (needs domain + signing material) |

None of these are code defects. All are operator provisioning steps.
