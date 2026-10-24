import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  canCompose: true,
  current: {
    context: 'backend:principal:1',
    workspaceId: 'ws',
    conversationId: 'default',
    epoch: 0,
  } as Record<string, unknown> | null,
}));
const target = writable(mocks.current);
vi.mock('$store/renderer/store', () => ({ store: { state: {}, dispatch: vi.fn() } }));
vi.mock('$store/renderer/slices/workspace-discussion/workspace-discussion-selectors', () => ({
  selectDiscussionTarget: Object.assign(() => target, { select: () => mocks.current }),
  selectDiscussionCanSend: { select: () => mocks.canCompose },
  selectDiscussionCanCreate: { select: () => mocks.canCompose },
}));
vi.mock('$store/renderer/slices/voice-settings/voice-settings-selectors', () => ({
  selectEffectiveVoiceEngine: { select: () => 'local' },
}));
vi.mock('$features/hardware-console/voice/voice-setup-toast', () => ({
  showVoiceSetupToast: vi.fn(),
}));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { info: vi.fn() } }));
vi.mock('../discussion-microphone', () => ({ createDiscussionMicrophone: mocks.create }));
import DiscussionMicrophone from './DiscussionMicrophone.svelte';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.canCompose = true;
});
function setup() {
  mocks.current = {
    context: 'backend:principal:1',
    workspaceId: 'ws',
    conversationId: 'default',
    epoch: 0,
  };
  target.set(mocks.current);
  const cancel = vi.fn();
  mocks.create.mockImplementation(() => ({ cancel, toggle: vi.fn() }));
  const onTranscript = vi.fn();
  const view = render(DiscussionMicrophone, {
    workspaceId: 'ws',
    conversationId: 'default',
    onTranscript,
  });
  return { cancel, onTranscript, view };
}

describe('discussion microphone destination lifetime', () => {
  it.each([
    { context: 'other-backend:principal:1' },
    { context: 'backend:other-principal:1' },
    { context: 'backend:principal:2' },
    { epoch: 1 },
  ])('expires a captured destination before effect cleanup on %j', async (change) => {
    const { cancel } = setup();
    const captured = mocks.create.mock.calls.at(-1)![0];
    expect(captured.isActive()).toBe(true);
    mocks.current = { ...mocks.current, ...change };
    expect(captured.isActive()).toBe(false);
    const count = cancel.mock.calls.length;
    target.set(mocks.current);
    await waitFor(() => expect(cancel.mock.calls.length).toBeGreaterThan(count));
  });
  it('retains the captured callback and blocks access loss before props settle', async () => {
    const { view, onTranscript } = setup();
    const captured = mocks.create.mock.calls.at(-1)![0];
    const replacement = vi.fn();
    await view.rerender({ onTranscript: replacement });
    captured.onTranscript('captured');
    expect(onTranscript).toHaveBeenCalledWith('captured');
    expect(replacement).not.toHaveBeenCalled();
    mocks.canCompose = false;
    expect(captured.isActive()).toBe(false);
  });
  it('cancels when the conversation changes or the window loses focus', async () => {
    const { view, cancel } = setup();
    const captured = mocks.create.mock.calls.at(-1)![0];
    await view.rerender({ conversationId: 'other' });
    expect(captured.isActive()).toBe(false);
    expect(cancel).toHaveBeenCalled();
    cancel.mockClear();
    await fireEvent(window, new Event('blur'));
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels when hidden, disabled, or removed', async () => {
    const { view, cancel } = setup();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await fireEvent(document, new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalled();
    hidden.mockRestore();
    cancel.mockClear();
    await view.rerender({ disabled: true });
    expect(cancel).toHaveBeenCalled();
    cancel.mockClear();
    view.unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
