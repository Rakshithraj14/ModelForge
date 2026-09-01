// Pushes a freshly trained baseline.json into a model's registry row.
// Usage: node scripts/set-baseline.mjs <model_id> <path/to/baseline.json> --local|--remote
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [modelId, jsonPath, flag] = process.argv.slice(2);
if (!modelId || !jsonPath || !["--local", "--remote"].includes(flag)) {
  console.error("Usage: node scripts/set-baseline.mjs <model_id> <path/to/baseline.json> --local|--remote");
  process.exit(1);
}

const baseline = readFileSync(jsonPath, "utf8").trim().replace(/'/g, "''");
const sqlPath = join(mkdtempSync(join(tmpdir(), "baseline-")), "set-baseline.sql");
writeFileSync(sqlPath, `UPDATE models SET baseline_json = '${baseline}' WHERE model_id = '${modelId}';`);

execFileSync("npx", ["wrangler", "d1", "execute", "model-doctor", flag, "--file", sqlPath], { stdio: "inherit" });
