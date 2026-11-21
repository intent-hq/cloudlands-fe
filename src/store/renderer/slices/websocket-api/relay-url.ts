/** Empty (the default relays) or an http(s) URL with a host. */
export function isRelayUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host.length > 0;
  } catch {
    return false;
  }
}
