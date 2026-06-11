/**
 * @vitest-environment jsdom
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: mocks.invoke,
}));

vi.mock('$lib/components/chat/StreamingMessageContent.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/editor/CodeEditor.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/ui/auggie-avatar/AuggieAvatar.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('./mocks/MockComponent.svelte')).default,
}));

import SetupScriptAgent from '../SetupScriptAgent.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('SetupScriptAgent IPC listener cleanup', () => {
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    on = vi.fn((channel: string) => `${channel}:listener`);
    offById = vi.fn();
    (window as any).electronAPI = { on, offById };
  });

  afterEach(() => {
    cleanup();
    delete (window as any).electronAPI;
  });

  it('does not register stream listeners if generation resolves after unmount', async () => {
    const generate = deferred<{ success: boolean; streamId: string }>();
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'setup-scripts:generate-with-agent') return generate.promise;
      if (channel === 'setup-scripts:stop-agent') return Promise.resolve({ success: true });
      return Promise.resolve({ success: true });
    });

    const { unmount } = render(SetupScriptAgent, {
      props: { repoPath: '/repo' },
    });

    unmount();
    generate.resolve({ success: true, streamId: 'stream-1' });

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('setup-scripts:stop-agent', expect.any(Object));
    });

    expect(on).not.toHaveBeenCalled();
  });

  it('removes registered stream listeners on unmount', async () => {
    mocks.invoke.mockResolvedValue({ success: true, streamId: 'stream-1' });

    const { unmount } = render(SetupScriptAgent, {
      props: { repoPath: '/repo' },
    });

    await waitFor(() => expect(on).toHaveBeenCalledTimes(3));

    unmount();

    expect(offById).toHaveBeenCalledWith('setup-scripts:stream-chunk', 'setup-scripts:stream-chunk:listener');
    expect(offById).toHaveBeenCalledWith(
      'setup-scripts:stream-complete',
      'setup-scripts:stream-complete:listener',
    );
    expect(offById).toHaveBeenCalledWith('setup-scripts:stream-error', 'setup-scripts:stream-error:listener');
  });
});