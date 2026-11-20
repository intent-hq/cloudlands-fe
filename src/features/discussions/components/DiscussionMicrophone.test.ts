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
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      hardwareConsole: { pttRecordingStartedAt: null, pttInputLevels: [0.2, 0.8] },
    }),
  });
});
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
import { m } from '$shared/paraglide/messages.js';
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
  it('turns into the live dictation pill while its recording runs, and a click stops it', async () => {
    const { view } = setup();
    const captured = mocks.create.mock.calls.at(-1)![0];
    const { toggle } = mocks.create.mock.results.at(-1)!.value;
    captured.onState('recording');
    await waitFor(() =>
      expect(view.container.querySelector('[data-dictation-waveform]')).not.toBeNull(),
    );
    const pill = view.getByRole('button', { name: m.chat_richInput_micStop_label() });
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(pill);
    expect(toggle).toHaveBeenCalledTimes(1);
    captured.onState('idle');
    await waitFor(() =>
      expect(view.container.querySelector('[data-dictation-waveform]')).toBeNull(),
    );
  });
});
