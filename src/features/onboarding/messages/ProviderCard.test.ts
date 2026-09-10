/**
 * @vitest-environment jsdom
 *
 * ProviderCard selected-state indicator: the picked (ready + selected) card
 * must render a full-width "SELECTED" banner instead of the previous
 * ring/outline + top-right check badge treatment. Unselected or not-ready
 * cards must render neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { runSaga } from 'redux-saga';
import { openClaudeLoginWorker } from '$store/renderer/slices/agent-availability/sagas/provider-availability-saga';
import { claudeLoginRequested } from '$store/renderer/slices/agent-availability/agent-availability-slice';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  return { dispatch };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      agentAvailability: {
        providerStatusMap: {},
        providerLoadingMap: {},
        hasCheckedOnce: true,
        watchedTerminalIds: {},
      },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

// REAL electron-bridge (overrides the global test-setup stub, which lacks
// `shell`): its invoke() routes through the mock IPC router, so the tests can
// assert the exact shell:openExternal wire request via registerMockIpcHandler.
vi.mock('$lib/electron-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/electron-bridge')>();
  return { ...actual };
});

import ProviderCard from './ProviderCard.svelte';
import type { ProviderCardData, ProviderBrandColors } from './ProviderCard.svelte';

const brand: ProviderBrandColors = { color1: '#8B8BF8cc', color2: '#8B8BF8' };

const readyProvider = (): ProviderCardData => ({
  id: 'claude-code',
  name: 'Claude Code',
  available: true,
  authenticated: true,
  statusLoading: false,
  authDetails: 'user@example.com',
  docsUrl: 'https://code.claude.com/docs',
  installCommand: 'curl -fsSL https://claude.ai/install.sh | bash',
});

const notInstalledProvider = (): ProviderCardData => ({
  ...readyProvider(),
  id: 'opencode',
  name: 'OpenCode',
  available: false,
  authenticated: undefined,
});

const baseProps = () => ({
  brand,
  onSelect: vi.fn(),
});

const banner = (root: HTMLElement) =>
  root.querySelector('[data-testid="provider-card-selected-banner"]');

/** Old check-badge signature (from commit 35f6cd52): a small circular
 *  bg-primary swatch pinned to the top-right of the card via top-3 right-3.
 *  A regression that reintroduced the badge would match this selector. */
const oldCheckBadge = (root: HTMLElement) =>
  root.querySelector('span.absolute.top-3.right-3.rounded-full');

beforeEach(() => {
  mocks.dispatch.mockReset();
});

describe('ProviderCard selected-state indicator', () => {
  it('does not present unknown Antigravity authentication as ready', async () => {
    const props = baseProps();
    const provider = {
      ...readyProvider(),
      id: 'antigravity',
      name: 'Antigravity',
      authenticated: undefined,
      docsUrl: '',
    };
    const result = render(ProviderCard, { props: { ...props, provider, selected: true } });
    expect(result.getByText('Sign-in status unknown. Refresh to check again.')).toBeTruthy();
    expect(banner(result.container)).toBeNull();
    expect(result.queryByText('Connected')).toBeNull();
    expect(result.queryByText('intentd provider login antigravity')).toBeNull();
    await fireEvent.click(result.getByText('Antigravity'));
    expect(props.onSelect).not.toHaveBeenCalled();
  });
  it('renders the full-width SELECTED banner when the ready card is selected', () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: readyProvider(), selected: true },
    });

    const el = banner(container);
    expect(el).not.toBeNull();
    expect(el?.textContent?.trim().toLowerCase()).toBe('selected');
    // Spans the full card width — anchored at the top edge, inset-x-0.
    expect(el?.className).toContain('inset-x-0');
    expect(el?.className).toContain('top-0');
  });

  it('does not render the SELECTED banner when the ready card is unselected', () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: readyProvider(), selected: false },
    });
    expect(banner(container)).toBeNull();
  });

  it('does not render the SELECTED banner when the card is not ready', () => {
    // A card marked `selected` but not ready (e.g. not installed) must not
    // render the banner — selection is only meaningful for ready cards.
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: notInstalledProvider(), selected: true },
    });
    expect(banner(container)).toBeNull();
  });

  it('does not render the old top-right check badge on a selected card (regression)', () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: readyProvider(), selected: true },
    });
    expect(oldCheckBadge(container)).toBeNull();
  });

  it('keeps aria-pressed on ready cards to signal selection to assistive tech', () => {
    const { container, rerender } = render(ProviderCard, {
      props: { ...baseProps(), provider: readyProvider(), selected: true },
    });
    // Ready cards expose aria-pressed on the outer card element to signal
    // selection state (they are also clickable: role="button" + tabindex=0).
    const card = container.querySelector('[aria-pressed]');
    expect(card?.getAttribute('aria-pressed')).toBe('true');

    rerender({ ...baseProps(), provider: readyProvider(), selected: false });
    const card2 = container.querySelector('[aria-pressed]');
    expect(card2?.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('ProviderCard needsLogin derivation', () => {
  it('offers login only while authentication is explicitly false', async () => {
    const { getByRole, queryByRole, rerender } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), authenticated: false, authDetails: undefined },
      },
    });
    expect(getByRole('button', { name: 'Log in', exact: true })).toHaveProperty('disabled', false);
    await rerender({ ...baseProps(), provider: readyProvider() });
    expect(queryByRole('button', { name: 'Log in', exact: true })).toBeNull();
  });

  it('treats an unknown auth verdict (authenticated: undefined) as ready, not needs-login', () => {
    const { queryByRole } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), authenticated: undefined, authDetails: undefined },
      },
    });
    expect(queryByRole('button', { name: 'Log in', exact: true })).toBeNull();
  });
});

describe('ProviderCard identity line', () => {
  const identityLine = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('div')).find((el) => el.textContent?.trim().startsWith('as '));

  it('renders the daemon-supplied identity next to the connected state for a ready card', () => {
    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), authDetails: 'dev@example.com · Example Org' },
        selected: false,
      },
    });
    expect(container.textContent).toContain('Connected');
    expect(identityLine(container)?.textContent).toContain('dev@example.com · Example Org');
  });

  it('renders the bare connected state when the daemon sent no identity', () => {
    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), authDetails: undefined },
        selected: false,
      },
    });
    expect(container.textContent).toContain('Connected');
    expect(identityLine(container)).toBeUndefined();
  });

  it('does not render the identity line while the card needs login', () => {
    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), authenticated: false, authDetails: 'dev@example.com' },
        selected: false,
      },
    });
    expect(container.textContent).toContain('Log in');
    expect(container.textContent).not.toContain('Connected');
    expect(identityLine(container)).toBeUndefined();
    expect(container.textContent).not.toContain('dev@example.com');
  });
});

describe('ProviderCard login guidance', () => {
  const loginHint = (root: HTMLElement) =>
    root.querySelector('[data-testid="provider-card-login-hint"]');

  beforeEach(() => {
    mocks.dispatch.mockImplementation((action) => {
      if (action.type === claudeLoginRequested.type) {
        void runSaga({ dispatch: mocks.dispatch }, openClaudeLoginWorker, action).toPromise();
      }
      return action;
    });
  });

  afterEach(() => {
    unregisterMockIpcHandler('terminal:createWithCommand');
    unregisterMockIpcHandler('shell:openExternal');
  });

  const needsLoginProvider = (overrides: Partial<ProviderCardData> = {}): ProviderCardData => ({
    ...readyProvider(),
    authenticated: false,
    authDetails: undefined,
    loginCommandHint: 'claude auth login',
    ...overrides,
  });

  it('shows the catalog login command with a copy control when login is needed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: needsLoginProvider({
          id: 'codex',
          name: 'Codex',
          loginCommandHint: 'codex login',
        }),
      },
    });

    const hint = loginHint(container);
    expect(hint).not.toBeNull();

    await fireEvent.click(hint!.querySelector('button')!);
    expect(writeText).toHaveBeenCalledWith('codex login');
  });

  it('falls back to no command hint when the catalog carries none', () => {
    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: needsLoginProvider({ loginCommandHint: undefined }),
      },
    });
    expect(loginHint(container)).toBeNull();
  });

  it('hides the login command when the provider does not need login', () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: { ...readyProvider(), loginCommandHint: 'x login' } },
    });
    expect(loginHint(container)).toBeNull();
  });

  it.each(['claude auth login', undefined])(
    'starts Claude login and opens its root drawer terminal with catalog hint %s',
    async (loginCommandHint) => {
      const createTerminal = vi.fn().mockResolvedValue({ ok: true, terminalId: 'login-terminal' });
      const openExternal = vi.fn();
      registerMockIpcHandler('terminal:createWithCommand', createTerminal);
      registerMockIpcHandler('shell:openExternal', openExternal);
      const props = { ...baseProps(), provider: needsLoginProvider({ loginCommandHint }) };
      const { getByRole } = render(ProviderCard, { props });
      const login = getByRole('button', { name: 'Log in', exact: true });

      const defaultAllowed = await fireEvent.keyDown(login, { key: 'Enter' });
      expect(defaultAllowed).toBe(true);
      expect(openExternal).not.toHaveBeenCalled();
      await fireEvent.click(login);

      await waitFor(() => {
        expect(createTerminal).toHaveBeenCalledExactlyOnceWith({
          workspaceId: '__root__',
          command: 'claude auth login',
        });
        expect(mocks.dispatch).toHaveBeenCalledWith({
          type: 'terminals/open',
          payload: ['__root__', 'login-terminal'],
        });
      });
      expect(openExternal).not.toHaveBeenCalled();
      expect(props.onSelect).not.toHaveBeenCalled();
    },
  );

  it('prevents duplicate launches while opening and allows retry after failure', async () => {
    let resolveLaunch!: (value: { ok: boolean; error: string }) => void;
    const createTerminal = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLaunch = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, terminalId: 'retry-terminal' });
    registerMockIpcHandler('terminal:createWithCommand', createTerminal);
    const { getByRole } = render(ProviderCard, {
      props: { ...baseProps(), provider: needsLoginProvider() },
    });
    const login = getByRole('button', { name: 'Log in', exact: true });
    await fireEvent.click(login);
    login.click();
    expect(login).toHaveProperty('disabled', true);
    expect(createTerminal).toHaveBeenCalledTimes(1);

    resolveLaunch({ ok: false, error: 'Terminal unavailable' });
    await waitFor(() => expect(getByRole('alert').textContent).toContain('Terminal unavailable'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminals/open' }),
    );
    expect(login).toHaveProperty('disabled', false);
    await fireEvent.click(login);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'terminals/open',
        payload: ['__root__', 'retry-terminal'],
      }),
    );
  });

  it('surfaces a rejected terminal request without opening an empty drawer', async () => {
    registerMockIpcHandler('terminal:createWithCommand', () => {
      throw new Error('Connection lost');
    });
    const { getByRole } = render(ProviderCard, {
      props: { ...baseProps(), provider: needsLoginProvider() },
    });
    await fireEvent.click(getByRole('button', { name: 'Log in', exact: true }));
    await waitFor(() => expect(getByRole('alert').textContent).toContain('Connection lost'));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminals/open' }),
    );
  });
});

describe('ProviderCard click affordance', () => {
  const card = (root: HTMLElement) => root.querySelector('.group\\/card') as HTMLElement;

  it('marks ready cards as clickable: pointer cursor, role=button, tabindex=0', () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: readyProvider() },
    });

    const el = card(container);
    expect(el.className).toContain('cursor-pointer');
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('tabindex')).toBe('0');
    // Border must stay border-border for ready cards (no visual regression).
    expect(el.className).toContain('border-border');
  });

  it('keeps loading cards non-interactive with the default cursor', () => {
    const { container } = render(ProviderCard, {
      props: {
        ...baseProps(),
        provider: { ...readyProvider(), statusLoading: true, available: false },
      },
    });

    const el = card(container);
    expect(el.className).toContain('cursor-default');
    expect(el.getAttribute('role')).toBeNull();
    expect(el.getAttribute('tabindex')).toBeNull();
  });
});

describe('ProviderCard auggie link-out click behavior', () => {
  const card = (root: HTMLElement) => root.querySelector('.group\\/card') as HTMLElement;
  const instructionsPanel = (root: HTMLElement) =>
    root.querySelector('[data-testid="auggie-instructions-panel"]');

  const AUGGIE_DOCS_URL = 'https://docs.augmentcode.com/cli/overview';

  const auggieProvider = (overrides: Partial<ProviderCardData> = {}): ProviderCardData => ({
    ...readyProvider(),
    id: 'auggie',
    name: 'Auggie',
    docsUrl: AUGGIE_DOCS_URL,
    installCommand: 'npm install -g @augmentcode/auggie',
    ...overrides,
  });

  let openExternal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openExternal = vi.fn().mockResolvedValue(undefined);
    registerMockIpcHandler('shell:openExternal', openExternal);
  });

  afterEach(() => {
    unregisterMockIpcHandler('shell:openExternal');
  });

  it('opens the docs URL via shell:openExternal when auggie is not installed', async () => {
    const props = {
      ...baseProps(),
      provider: auggieProvider({ available: false, authenticated: undefined }),
    };
    const { container } = render(ProviderCard, { props });

    const el = card(container);
    expect(el.className).toContain('cursor-pointer');
    expect(el.getAttribute('role')).toBe('button');

    await fireEvent.click(el);
    await Promise.resolve();

    // Exact wire request: shell:openExternal with the { url } payload.
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith({ url: AUGGIE_DOCS_URL });
    expect(props.onSelect).not.toHaveBeenCalled();
    // No inline instructions render anywhere in the card.
    expect(instructionsPanel(container)).toBeNull();
  });

  it('opens the docs URL when auggie is installed but not logged in', async () => {
    const props = {
      ...baseProps(),
      provider: auggieProvider({ authenticated: false, authDetails: undefined }),
    };
    const { container } = render(ProviderCard, { props });

    await fireEvent.click(card(container));
    await Promise.resolve();

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith({ url: AUGGIE_DOCS_URL });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(instructionsPanel(container)).toBeNull();
  });

  it('selects a ready auggie card instead of opening docs', async () => {
    const props = { ...baseProps(), provider: auggieProvider() };
    const { container } = render(ProviderCard, { props });

    await fireEvent.click(card(container));
    await Promise.resolve();

    expect(props.onSelect).toHaveBeenCalledWith('auggie');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
