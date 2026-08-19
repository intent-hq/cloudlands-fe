/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import ChatPolishCatalogPreview from './ChatPolishCatalogPreview.svelte';

const fixture = {
  id: 'comprehensive-conversation',
  title: 'Comprehensive conversation',
  states: ['deterministic'],
  viewport: 'both' as const,
};

describe('ChatPolishCatalogPreview', () => {
  beforeAll(() => appStore.init());
  afterEach(cleanup);

  it('renders one read-only production conversation without dispatching', async () => {
    const dispatch = vi.spyOn(appStore, 'dispatch');
    const view = render(ChatPolishCatalogPreview, { props: { fixture } });
    expect(screen.getAllByTestId('chat-polish-conversation')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-preview-message-role="user"]')).toHaveLength(9);
    expect(screen.getByTestId('chat-message-file-chip')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('chat-message-file-chip'));
    expect(dispatch).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('renders grouped, streaming, failed, and expanded production paths together', async () => {
    const view = render(ChatPolishCatalogPreview, { props: { fixture } });
    expect(view.container.querySelector('[data-tool-executing]')).toBeTruthy();
    expect(
      view.container.querySelectorAll('[data-testid="response-group-summary"]').length,
    ).toBeGreaterThanOrEqual(4);
    const failedTool = view.container.querySelector(
      '[data-tool-use-id="fixture-command-failed"]',
    ) as HTMLElement;
    await waitFor(() =>
      expect(failedTool.querySelector('[data-tool-status="error"]')).toBeTruthy(),
    );
    await fireEvent.click(failedTool.querySelector('[data-testid="tool-call-summary"]')!);
    expect(view.container.textContent).toContain('Command failed with exit code 1.');
  });

  it('renders both subscription cohorts and avatar overflow', () => {
    const view = render(ChatPolishCatalogPreview, { props: { fixture } });
    expect(view.container.querySelectorAll('[data-subscription-cohort="after_all"]')).toHaveLength(
      2,
    );
    expect(view.container.querySelectorAll('[data-subscription-cohort="immediate"]')).toHaveLength(
      1,
    );
    expect(
      view.container.querySelectorAll('[data-testid="event-subscriptions-card"]'),
    ).toHaveLength(3);
    expect(
      view.container.querySelectorAll('[data-testid="agent-list-item"]').length,
    ).toBeGreaterThan(6);
  });

  it('keeps long labels accessible while their visible row can truncate', () => {
    const view = render(ChatPolishCatalogPreview, { props: { fixture } });
    const longLabel = view.container.querySelector(
      '[data-tool-use-id="fixture-long-payload"] [data-testid="tool-call-disclosure"]',
    );
    expect(longLabel?.getAttribute('aria-label')).toContain('ThisIsAnIntentionallyLong');
    expect(longLabel?.getAttribute('title')).toBeTruthy();
  });
});
