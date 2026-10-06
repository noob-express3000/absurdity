import { assertDatabaseReady } from "../lib/database";

async function main() {
  const kind = await assertDatabaseReady();
  console.log(`Absurdity database ready (${kind}).`);
}

main().catch((error) => {
  console.error(
    "Absurdity database readiness check failed.",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
