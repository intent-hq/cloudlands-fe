/**
 * @vitest-environment jsdom
 *
 * (app)/+error.svelte — 404s auto-redirect to the root home route instead of
 * rendering the error card; other statuses keep the existing error card, and
 * a 404 already at '/' renders the card to avoid a redirect loop.
 */
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  goto: vi.fn(() => Promise.resolve()),
  page: {
    error: null as { message: string } | null,
    status: 500,
    url: new URL('http://localhost/'),
  },
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToFirstWorkspace: vi.fn(() => Promise.resolve()),
}));

import ErrorPage from './+error.svelte';

function setPage(status: number, pathname: string, message = 'boom') {
  mocks.page.status = status;
  mocks.page.url = new URL(`http://localhost${pathname}`);
  mocks.page.error = { message };
}

describe('(app) +error page', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mocks.goto.mockClear();
  });

  it('redirects 404s on unknown routes to / without rendering the card', () => {
    setPage(404, '/nope', 'Not found: /nope');
    const { container } = render(ErrorPage);
    expect(mocks.goto).toHaveBeenCalledWith('/', { replaceState: true });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('logs the offending URL when redirecting a 404', () => {
    setPage(404, '/nope', 'Not found: /nope');
    render(ErrorPage);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('404'),
      expect.objectContaining({ url: 'http://localhost/nope', status: 404 }),
    );
  });

  it('renders the error card for a 404 already at / (no redirect loop)', () => {
    setPage(404, '/', 'Not found: /');
    const { container } = render(ErrorPage);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('renders the error card for non-404 statuses', () => {
    setPage(500, '/workspace/w-1', 'kaboom');
    const { container } = render(ErrorPage);
    expect(mocks.goto).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('kaboom');
  });
});
