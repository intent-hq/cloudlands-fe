/**
 * Hostname matching helpers for MCP auth providers.
 *
 * Uses exact-or-subdomain matching so lookalike hosts such as
 * `sentry.io.evil.com` or `notsentry.io` never match a trusted domain.
 */

/**
 * Check whether `hostname` is `domain` itself or a subdomain of it.
 */
export function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Check whether the URL's hostname matches any of the given domains
 * (exact or subdomain). Returns false for unparseable URLs.
 */
export function urlMatchesAnyDomain(url: string, domains: readonly string[]): boolean {
  try {
    const { hostname } = new URL(url);
    return domains.some((domain) => hostnameMatchesDomain(hostname, domain));
  } catch {
    return false;
  }
}
