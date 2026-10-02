/** Bearer links are transient presentation data, never Redux actions, state or logs. */
const links = new Map<string, Map<string, string>>();
export function retainHostInviteLink(session: string, id: string, url: string): void {
  const entries = links.get(session) ?? new Map<string, string>();
  entries.set(id, url);
  links.set(session, entries);
}
export function readHostInviteLink(session: string, id: string): string | null {
  return links.get(session)?.get(id) ?? null;
}
export function clearHostInviteLinks(session: string): void {
  links.delete(session);
}
