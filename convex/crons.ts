import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Auto-pass auction bidders who miss their 2h window so auctions can't stall.
crons.interval("auction-timeout", { seconds: 60 }, internal.game.advanceStaleAuctions);

export default crons;
