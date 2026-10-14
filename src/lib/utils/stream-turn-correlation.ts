export function streamTurnCorrelation(wireId: string | undefined): string | undefined {
  if (!wireId) return undefined;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(wireId)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
