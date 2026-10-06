import { assertDatabaseReady } from "../lib/database";
import { runDailyResearch } from "../lib/pipeline";

async function main() {
  await assertDatabaseReady();
  const result = await runDailyResearch();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Daily Absurdity research failed.", error);
  process.exitCode = 1;
});
