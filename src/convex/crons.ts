import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// The worker checkpoints its universe/timeframe cursor and enforces a lease,
// so overlapping minute ticks skip instead of duplicating provider requests.
crons.interval(
  "persistent multi-asset market scan",
  { minutes: 1 },
  internal.marketRadarScheduler.runScheduledScan,
  {},
);

export default crons;
