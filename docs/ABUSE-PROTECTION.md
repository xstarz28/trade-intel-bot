# Abuse protection

Phase 187. How the system resists free-unlimited abuse, and — just as
important — where that resistance ends.

---

## 1. Why the previous design was insufficient

Phase 185 shipped an in-memory `Map` limiter. It bounded OTP resends *per
action instance*. Convex runs many instances, so an attacker whose requests
landed on different instances received a fresh allowance from each: the
counters never met. Any control that must hold globally cannot live in process
memory.

---

## 2. Distributed limiter architecture

```
sign-in request
  -> auth provider callback (action)
       -> ctx.runMutation(otpLimiter.consumeResendAllowance)   [ATOMIC]
            -> read otpResendBuckets row by identityHash
            -> prune timestamps outside the rolling window
            -> decide (cooldown, then hourly ceiling)
            -> if allowed: append timestamp, write row
       -> if refused: throw, no email is sent
  -> send email
```

The authoritative state is a Convex table. Every instance reads and writes the
same row, so the allowance is global rather than per-process.

### Why a table and not `@convex-dev/rate-limiter`

The component would be the idiomatic choice. Installing one requires
`convex.config.ts` plus a codegen run against a live deployment, and the
control plane is unreachable from this environment (Phase 186). A table needs
no codegen because `dataModel.d.ts` derives its types from `schema.ts`. This
is the smallest mechanism actually available, and the call sites do not change
if it is swapped for the component later.

### State schema

| Field | Type | Purpose |
| --- | --- | --- |
| `identityHash` | `string` | SHA-256 hex of the normalised email. Indexed `by_identity`. |
| `sendTimestamps` | `number[]` | Send times inside the rolling window; pruned on every read. |
| `lastSendAt` | `number` | Most recent send, used for retention only. |

Key: `identityHash`. Normalisation lowercases and trims, so `User@X.com ` and
`user@x.com` share one bucket.

**No email address is stored.** Being precise about what the hash buys: the
space of email addresses is small enough to brute-force, so this is not
secrecy against an attacker holding the table. It does mean the table is not a
readable mailing list, and that diagnostics can reference an identity without
carrying the address.

### TTL and cleanup

Expiry is enforced **on read** by pruning, so a row that outlives its window
cannot grant or deny anything incorrectly. `purgeExpiredBuckets` deletes rows
older than two windows and is storage hygiene, not a security control. It
bounds its own work per invocation, so it cannot become a long transaction.

### Atomicity

Convex mutations are serializable transactions under optimistic concurrency
control. Two concurrent calls for the same identity conflict on the same row;
one commits, the other retries at a fresh timestamp and observes the committed
write.

This holds **only because check-and-record are one mutation**. A `check` query
followed by a separate `record` mutation would reopen the race — the gap
between them is not transactional. The limiter deliberately exports no public
query, so there is nothing to race against.

### Contention, failure and recovery

| Condition | Behaviour |
| --- | --- |
| Concurrent requests, same identity | Serialized by OCC; exactly one send permitted per cooldown |
| Concurrent requests, different identities | No contention — distinct rows |
| Hot key (sustained abuse of one address) | Array stays bounded by the hourly ceiling; one indexed read/write per attempt |
| Mutation write fails | Provider **fails closed**: refuses, sends nothing |
| Row missing or state lost | Next request starts a new window — availability is preserved, and the ceiling still applies from that point |

---

## 3. Selected policy, and why

| Setting | Value |
| --- | --- |
| Cooldown between sends | 60 seconds |
| Maximum sends per identity | 5 per rolling hour |
| Bucket retention | 2 hours |

**Cooldown 60s.** Shorter values help nobody: delivery itself takes seconds, so
a user who has not received a code in 20s usually still will. Much longer
punishes the common legitimate case — a typo'd address, or a code in spam —
and generates support load.

**Ceiling 5/hour.** The cooldown alone would still permit 60 messages an hour
to one address, which is a mail-bombing tool and a reputation risk. Five
absorbs a bad-luck case (first send, resend, retry after fixing a typo) while
capping sustained outbound volume.

**A rejected request does not extend the cooldown**, or a client retrying in a
loop would lock itself out indefinitely.

**A delivery failure does not refund the allowance.** Refunding would let an
attacker who can force provider errors retry without limit — the more
dangerous failure mode than one legitimate user waiting out a cooldown.

---

## 4. Failed verification attempts

Unchanged, deliberately. `@convex-dev/auth` already rate-limits failed
verification per identifier, deletes a code on use (so replay fails), enforces
expiry, and invalidates the previous code when a new one is issued. The
project sets `maxFailedAttempsPerHour = 5`.

Phase 187 adds **no second counter**. A competing counter would create a second
source of truth for authentication state, which is worse than the gap it fills.

---

## 5. Mandatory versus advisory controls

§12 requires this distinction, because failing closed on everything would let
a trivial counter outage take down sign-in.

| Control | Class | On failure |
| --- | --- | --- |
| Authentication (identity resolution) | Mandatory | Request refused |
| Entitlement consumption | Mandatory | Refused; no chargeable result |
| OTP resend limiter | Mandatory | **Fails closed** — refuses to send |
| Server-side provider acquisition | Mandatory | Degrades explicitly, never fabricates |
| Bucket purge / cleanup | Advisory | Logged as storage debt; no user impact |

"Cannot enforce abuse protection" and "cannot authenticate" are different
failures, but for OTP both end in a refusal — sending email is
security-sensitive and spends real reputation.

---

## 6. Free-trial abuse: attack models

| # | Attack | Result | Why |
| --- | --- | --- | --- |
| A | Account farming (many emails) | **Partially mitigated** | See boundary below |
| B | Session/storage reset | Prevented | Entitlement is keyed by server-resolved `userId`, never client storage |
| C | Concurrent race at the boundary | Prevented | Serializable mutation; exactly one consume |
| D | Direct mutation replay | Prevented | Every path resolves identity server-side; unauthenticated is refused |
| E | Forged plan / remaining / Premium | Prevented | `plan` resolved server-side; the mutation accepts only the recommendation |
| F | Device/platform switching | Prevented | Same `userId` across Web, Android, iOS, Windows |
| G | Stale frontend after exhaustion | Prevented | Server re-evaluates every request; returns LOCKED |

Chargeability comes from the engine's own output (`isProfitSignal`), never
from a client claim. WAIT and NO_TRADE are free; BUY/SELL/LONG/SHORT are
chargeable; an unrecognised value is **not** charged, by allowlist.

`grantPremium` is admin-gated and its patch deliberately omits
`profitSignalsUsed`, so an upgrade cannot clear prior usage.

---

## 7. Analysis flooding and provider amplification

No blanket per-request analysis throttle was added, and that is a decision
rather than an omission. §9 warns against rate-limiting all analysis if it
would harm legitimate users. The layering already present:

1. **Identity** — unauthenticated callers are refused before any provider work.
2. **Entitlement** — chargeable output is bounded per identity by the ledger.
3. **Bounded work** — the fan-out is a fixed literal list of legs. Client input
   cannot add legs, so a malformed payload cannot multiply provider traffic.
4. **Budgets** — per-provider timeouts (6–12s) under a 15s overall wave.
5. **Cache and single-flight** — repeated identical requests collapse.
6. **Early rejection** — missing instrument, type or timeframe returns
   `INVALID_INPUT` before acquisition.

There is no retry loop inside the fan-out, so no hidden amplification factor.

If real load ever shows free WAIT/NO_TRADE traffic is expensive, the right
control is a per-identity analysis frequency limit reusing this same durable
mechanism. That needs production evidence to size, which requires a
deployment.

---

## 8. Enumeration resistance

- The limiter is an **internal** mutation. A client cannot call it to probe
  whether an address recently requested a code.
- Its return value carries `allowed` and a wait time — never counters like
  "3 of 5 used", which would leak another identity's activity.
- The throttle message depends only on timing, never on whether an account
  exists.

---

## 9. Observability

Recorded without sensitive data: whether a request was throttled, whether
entitlement was exhausted, and contention outcomes. Identities appear only as
`identityHash`.

Never logged: OTP codes, API keys, session tokens, full email addresses,
authorization headers. The limiter contains no logging calls at all.

---

## 10. The anti-farming boundary

Stated plainly, because overclaiming here would be dishonest.

**Strongly prevented:** client counter tampering; entitlement replay;
concurrent double-consumption; forged Premium; skipped consumption;
local-storage reset; OTP resend bombing; unauthenticated direct invocation;
cross-device allowance duplication.

**Not prevented:** an attacker who registers many genuine email addresses.
Each new address is a new identity with its own free allowance. Defeating that
needs a stronger identity signal — payment, phone verification, or device
attestation — each of which is a product decision with real cost to legitimate
users, and none of which is in scope here.

The goal of this phase is to make **cheap automated abuse** difficult without
imposing KYC. This system does not claim Sybil resistance.

---

## 11. Evidence level

| Property | Evidence | Status |
| --- | --- | --- |
| Policy logic correct under serializable execution | C | PASS |
| Check-and-record atomic in one mutation | C | PASS |
| State shared across independent contexts | C | PASS (harness) |
| Fails closed on limiter failure | C | PASS (driven through the real provider) |
| Convex durability under real load | D | **NOT VERIFIED** |
| Multi-instance contention in production | D | **NOT VERIFIED** |
| Real provider load behaviour | D | **NOT VERIFIED** |

The harness reproduces Convex's serializable semantics and drives the real
policy module. It cannot prove Convex's own durability guarantees; those
remain deployment-dependent.
