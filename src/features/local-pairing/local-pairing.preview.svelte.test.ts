/**
 * @vitest-environment jsdom
 *
 * Every named state of the local pairing preview renders the code panel and
 * the Intents list the way B's user should see them.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LocalPairingPreview, { LOCAL_PAIRING_PREVIEW_STATES } from './local-pairing.preview.svelte';
import LocalPairingCodePanel from './LocalPairingCodePanel.svelte';
import LocalIntentsList from './LocalIntentsList.svelte';

afterEach(() => cleanup());

const panel = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-testid="local-pairing-panel"]')!;

describe('local pairing preview', () => {
  it.each(LOCAL_PAIRING_PREVIEW_STATES)('renders state %s', (state) => {
    const { container } = render(LocalPairingPreview, { state });
    expect(panel(container)).not.toBeNull();
    expect(container.querySelector('[data-testid="local-intents"]')).not.toBeNull();
  });

  it('shows the code, the countdown and no tries line while all tries remain', () => {
    const { container } = render(LocalPairingPreview, { state: 'active' });
    expect(screen.getByTestId('local-pairing-code').textContent?.trim()).toBe('KTP-82M');
    expect(screen.getByTestId('local-pairing-countdown').textContent).toContain('Expires in');
    expect(container.querySelector('[data-testid="local-pairing-attempts"]')).toBeNull();
  });

  it('shows the remaining tries after a wrong one', () => {
    render(LocalPairingPreview, { state: 'active-few-tries' });
    expect(screen.getByTestId('local-pairing-attempts').textContent).toContain('2');
  });

  it('names the connected Intent', () => {
    const { container } = render(LocalPairingPreview, { state: 'connected' });
    expect(panel(container).textContent).toContain('Intent Alpha is connected');
    expect(container.querySelector('[data-testid="local-pairing-code"]')).toBeNull();
  });

  it('explains the loopback-only listener before turning it on', () => {
    render(LocalPairingPreview, { state: 'confirm-listener' });
    expect(screen.getByTestId('local-pairing-listener-prompt').textContent).toContain(
      'never opened to your network',
    );
  });

  it('lists Intents with their connection state and an empty state', () => {
    const { container, unmount } = render(LocalPairingPreview, { state: 'idle' });
    const rows = container.querySelectorAll('[data-credential-id]');
    expect(Array.from(rows).map((row) => row.getAttribute('aria-label'))).toEqual([
      'Intent Alpha',
      'Intent (dev build)',
    ]);
    expect(rows[0]?.textContent).toContain('Connected');
    expect(rows[1]?.textContent).toContain('Not used yet');
    unmount();
    const empty = render(LocalPairingPreview, { state: 'intents-empty' });
    expect(empty.container.textContent).toContain('No other Intent on this computer');
  });

  it('shows a failed removal on its row', () => {
    const { container } = render(LocalPairingPreview, { state: 'intents-remove-failed' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't remove Intent (dev build)",
    );
  });
});

describe('local pairing actions', () => {
  it('wires the panel buttons', async () => {
    const handlers = {
      onShow: vi.fn(),
      onConfirmListener: vi.fn(),
      onCancel: vi.fn(),
      onClose: vi.fn(),
    };
    const closed = render(LocalPairingCodePanel, {
      view: { kind: 'closed' },
      codeText: null,
      ...handlers,
    });
    await fireEvent.click(screen.getByTestId('local-pairing-show'));
    expect(handlers.onShow).toHaveBeenCalledOnce();
    closed.unmount();

    render(LocalPairingCodePanel, {
      view: { kind: 'confirm-listener' },
      codeText: null,
      ...handlers,
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(handlers.onConfirmListener).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it('cancels an active code', async () => {
    const onCancel = vi.fn();
    render(LocalPairingCodePanel, {
      view: {
        kind: 'active',
        codeId: 'code-1',
        remainingMs: 60_000,
        attemptsRemaining: 5,
        cancelFailed: false,
      },
      codeText: 'KTP-82M',
      onShow: vi.fn(),
      onConfirmListener: vi.fn(),
      onCancel,
      onClose: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel code' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('removes an Intent from its row', async () => {
    const onRemove = vi.fn();
    render(LocalIntentsList, {
      credentials: [
        {
          credentialId: 'cred-1',
          appName: 'Intent Alpha',
          createdAt: '2026-11-12T10:00:00Z',
          lastUsedAt: null,
          connected: false,
        },
      ],
      removing: {},
      removeFailed: {},
      now: new Date('2026-11-12T10:05:00Z'),
      onRemove,
      onDismissFailure: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onRemove).toHaveBeenCalledWith('cred-1');
  });
});
