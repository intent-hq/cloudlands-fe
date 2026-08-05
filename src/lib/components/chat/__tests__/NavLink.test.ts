/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { warmImport } from '../../../../test/warm-import';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  goto: vi.fn(() => Promise.resolve()),
  handleIntentLink: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: mocks.dispatch,
    state: {},
  },
}));
vi.mock('$lib/utils/workspaces-link-handler', () => ({
  handleIntentLink: mocks.handleIntentLink,
}));

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.goto.mockClear();
  mocks.handleIntentLink.mockClear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../NavLink.svelte'));

describe('NavLink', () => {
  it('dispatches the canonical registry target for known hash aliases', async () => {
    const NavLink = (await import('../NavLink.svelte')).default;
    render(NavLink, { props: { target: '/settings#default-model', label: 'Default model' } });

    await fireEvent.click(screen.getByRole('link', { name: /Default model/ }));

    expect(mocks.goto).toHaveBeenCalledWith('/settings#default-model');
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'uiHighlight/requestUiHighlight',
        payload: ['backgroundAgents.defaultModel'],
      }),
    );
  });

  it('falls back to the raw hash on a resolvable path when no registry target matches', async () => {
    // /workspace/{id} passes the resolvable check (dynamic route); the hash
    // itself isn't in the registry, so we expect the raw-hash fallback.
    const NavLink = (await import('../NavLink.svelte')).default;
    render(NavLink, {
      props: { target: '/workspace/abc-123#unknown-target', label: 'Workspace anchor' },
    });

    await fireEvent.click(screen.getByRole('link', { name: /Workspace anchor/ }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'uiHighlight/requestUiHighlight',
        payload: ['unknown-target'],
      }),
    );
  });

  it('routes intent:// targets through the workspaces link handler instead of goto', async () => {
    const NavLink = (await import('../NavLink.svelte')).default;
    const target = 'intent://local/ws-123/note/note-456';
    render(NavLink, { props: { target, label: 'Open note' } });

    await fireEvent.click(screen.getByRole('link', { name: /Open note/ }));

    await waitFor(() => expect(mocks.handleIntentLink).toHaveBeenCalledWith(target));
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('routes short-form intent:// note targets through the workspaces link handler', async () => {
    const NavLink = (await import('../NavLink.svelte')).default;
    const target = 'intent://local/note/spec';
    render(NavLink, { props: { target, label: 'Spec' } });

    await fireEvent.click(screen.getByRole('link', { name: /Spec/ }));

    await waitFor(() => expect(mocks.handleIntentLink).toHaveBeenCalledWith(target));
    expect(mocks.goto).not.toHaveBeenCalled();
  });

  it('renders as plain text (no anchor) when the target does not resolve', async () => {
    const NavLink = (await import('../NavLink.svelte')).default;
    render(NavLink, { props: { target: '/specialists', label: 'Open Specialists' } });

    expect(screen.queryByRole('link')).toBeNull();
    const fallback = screen.getByText('Open Specialists');
    expect(fallback.tagName).toBe('SPAN');
    expect(fallback.hasAttribute('data-nav-link-unresolved')).toBe(true);

    await fireEvent.click(fallback);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('renders nothing when both target and label are empty/unresolvable without a label', async () => {
    const NavLink = (await import('../NavLink.svelte')).default;
    const { container } = render(NavLink, { props: { target: '', label: '' } });

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-nav-link-unresolved]')).toBeNull();
  });
});
