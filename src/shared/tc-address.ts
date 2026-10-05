/**
 * Shared main + renderer recognition for Tailcat's address wire format:
 * literal `tc` followed by case-sensitive, unpadded base64url-encoded CBOR.
 * https://github.com/tailscale/tailcat/blob/main/tailcat.go (ConnInfo.Addr)
 */

/**
 * Recognize the encoded map before URL parsing can lowercase it or send it
 * to DNS. Require room for the map's public key (37 CBOR bytes / 50 base64url
 * characters) and a map header, not just a hostname starting with `tc`.
 * Only the header is decoded; Tailcat validates the complete endpoint.
 */
export function isTcAddress(host: string): boolean {
  const address = host.trim();
  if (!address.startsWith('tc')) return false;
  const payload = address.slice(2);
  if (payload.length < 50 || payload.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(payload)) {
    return false;
  }

  const header = atob(payload.slice(0, 4).replace(/-/g, '+').replace(/_/g, '/')).charCodeAt(0);
  // Non-empty definite map, or an indefinite map; exclude reserved headers.
  return (header >= 0xa1 && header <= 0xbb) || header === 0xbf;
}
