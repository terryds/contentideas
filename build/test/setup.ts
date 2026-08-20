// Preloaded by bunfig.toml before any test file loads its imports — this must
// run before server/db/db.ts creates the singleton, so the whole suite works
// against a throwaway database.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.CONTENT_ENGINE_DATA_DIR = mkdtempSync(join(tmpdir(), "content-engine-test-"));

// `bun test` intentionally does not load .env.local (dotenv convention), but the
// live suite wants the X cookies stored there — load it explicitly, never
// overriding values already set in the environment.
const envLocal = join(import.meta.dir, "..", ".env.local");
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}
