/**
 * Request scheduling for composer autocomplete (Contract §6.1):
 *
 * - ask only when enabled, the trimmed draft has at least 5 characters (and
 *   fits the 2,000-character wire limit), the caret is at the end, no IME
 *   composition is running and no slash/mention menu is open;
 * - debounce 250 ms after the last edit;
 * - drop stale replies: every edit bumps a sequence number, and a reply is
 *   applied only when its number is current and the draft is unchanged.
 *
 * Framework-free so it can be driven with fake timers in tests; the editor
 * supplies a snapshot reader, the request function and a ghost setter.
 */

export const AUTOCOMPLETE_DEBOUNCE_MS = 250;
export const AUTOCOMPLETE_MIN_CHARS = 5;
export const AUTOCOMPLETE_TEXT_MAX_CHARS = 2000;

export interface AutocompleteSnapshot {
  /** Draft text as serialized for sending. */
  text: string;
  caretAtEnd: boolean;
  composing: boolean;
  /** A slash or mention menu is open. */
  menuOpen: boolean;
}

export function shouldRequestAutocomplete(snapshot: AutocompleteSnapshot): boolean {
  return (
    snapshot.caretAtEnd &&
    !snapshot.composing &&
    !snapshot.menuOpen &&
    snapshot.text.trim().length >= AUTOCOMPLETE_MIN_CHARS &&
    snapshot.text.length <= AUTOCOMPLETE_TEXT_MAX_CHARS
  );
}

export interface AutocompleteControllerDeps {
  /** Current editor state; `null` once the editor is gone. */
  readSnapshot: () => AutocompleteSnapshot | null;
  /** Context string for the request, built lazily only when a request fires. */
  readContext: () => string;
  /** Resolves to the completion, `''` for none. Must not reject (rejections count as `''`). */
  request: (text: string, context: string) => Promise<string>;
  /** Show (non-empty) or clear (`null`) the ghost suggestion. */
  showGhost: (ghost: string | null) => void;
  debounceMs?: number;
}

export class AutocompleteController {
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(private readonly deps: AutocompleteControllerDeps) {
    this.debounceMs = deps.debounceMs ?? AUTOCOMPLETE_DEBOUNCE_MS;
  }

  /** Call after every user edit with no live ghost: restarts the debounce. */
  schedule(): void {
    this.cancel();
    const snapshot = this.deps.readSnapshot();
    if (!snapshot || !shouldRequestAutocomplete(snapshot)) return;
    const sequence = this.sequence;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fire(sequence);
    }, this.debounceMs);
  }

  /** Drop the pending debounce and any in-flight reply. */
  cancel(): void {
    this.sequence += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.cancel();
  }

  private async fire(sequence: number): Promise<void> {
    if (sequence !== this.sequence) return;
    const snapshot = this.deps.readSnapshot();
    if (!snapshot || !shouldRequestAutocomplete(snapshot)) return;
    const { text } = snapshot;
    let completion = '';
    try {
      completion = await this.deps.request(text, this.deps.readContext());
    } catch {
      completion = '';
    }
    if (sequence !== this.sequence || !completion) return;
    const current = this.deps.readSnapshot();
    if (!current || current.text !== text || !shouldRequestAutocomplete(current)) return;
    this.deps.showGhost(completion);
  }
}
