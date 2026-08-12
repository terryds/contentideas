// The ONLY file that knows which transcript library is used. Every request goes
// through proxy/floxy.ts with a fresh session per attempt.
// M5 fills this in (trial-and-error over candidate libraries); until then the
// caller treats a null/throw as "no transcript yet".

export async function fetchTranscriptForEntry(_entry: {
  external_id: string;
  url: string | null;
}): Promise<string | null> {
  throw new Error("Transcript fetching arrives with the YouTube milestone (M5)");
}
