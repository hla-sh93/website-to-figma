type RandomSource = {
  getRandomValues?: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;
};
let sequence = 0;

/** Non-secret deduplication key, independent of secure-context randomUUID.
 * Session authentication is supplied separately by the local service. */
export function createRequestKey(source: RandomSource | undefined = globalThis.crypto): string {
  let entropy: string;
  try {
    if (!source?.getRandomValues) throw new Error('Random bytes unavailable');
    const bytes = source.getRandomValues(new Uint8Array(16));
    entropy = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    entropy = Math.random().toString(36).slice(2);
  }
  return `capture-${Date.now().toString(36)}-${(++sequence).toString(36)}-${entropy}`;
}
