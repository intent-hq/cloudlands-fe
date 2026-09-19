/**
 * Display helpers for workspace-presence people (multiplayer w5).
 */
import { m } from '$shared/paraglide/messages.js';
import type {
  PresenceIdentity,
  PresencePerson,
} from '$store/renderer/slices/presence/presence-types';

/**
 * What one avatar of a stack is drawn from: an identity, plus the facts the
 * brief colours by when the caller knows them (a typing row knows none).
 */
export type PresenceCircle = PresenceIdentity &
  Partial<Pick<PresencePerson, 'owner' | 'online' | 'self'>>;

/**
 * What makes one avatar of a stack a button: its accessible label (also the
 * tooltip) and what selecting it does, given the originating click — `null`
 * leaves the avatar inert (`aria-disabled`).
 */
export interface PresenceCircleAction {
  label: string;
  onSelect: ((event: MouseEvent) => void) | null;
}

/** The ring around an avatar: the owner blue, an online member green, an offline member grey. */
export type PresenceRing = 'owner' | 'member' | 'offline';

export function presencePersonRing(person: PresenceCircle): PresenceRing | null {
  if (person.online === false) return 'offline';
  if (person.owner) return 'owner';
  return person.online === true ? 'member' : null;
}

export function presencePersonName(person: PresenceIdentity): string {
  return person.displayName?.trim() || person.login?.trim() || m.presence_person_unknown_label();
}

/** The name, marked "(you)" for this window's own principal. */
export function presencePersonLabel(person: PresenceCircle): string {
  const name = presencePersonName(person);
  return person.self ? m.presence_person_you_label({ name }) : name;
}

export function presencePersonInitial(person: PresenceIdentity): string {
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
export function presenceTypingLabel(people: PresenceIdentity[]): string | null {
  if (people.length === 0) return null;
  const [first, second] = people.map(presencePersonName);
  if (people.length === 1) return m.presence_typing_one({ name: first });
  if (people.length === 2) return m.presence_typing_two_label({ first, second });
  return m.presence_typing_many({ first, count: people.length - 1 });
}
