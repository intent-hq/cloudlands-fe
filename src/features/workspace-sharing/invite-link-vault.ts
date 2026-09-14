/**
 * Off-store holder for the one-time `intent://invite` link that
 * `workspace.invite.create` returns. The link carries the invite secret, so it
 * never rides a Redux action or state (devtools, action logs, and error sinks
 * would echo it): the saga parks the url here and the store keeps only an
 * opaque handle, which the Share dialog host resolves at render time. Transient
 * UI-only state — the dialog clears the vault whenever it opens or closes.
 */

const links = new Map<string, string>();
let nextHandle = 0;

/** Park a freshly minted link; returns the opaque handle to hold in the store. */
export function storeInviteLink(url: string): string {
  const handle = `invite-link-${++nextHandle}`;
  links.set(handle, url);
  return handle;
}

/** Resolve a handle back to its url; `null` once the vault has been cleared. */
export function readInviteLink(handle: string): string | null {
  return links.get(handle) ?? null;
}

/** Drop every parked link (dialog open / close). */
export function clearInviteLinks(): void {
  links.clear();
}
