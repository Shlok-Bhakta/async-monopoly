import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Async-game nudge: every 10 hours, ping whoever's turn it is in each active
// game so nobody forgets to play. No timers on turns themselves — this is a
// gentle reminder, not a deadline.
crons.interval("turn-nudge", { hours: 10 }, internal.notify.nudgeCurrentTurns);

export default crons;
