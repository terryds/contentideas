// The ONLY place `claude -p` is spawned. Full prompt goes in via stdin (argv
// has size limits and shows in `ps`).

export class ClaudeUnavailableError extends Error {}

export interface RunClaudeOptions {
  timeoutMs?: number;
  /** Model alias/id passed as --model; omitted = the CLI's default model. */
  model?: string;
}

async function invoke(prompt: string, timeoutMs: number, extraArgs: string[] = []): Promise<string> {
  // Test seam: integration tests point this at a deterministic stub script.
  const bin = process.env.CONTENT_ENGINE_CLAUDE_BIN ?? "claude";
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([bin, "-p", ...extraArgs], {
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
    if (/unknown option.*json-schema/i.test(detail)) {
      throw new ClaudeUnavailableError(
        "This Claude Code version lacks --json-schema structured output — update the claude CLI",
      );
    }
    throw new Error(`claude -p exited ${exitCode}: ${detail || "no output"}`);
  }
  return stdout.trim();
}

/**
 * Run `claude -p` and parse its text output. Defensive: a parse failure gets ONE
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

interface Envelope {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
}

/**
 * Run `claude -p --output-format json --json-schema <schema>` and return the
 * schema-validated `structured_output` object. The CLI forces the model through
 * a tool call matching the schema, so shape is guaranteed — one retry covers
 * transient envelope weirdness.
 */
export async function runClaudeStructured<T>(
  prompt: string,
  schema: object,
  options: RunClaudeOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const args = ["--output-format", "json", "--json-schema", JSON.stringify(schema)];
  if (options.model) args.push("--model", options.model);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await invoke(prompt, timeoutMs, args);
    try {
      const envelope = JSON.parse(output) as Envelope;
      if (envelope.is_error || envelope.subtype !== "success") {
        throw new Error(`claude -p reported failure: ${envelope.result?.slice(0, 200) ?? envelope.subtype ?? "unknown"}`);
      }
      if (envelope.structured_output == null || typeof envelope.structured_output !== "object") {
        throw new Error("claude -p envelope had no structured_output");
      }
      return envelope.structured_output as T;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
