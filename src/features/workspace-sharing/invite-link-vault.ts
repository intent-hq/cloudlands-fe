/**
 * Off-store holder for the `intent://invite` links that `workspace.invite.create`
 * and every open `workspace.invite.list` row return. A link is a capability
 * (it carries the invite secret), so it never rides a Redux action or state:
 * devtools, the action logger, and error sinks would all echo it. The saga
 * parks each url here under its invite id and dispatches only the secret-free
 * rows; the Share dialog host resolves ids back to links at render time.
 * Transient UI-only state — the dialog clears the vault whenever it opens or
 * closes.
 */

import type { WorkspaceInvite, WorkspaceInviteRow } from './types';

const links = new Map<string, string>();

/** Park (or refresh) the link of one open invite. */
export function storeInviteLink(inviteId: string, url: string): void {
  links.set(inviteId, url);
}

/** Resolve an invite id back to its link; `null` when none is parked. */
export function readInviteLink(inviteId: string): string | null {
  return links.get(inviteId) ?? null;
}

/**
 * Split `workspace.invite.list` rows into their secret-free store shape,
 * parking every `url` that came along. A row without a url (Remote Access
 * listener down) parks nothing and stays uncopyable until the next read.
 */
export function vaultInviteLinks(rows: WorkspaceInviteRow[]): WorkspaceInvite[] {
  return rows.map(({ url, ...invite }) => {
    if (url) storeInviteLink(invite.id, url);
    return invite;
  });
}

/** Drop every parked link (dialog open / close). */
export function clearInviteLinks(): void {
  links.clear();
}
