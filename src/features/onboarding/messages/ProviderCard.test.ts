/**
 * @vitest-environment jsdom
 *
 * ProviderCard selected-state indicator: the picked (ready + selected) card
 * must render a full-width "SELECTED" banner instead of the previous
 * ring/outline + top-right check badge treatment. Unselected or not-ready
 * cards must render neither.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  return { dispatch };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
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
  loginCommand: 'claude auth login',
  description: '',
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
  auggieNeedsUpdate: false,
  auggieActionInProgress: false,
  auggieInstructions: null,
  auggieCommand: null,
  onSelect: vi.fn(),
  onAuggieInstall: vi.fn(),
  onAuggieLogin: vi.fn(),
  onAuggieRecheck: vi.fn(),
  onAuggieDismissInstructions: vi.fn(),
});

const banner = (root: HTMLElement) =>
  root.querySelector('[data-testid="provider-card-selected-banner"]');

/** Old check-badge signature (from commit 35f6cd52): a small circular
 *  bg-primary swatch pinned to the top-right of the card via top-3 right-3.
 *  A regression that reintroduced the badge would match this selector. */
const oldCheckBadge = (root: HTMLElement) =>
  root.querySelector('span.absolute.top-3.right-3.rounded-full');

beforeEach(() => {
  mocks.dispatch.mockClear();
});

describe('ProviderCard selected-state indicator', () => {
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
    // Ready cards expose aria-pressed on the outer card element regardless of
    // whether role="button" is set (cardClickable is scoped to non-ready cards
    // / auggie-needs-action; ready cards click via the always-bound onclick).
    const card = container.querySelector('[aria-pressed]');
    expect(card?.getAttribute('aria-pressed')).toBe('true');

    rerender({ ...baseProps(), provider: readyProvider(), selected: false });
    const card2 = container.querySelector('[aria-pressed]');
    expect(card2?.getAttribute('aria-pressed')).toBe('false');
  });
});
