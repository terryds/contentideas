import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../server/db/db";
import { migrate } from "../server/db/migrate";

/** Migrate the shared test DB and wipe all rows — call in beforeEach. */
export function resetDb(): void {
  migrate();
  db.exec(
    "DELETE FROM cluster_entries; DELETE FROM clusters; DELETE FROM threads; DELETE FROM entries; " +
      "DELETE FROM run_sources; DELETE FROM runs; DELETE FROM sources; DELETE FROM settings;",
  );
  migrate(); // reseed default settings
}

/**
 * Deterministic stand-in for the claude CLI's structured-output mode: emits the
 * `--output-format json` envelope with a `structured_output` matching whichever
 * contract the prompt asks for (generator prompts start "You write Twitter
 * threads"; everything else gets a filter verdict). Point
 * CONTENT_ENGINE_CLAUDE_BIN at the returned path.
 */
export function claudeStubPath(): string {
  const path = join(process.env.CONTENT_ENGINE_DATA_DIR!, "claude-stub.sh");
  writeFileSync(
    path,
    `#!/bin/sh
input=$(cat)
if printf '%s' "$input" | grep -q "You write Twitter threads"; then
  echo '{"is_error":false,"subtype":"success","structured_output":{"tweets":["Stub tweet one about the story.","Stub tweet two with a detail.","Stub tweet three, the takeaway."]}}'
elif printf '%s' "$input" | grep -q "chief content editor"; then
  # Ranker: pick the first two candidate keys found in the prompt, in order.
  picks=$(printf '%s' "$input" | grep -oE '"(entry|cluster):[0-9]+"' | head -2 | while read -r k; do
    printf '{"key":%s,"why":"stub says this one stands out"},' "$k"
  done)
  echo "{\\"is_error\\":false,\\"subtype\\":\\"success\\",\\"structured_output\\":{\\"picks\\":[\${picks%,}]}}"
else
  echo '{"is_error":false,"subtype":"success","structured_output":{"matched":true,"reason":"stub filter says this fits","topics":["stub-story","stub-entity"],"tags":["stub-tag","invented-tag"],"score":7}}'
fi
`,
  );
  chmodSync(path, 0o755);
  return path;
}

export interface FixtureServer {
  url: string;
  setBody(body: string, contentType?: string): void;
  requests: number;
  stop(): void;
}

/** Tiny localhost server so fetchers hit a real URL with zero external network. */
export function serveFixture(initialBody: string, contentType = "application/xml"): FixtureServer {
  let body = initialBody;
  let type = contentType;
  const state = { requests: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch() {
      state.requests += 1;
      return new Response(body, { headers: { "content-type": type } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/feed.xml`,
    setBody(next: string, nextType?: string) {
      body = next;
      if (nextType) type = nextType;
    },
    get requests() {
      return state.requests;
    },
    stop() {
      server.stop(true);
    },
  };
}

/** RSS 2.0 document with the given items — used to simulate a feed gaining posts between runs. */
export function rssDoc(items: { guid: string; title: string; link: string; description?: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Fixture Feed</title><link>https://fixture.example</link>
${items
  .map(
    (i) =>
      `<item><guid>${i.guid}</guid><title>${i.title}</title><link>${i.link}</link><description>${i.description ?? "A description."}</description></item>`,
  )
  .join("\n")}
</channel></rss>`;
}
