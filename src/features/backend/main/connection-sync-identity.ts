export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function accountKeyFor(host: string, port: number): string {
  return `${host.trim().toLowerCase()}:${port}`;
}
