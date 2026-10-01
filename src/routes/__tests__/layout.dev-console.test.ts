import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
const start = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock('$store/renderer/root-store-lifecycle', () => ({ startRootStoreLifecycle: start }));
import Layout from '../+layout.svelte';
afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});
it('does not start app store lifecycle or splash backend boot for the diagnostic route', () => {
  window.history.pushState({}, '', '/dev-console');
  render(Layout);
  expect(start).not.toHaveBeenCalled();
});
