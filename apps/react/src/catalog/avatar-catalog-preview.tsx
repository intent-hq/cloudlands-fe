// Source: PrincipalAvatarCatalogPreview.svelte. Image failures use the real browser;
// unlike the source's jsdom accommodation, this fixture never dispatches a synthetic error.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import { PresenceAvatarStack } from '@/features/presence/components/presence-avatar-stack';
import { NotePresenceAvatars } from '@/features/notes/note-presence/note-presence-avatars';
import {
  presencePersonColor,
  presencePersonName,
  type PresenceCircle,
  type PresenceCircleAction,
} from '../../../../src/features/presence/components/presence-person';
import type { RemoteNoteViewer } from '../../../../src/features/notes/note-presence/note-presence-types';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

const failingUrl = 'https://avatar.invalid/missing.png';
const people: PresenceCircle[] = [
  {
    principalId: 'ada',
    login: 'ada',
    displayName: 'Ada Lovelace',
    avatarUrl: null,
    self: true,
    online: true,
  },
  {
    principalId: 'grace',
    login: 'grace',
    displayName: 'Grace Hopper',
    avatarUrl: null,
    owner: true,
    online: true,
  },
  { principalId: 'linus', login: 'linus', displayName: null, avatarUrl: failingUrl, online: true },
  {
    principalId: 'cy',
    login: 'cy',
    displayName: 'Cy Offline',
    avatarUrl: failingUrl,
    online: false,
  },
  { principalId: 'mia', login: 'mia', displayName: 'Mia Overflow', avatarUrl: null, online: true },
];
const noteViewers: RemoteNoteViewer[] = [
  {
    principalId: 'ada',
    login: 'ada',
    displayName: 'Ada Lovelace',
    avatarUrl: null,
    cursor: null,
    cursorSeenAt: null,
  },
  {
    principalId: 'linus',
    login: 'linus',
    displayName: null,
    avatarUrl: failingUrl,
    cursor: null,
    cursorSeenAt: null,
  },
  {
    principalId: 'grace',
    login: 'grace',
    displayName: 'Grace Hopper',
    avatarUrl: failingUrl,
    cursor: null,
    cursorSeenAt: null,
  },
  {
    principalId: 'mia',
    login: 'mia',
    displayName: 'Mia Overflow',
    avatarUrl: null,
    cursor: null,
    cursorSeenAt: null,
  },
];
const tileRows = [
  ['No URL', null],
  ['Failing URL', failingUrl],
] as const;

export function AvatarCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  const [lastSelected, setLastSelected] = useState('Nobody selected yet');
  const action = (person: PresenceCircle): PresenceCircleAction => ({
    label: `${presencePersonName(person)} · ${person.online === false ? 'offline' : 'online'}`,
    onSelect:
      person.online === false
        ? null
        : () => setLastSelected(`${presencePersonName(person)} selected`),
  });
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-3"
      data-catalog-renderer-fixture={fixture.id}
    >
      {fixture.id === 'note-presence-stack' ? (
        <div
          className="grid min-w-0 gap-3"
          data-catalog-rendered-state="no-url failing-url overflow"
        >
          <p className="type-caption text-muted-foreground">
            Other viewers of a note: one with no URL, two with a failed image, and one more person
            in the overflow chip.
          </p>
          <NotePresenceAvatars viewers={noteViewers} maxVisible={3} />
        </div>
      ) : fixture.id === 'tile-states' ? (
        <div
          className="grid min-w-0 gap-4"
          data-catalog-rendered-state="no-url failing-url size-16 size-24 size-32 empty-label fill"
        >
          <p className="type-caption text-muted-foreground">
            Rows: no URL, a failed image. Columns: 16, 24, and 32 px.
          </p>
          {tileRows.map(([caption, avatarUrl]) => (
            <div key={caption} className="flex items-center gap-3">
              <span className="type-caption w-24 text-muted-foreground">{caption}</span>
              {[16, 24, 32].map((size) => (
                <span key={size} data-catalog-fail={avatarUrl === failingUrl || undefined}>
                  <PrincipalAvatar avatarUrl={avatarUrl} label="Ada Lovelace" size={size} />
                </span>
              ))}
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="type-caption w-24 text-muted-foreground">Empty label</span>
            <span>
              <PrincipalAvatar avatarUrl={null} label="" size={24} />
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="type-caption w-24 text-muted-foreground">Fill in a tile</span>
            {[null, failingUrl].map((avatarUrl) => (
              <span
                key={avatarUrl ?? 'no-url'}
                className="inline-flex size-8 items-center justify-center overflow-hidden rounded-full type-caption font-medium text-primary-foreground"
                style={{ backgroundColor: presencePersonColor('Grace Hopper') }}
                data-catalog-fail={avatarUrl === failingUrl || undefined}
              >
                <PrincipalAvatar fill avatarUrl={avatarUrl} label="Grace Hopper" />
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="grid min-w-0 gap-3"
          data-catalog-rendered-state={`no-url failing-url self owner member offline overflow${fixture.id === 'presence-stack-action' ? ' aria-disabled' : ''}`}
        >
          <p className="type-caption text-muted-foreground">
            You (no URL), the owner (no URL), a member (failed image), an offline member (failed
            image), and one more person in the overflow chip.
          </p>
          <PresenceAvatarStack
            people={people}
            maxVisible={4}
            size={24}
            decorative={fixture.id === 'presence-stack-decorative'}
            action={fixture.id === 'presence-stack-action' ? action : undefined}
          />
          {fixture.id === 'presence-stack-action' && (
            <output className="type-caption text-muted-foreground" aria-live="polite">
              {lastSelected}
            </output>
          )}
        </div>
      )}
    </div>
  );
}
