import { runDailyJobs } from "../src/server/services/jobs";

runDailyJobs()
  .then((r) => {
    console.log("Daily jobs complete:", r);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
