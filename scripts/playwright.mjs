import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(import.meta.resolve("@playwright/test/cli"));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0", NEXT_TELEMETRY_DISABLED: "1" },
});
process.exit(result.status ?? 1);
