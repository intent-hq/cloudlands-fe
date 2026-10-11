import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { remoteCursorColor } from '$lib/components/tiptap/RemoteCursorDecorations';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import type { RemoteNoteViewer } from '../../../../../../src/features/notes/note-presence/note-presence-types';

export interface NotePresenceAvatarsProps {
  viewers: RemoteNoteViewer[];
  maxVisible?: number;
}

/** Presentational only: live sessions and the catalog supply the ordered viewers. */
export function NotePresenceAvatars({ viewers, maxVisible = 3 }: NotePresenceAvatarsProps) {
  if (viewers.length === 0) return null;

  const visible = viewers.slice(0, maxVisible);
  const overflow = Math.max(0, viewers.length - maxVisible);
  const label =
    viewers.length === 1
      ? m.notes_presenceStack_viewers_one()
      : m.notes_presenceStack_viewers_many({ count: formatInteger(viewers.length) });

  return (
    <div
      className="flex items-center -space-x-1.5 px-1"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source avatar group without native fieldset layout.
      role="group"
      aria-label={label}
      data-testid="note-presence-avatar-stack"
    >
      {visible.map((viewer) => {
        const name = viewer.displayName ?? viewer.login ?? viewer.principalId;
        return (
          <Tooltip key={viewer.principalId} content={name} side="bottom">
            <span
              className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-background text-xs font-medium leading-none text-primary-foreground"
              style={{ backgroundColor: remoteCursorColor(viewer.principalId) }}
              data-principal-id={viewer.principalId}
              aria-hidden="true"
            >
              <PrincipalAvatar fill avatarUrl={viewer.avatarUrl} label={name} />
            </span>
            <span className="sr-only">{name}</span>
          </Tooltip>
        );
      })}
      {overflow > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-muted px-1 text-xs font-medium leading-none text-muted-foreground">
          {m.notes_presenceStack_overflow_label({ count: formatInteger(overflow) })}
        </span>
      )}
    </div>
  );
}
