import type { ReactNode } from 'react';

type NoteContentState =
  | 'editor'
  | 'loading'
  | 'empty'
  | 'missing'
  | 'read-only'
  | 'recent-note'
  | 'error';

interface NoteContentSurfaceProps {
  state: NoteContentState;
  children?: ReactNode;
}

export function NoteContentSurface({ state, children }: NoteContentSurfaceProps) {
  return (
    <div
      className="h-full min-h-0 w-full min-w-0 bg-background text-foreground"
      data-note-content-surface=""
      data-note-content-state={state}
    >
      {children}
    </div>
  );
}
