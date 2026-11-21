import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOCOMPLETE_DEBOUNCE_MS,
  AutocompleteController,
  shouldRequestAutocomplete,
  type AutocompleteSnapshot,
} from './autocomplete-controller';

const base: AutocompleteSnapshot = {
  text: 'Show me the',
  caretAtEnd: true,
  composing: false,
  menuOpen: false,
};

describe('shouldRequestAutocomplete', () => {
  it('asks for an eligible draft', () => {
    expect(shouldRequestAutocomplete(base)).toBe(true);
  });

  it('needs at least 5 trimmed characters', () => {
    expect(shouldRequestAutocomplete({ ...base, text: 'Show' })).toBe(false);
    expect(shouldRequestAutocomplete({ ...base, text: '   Show   ' })).toBe(false);
    expect(shouldRequestAutocomplete({ ...base, text: 'Shows' })).toBe(true);
  });

  it('needs the caret at the end', () => {
    expect(shouldRequestAutocomplete({ ...base, caretAtEnd: false })).toBe(false);
  });

  it('never asks during IME composition or with a menu open', () => {
    expect(shouldRequestAutocomplete({ ...base, composing: true })).toBe(false);
    expect(shouldRequestAutocomplete({ ...base, menuOpen: true })).toBe(false);
  });

  it('skips drafts over the 2,000-character wire limit', () => {
    expect(shouldRequestAutocomplete({ ...base, text: 'a'.repeat(2000) })).toBe(true);
    expect(shouldRequestAutocomplete({ ...base, text: 'a'.repeat(2001) })).toBe(false);
  });
});

describe('AutocompleteController', () => {
  let snapshot: AutocompleteSnapshot | null;
  let request: ReturnType<typeof vi.fn<(text: string, context: string) => Promise<string>>>;
  let showGhost: ReturnType<typeof vi.fn<(ghost: string | null) => void>>;
  let readContext: ReturnType<typeof vi.fn<() => string>>;
  let controller: AutocompleteController;

  beforeEach(() => {
    vi.useFakeTimers();
    snapshot = { ...base };
    request = vi.fn(async () => ' before/after screenshots.');
    showGhost = vi.fn();
    readContext = vi.fn(() => 'ctx');
    controller = new AutocompleteController({
      readSnapshot: () => snapshot,
      readContext,
      request,
      showGhost,
    });
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('debounces 250 ms before asking, then shows the ghost', async () => {
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS - 1);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledWith('Show me the', 'ctx');
    expect(showGhost).toHaveBeenCalledWith(' before/after screenshots.');
  });

  it('restarts the debounce on every edit and asks once', async () => {
    controller.schedule();
    await vi.advanceTimersByTimeAsync(200);
    snapshot = { ...base, text: 'Show me the d' };
    controller.schedule();
    await vi.advanceTimersByTimeAsync(200);
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('Show me the d', 'ctx');
  });

  it('builds the context only when a request fires', async () => {
    snapshot = { ...base, text: 'Sho' };
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    expect(readContext).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('does not ask when the caret moved away before the debounce ended', async () => {
    controller.schedule();
    snapshot = { ...base, caretAtEnd: false };
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    expect(request).not.toHaveBeenCalled();
  });

  it('drops a stale reply when the user kept typing', async () => {
    let resolve!: (value: string) => void;
    request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledOnce();

    snapshot = { ...base, text: 'Show me the x' };
    controller.schedule();
    resolve(' stale');
    await vi.advanceTimersByTimeAsync(0);
    expect(showGhost).not.toHaveBeenCalled();
  });

  it('drops a reply after cancel()', async () => {
    let resolve!: (value: string) => void;
    request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    controller.cancel();
    resolve(' late');
    await vi.advanceTimersByTimeAsync(0);
    expect(showGhost).not.toHaveBeenCalled();
  });

  it('drops a reply when the draft changed without a new schedule', async () => {
    let resolve!: (value: string) => void;
    request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    snapshot = { ...base, text: 'Something else' };
    resolve(' late');
    await vi.advanceTimersByTimeAsync(0);
    expect(showGhost).not.toHaveBeenCalled();
  });

  it('stays silent on an empty completion or a failed request', async () => {
    request.mockResolvedValueOnce('');
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    request.mockRejectedValueOnce(new Error('Method not found'));
    controller.schedule();
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(2);
    expect(showGhost).not.toHaveBeenCalled();
  });

  it('stops once the editor is gone', async () => {
    controller.schedule();
    snapshot = null;
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_DEBOUNCE_MS);
    expect(request).not.toHaveBeenCalled();
  });
});
