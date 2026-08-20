// The ONLY place `claude -p` is spawned. Full prompt goes in via stdin (argv
// has size limits and shows in `ps`).

export class ClaudeUnavailableError extends Error {}

export interface RunClaudeOptions {
  timeoutMs?: number;
}

async function invoke(prompt: string, timeoutMs: number): Promise<string> {
  // Test seam: integration tests point this at a deterministic stub script.
  const bin = process.env.CONTENT_ENGINE_CLAUDE_BIN ?? "claude";
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, "-p"], {
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new ClaudeUnavailableError("claude -p failed — is the CLI installed and logged in?");
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (timedOut) throw new Error(`claude -p timed out after ${Math.round(timeoutMs / 1000)}s`);
  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim().split("\n")[0] ?? "";
    if (/not.*logged in|auth|api key/i.test(detail)) {
      throw new ClaudeUnavailableError("claude -p failed — is the CLI installed and logged in?");
    }
    throw new Error(`claude -p exited ${exitCode}: ${detail || "no output"}`);
  }
  return stdout.trim();
}

/**
 * Run `claude -p` and parse its output. Defensive: a parse failure gets ONE
 * retry (fresh call); a second failure throws the parse error to the caller,
 * who decides what stays pending.
 */
export async function runClaude<T>(
  prompt: string,
  parse: (output: string) => T,
  options: RunClaudeOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await invoke(prompt, timeoutMs);
    try {
      return parse(output);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
