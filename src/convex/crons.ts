import { cronJobs } from "convex/server";

// Deliberately no market-wide discovery cron.
// Market data and intelligence are acquired only when a user requests an
// instrument analysis, keeping background Convex reads/writes at zero.

const crons = cronJobs();

export default crons;
