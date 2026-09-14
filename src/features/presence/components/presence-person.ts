/**
 * Display helpers for workspace-presence people (multiplayer w5).
 */
import { m } from '$shared/paraglide/messages.js';
import type { PresencePerson } from '$store/renderer/slices/presence/presence-types';

export function presencePersonName(person: PresencePerson): string {
  return person.displayName?.trim() || person.login?.trim() || m.presence_person_unknown_label();
}

export function presencePersonInitial(person: PresencePerson): string {
  return presencePersonName(person).slice(0, 1).toUpperCase();
}

/** Stable hue per principal so the same person keeps one color everywhere. */
export function presencePersonColor(principalId: string): string {
  let hash = 0;
  for (let index = 0; index < principalId.length; index++) {
    hash = (hash * 31 + principalId.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 55% 45%)`;
}

/** "{first} is typing…" / "{first} and {second} …" / "{first} and N others …". */
export function presenceTypingLabel(people: PresencePerson[]): string | null {
  if (people.length === 0) return null;
  const [first, second] = people.map(presencePersonName);
  if (people.length === 1) return m.presence_typing_one({ name: first });
  if (people.length === 2) return m.presence_typing_two_label({ first, second });
  return m.presence_typing_many({ first, count: people.length - 1 });
}
