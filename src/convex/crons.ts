/**
 * Phase 320 — the deployment's only scheduled lifecycle.
 *
 * A WEEKLY bounded retention sweep: drains any remaining legacy
 * `discoveryStageRows` in batches, reconciles superseded/abandoned staging,
 * and removes orphan chunks. It runs through the internal mutation that is
 * bounded, idempotent, safe on empty state, and restricted to the three
 * discovery-staging tables — never user/auth/business data. This is the
 * explicitly-safe scheduled lifecycle the retention policy names; nothing
 * triggers cleanup from a dashboard render, an analysis, a login or a
 * discovery cycle.
 *
 * NOTE on the reference: `internal` is Convex's anyApi proxy at runtime, so
 * `internal.discoveryRetention.…` resolves correctly in the deployed bundle
 * even before the checked-in generated `api.d.ts` is regenerated (codegen
 * needs control-plane access the sandbox does not have). The local cast keeps
 * the type checker honest without touching generated files.
 */
import { cronJobs } from "convex/server";
import type { FunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
export default crons;

const retentionSweep = (
  internal as unknown as {
    discoveryRetention: {
      runBoundedCleanupSweep: FunctionReference<"mutation", "internal">;
    };
  }
).discoveryRetention.runBoundedCleanupSweep;

crons.weekly(
  "discovery-retention-sweep",
  { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 0 },
  retentionSweep,
  {},
);
