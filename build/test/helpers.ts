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
 * Deterministic stand-in for the claude CLI. Sniffs which contract the prompt
 * asks for (generator wants a JSON array, filter wants MATCH/SKIP + TOPICS)
 * and answers accordingly. Point CONTENT_ENGINE_CLAUDE_BIN at the returned path.
 */
export function claudeStubPath(): string {
  const path = join(process.env.CONTENT_ENGINE_DATA_DIR!, "claude-stub.sh");
  writeFileSync(
    path,
    `#!/bin/sh
input=$(cat)
if printf '%s' "$input" | grep -q "Return ONLY a JSON array"; then
  echo '["Stub tweet one about the story.","Stub tweet two with a detail.","Stub tweet three, the takeaway."]'
else
  printf 'MATCH: stub filter says this fits\\nTOPICS: stub-story, stub-entity\\n'
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
