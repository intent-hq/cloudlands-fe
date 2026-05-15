/**
 * @vitest-environment jsdom
 *
 * Investigation test for the Cmd+Enter double-fire suspicion in
 * CompactWorkspaceInitializer (see spec note: "double-agent" bug, candidate #1).
 *
 * The initializer wires two independent Cmd+Enter handlers:
 *   1. RichTextarea -> TipTapEditor's `handleDOMEvents.keydown` calls
 *      `event.preventDefault()` and `onForceSubmit?.()` on Cmd+Enter
 *      (TipTapEditor.svelte line 935-940). It does NOT call
 *      `event.stopPropagation()`, so the event continues to bubble.
 *   2. A window-level keydown listener inside an `$effect` calls
 *      `handleSubmit()` when focus is inside the form
 *      (CompactWorkspaceInitializer.svelte line 1112-1136).
 *
 * `handleSubmit` is the same function in both paths; it short-circuits via
 * `if (!isValid || isCreating) return;` and then sets `isCreating = true`
 * synchronously before any `await`.
 *
 * These tests reproduce that exact handler topology with plain DOM elements
 * (ProseMirror's `handleDOMEvents.keydown` is a regular bubble-phase
 * `addEventListener` on the editor's contentDOM, so the propagation behavior
 * is identical) and document:
 *
 *   - Both listeners fire for a single Cmd+Enter event (no stopPropagation).
 *   - The synchronous `isCreating` flag in `handleSubmit` does prevent the
 *     second submission today.
 *   - Adding `event.stopPropagation()` to the inner handler eliminates the
 *     double-fire entirely (the recommended fix if we ever drop the
 *     synchronous guard or introduce an `await` before the flag).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

interface Harness {
  formContainer: HTMLDivElement;
  innerEditor: HTMLDivElement;
  innerKeydown: ReturnType<typeof vi.fn>;
  windowKeydown: ReturnType<typeof vi.fn>;
  handleSubmit: ReturnType<typeof vi.fn>;
  forceSubmit: ReturnType<typeof vi.fn>;
  state: { isValid: boolean; isCreating: boolean };
  cleanup: () => void;
}

function setupHarness(options: { stopPropagationOnInner?: boolean } = {}): Harness {
  const { stopPropagationOnInner = false } = options;

  const formContainer = document.createElement('div');
  formContainer.setAttribute('data-form', 'true');
  document.body.appendChild(formContainer);

  const innerEditor = document.createElement('div');
  innerEditor.contentEditable = 'true';
  innerEditor.tabIndex = 0;
  formContainer.appendChild(innerEditor);

  const state = { isValid: true, isCreating: false };

  // Mirrors CompactWorkspaceInitializer's `handleSubmit` sync prologue:
  //   if (!isValid || isCreating) return;
  //   isCreating = true;
  // ...the rest of the production function is async, but only the sync
  // portion matters for dedup.
  const handleSubmit = vi.fn(() => {
    if (!state.isValid || state.isCreating) return;
    state.isCreating = true;
  });

  // Mirrors TipTapEditor.svelte line 935-940 -> RichTextarea `onForceSubmit`
  // -> CompactWorkspaceInitializer `onsubmit={handleSubmit}`.
  const forceSubmit = vi.fn(() => handleSubmit());

  const innerKeydown = vi.fn((event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault();
      if (stopPropagationOnInner) {
        event.stopPropagation();
      }
      forceSubmit();
    }
  });
  innerEditor.addEventListener('keydown', innerKeydown);

  // Mirrors CompactWorkspaceInitializer.svelte line 1112-1136. The real code
  // checks `controlsContainer?.contains(activeEl)`; we mirror that with the
  // form container.
  const windowKeydown = vi.fn((event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      const activeEl = document.activeElement;
      if (activeEl && formContainer.contains(activeEl)) {
        event.preventDefault();
        handleSubmit();
      }
    }
  });
  window.addEventListener('keydown', windowKeydown);

  innerEditor.focus();

  return {
    formContainer,
    innerEditor,
    innerKeydown,
    windowKeydown,
    handleSubmit,
    forceSubmit,
    state,
    cleanup: () => {
      window.removeEventListener('keydown', windowKeydown);
      innerEditor.removeEventListener('keydown', innerKeydown);
      formContainer.remove();
    },
  };
}

function dispatchCmdEnter(target: HTMLElement) {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('CompactWorkspaceInitializer Cmd+Enter handler topology', () => {
  let harness: Harness | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    harness?.cleanup();
    harness = null;
    document.body.innerHTML = '';
  });

  it('fires BOTH the inner editor handler and the window-level handler for a single Cmd+Enter (no stopPropagation today)', () => {
    harness = setupHarness();

    dispatchCmdEnter(harness.innerEditor);

    expect(harness.innerKeydown).toHaveBeenCalledTimes(1);
    expect(harness.windowKeydown).toHaveBeenCalledTimes(1);
    expect(harness.forceSubmit).toHaveBeenCalledTimes(1);
    // handleSubmit is reached twice: once via the inner force-submit path
    // and once directly via the window listener.
    expect(harness.handleSubmit).toHaveBeenCalledTimes(2);
  });

  it('synchronous isCreating guard inside handleSubmit prevents the second call from doing real work', () => {
    harness = setupHarness();

    const stateTransitions: boolean[] = [];
    harness.handleSubmit.mockImplementation(() => {
      // Capture the value seen by each invocation as it enters the function.
      stateTransitions.push(harness!.state.isCreating);
      if (!harness!.state.isValid || harness!.state.isCreating) return;
      harness!.state.isCreating = true;
    });

    dispatchCmdEnter(harness.innerEditor);

    expect(harness.handleSubmit).toHaveBeenCalledTimes(2);
    // First entry: isCreating is still false -> proceeds and flips to true.
    // Second entry: isCreating is true -> returns immediately.
    expect(stateTransitions).toEqual([false, true]);
    expect(harness.state.isCreating).toBe(true);
  });

  it('proposed fix: stopPropagation in the inner handler eliminates the double-fire entirely', () => {
    harness = setupHarness({ stopPropagationOnInner: true });

    dispatchCmdEnter(harness.innerEditor);

    expect(harness.innerKeydown).toHaveBeenCalledTimes(1);
    expect(harness.forceSubmit).toHaveBeenCalledTimes(1);
    // Window listener is bypassed because the inner handler stopped propagation.
    expect(harness.windowKeydown).not.toHaveBeenCalled();
    expect(harness.handleSubmit).toHaveBeenCalledTimes(1);
  });

  it('window listener still owns Cmd+Enter when focus is in a sibling form control (e.g. branch picker, model select)', () => {
    harness = setupHarness();

    const sibling = document.createElement('input');
    sibling.type = 'text';
    harness.formContainer.appendChild(sibling);
    sibling.focus();

    dispatchCmdEnter(sibling);

    // Inner editor's listener does not fire because the event was dispatched on
    // a different element.
    expect(harness.innerKeydown).not.toHaveBeenCalled();
    expect(harness.forceSubmit).not.toHaveBeenCalled();
    // Window listener still picks it up because activeElement is inside the form.
    expect(harness.windowKeydown).toHaveBeenCalledTimes(1);
    expect(harness.handleSubmit).toHaveBeenCalledTimes(1);
  });
});
