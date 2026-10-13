import { tick } from 'svelte';

export interface NoteDeleteEditorScope {
  backendGeneration: number;
  workspaceId: string;
  noteId: string;
  noteInstanceId?: string;
}

interface Participant {
  current(): boolean;
  version(): string | number;
  dirty(): boolean;
  composing(): boolean;
  /** Synchronous: lock the actual editor before the first await. */
  hold(held: boolean): void;
  /** Resolve only after the existing strict-base write queue acknowledges. */
  flush(): Promise<void>;
}
interface Entry {
  scope: NoteDeleteEditorScope;
  participant: Participant;
}
interface Preparation {
  scope: NoteDeleteEditorScope;
  invalid: boolean;
}

// UI refs only. Receipts, pending deletion and recovery drafts belong to Redux.
const participants = new Map<symbol, Entry>();
let overflow = 0;
let preparation: Preparation | undefined;
function sameNote(a: NoteDeleteEditorScope, b: NoteDeleteEditorScope): boolean {
  return (
    a.backendGeneration === b.backendGeneration &&
    a.workspaceId === b.workspaceId &&
    a.noteId === b.noteId
  );
}

export function registerNoteDeleteEditor(scope: NoteDeleteEditorScope, participant: Participant) {
  const capturedScope = { ...scope };
  const token = Symbol('note editor');
  const registered =
    participants.size < 256 &&
    [...participants.values()].filter((entry) => sameNote(entry.scope, scope)).length < 32;
  let retired = false;
  if (registered) participants.set(token, { scope: capturedScope, participant });
  else overflow++;
  if (preparation && sameNote(preparation.scope, capturedScope)) {
    preparation.invalid = true;
    participant.hold(true);
  }
  if (!registered) participant.hold(true);
  return {
    registered,
    invalidate() {
      if (!retired && preparation && sameNote(preparation.scope, capturedScope))
        preparation.invalid = true;
    },
    unregister() {
      if (retired) return;
      retired = true;
      if (registered) participants.delete(token);
      else overflow--;
      if (preparation && sameNote(preparation.scope, capturedScope)) preparation.invalid = true;
      // Removing a view must not release its domain hold or run a save.
    },
  };
}

export async function prepareNoteDeleteEditors(
  scope: NoteDeleteEditorScope,
): Promise<{ current(noteInstanceId?: string): boolean; release(): void }> {
  scope = { ...scope };
  if (preparation) throw new Error('Another note deletion is still being prepared');
  if (overflow) throw new Error('Close extra note editors before deleting');
  const owner: Preparation = { scope: { ...scope }, invalid: false };
  preparation = owner;
  const captured = [...participants.entries()]
    .filter(([, entry]) => sameNote(entry.scope, scope))
    .map(([token]) => token);
  const expectedInstance =
    scope.noteInstanceId ??
    captured
      .map((token) => participants.get(token)?.scope.noteInstanceId)
      .find((instance) => instance !== undefined);
  let versions: Array<string | number> = [];
  let released = false;
  const current = (noteInstanceId = expectedInstance) =>
    (!expectedInstance || !noteInstanceId || expectedInstance === noteInstanceId) &&
    !released &&
    preparation === owner &&
    !owner.invalid &&
    !overflow &&
    captured.every((token, index) => {
      const entry = participants.get(token);
      return (
        !!entry &&
        entry.participant.current() &&
        !entry.participant.composing() &&
        entry.participant.version() === versions[index] &&
        (!noteInstanceId ||
          !entry.scope.noteInstanceId ||
          noteInstanceId === entry.scope.noteInstanceId)
      );
    });
  const release = () => {
    if (released) return;
    released = true;
    if (preparation !== owner) return;
    preparation = undefined;
    for (const entry of participants.values())
      if (sameNote(entry.scope, scope)) entry.participant.hold(false);
    captured.length = 0;
  };
  try {
    versions = captured.map((token) => participants.get(token)!.participant.version());
    for (const token of captured) participants.get(token)?.participant.hold(true);
    if (!current()) throw new Error('The note editor changed while preparing deletion');
    if (captured.filter((token) => participants.get(token)!.participant.dirty()).length > 1)
      throw new Error('Save or close competing note drafts before deleting');
    await tick();
    if (!current()) throw new Error('The note editor changed while preparing deletion');
    for (const token of captured) {
      if (!current()) throw new Error('The note editor changed while saving');
      await participants.get(token)!.participant.flush();
      if (!current()) throw new Error('The note editor changed while saving');
    }
    return { current, release };
  } catch (error) {
    release();
    throw error;
  }
}
