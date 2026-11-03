import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Background discovery is intentionally paced for the Convex Free Plan.
// Each scan visit fans out into market-data and optional intelligence actions,
// then reads/writes persisted scanner state. A five-minute cadence reduces
// scheduled invocations and downstream database/provider work by 80% versus
// the former one-minute cadence while retaining continuous universe rotation.
crons.interval(
  "persistent multi-asset market scan",
  { minutes: 5 },
  internal.marketRadarScheduler.runScheduledScan,
  {},
);

export default crons;
