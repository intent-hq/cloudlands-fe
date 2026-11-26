/**
 * A writable stand-in for SvelteKit's `$app/stores` `page`, for tests that
 * mount route layouts outside the router. `setPage(path)` updates every
 * subscriber, the way a client-side navigation does.
 */
import { writable } from 'svelte/store';

type FakePage = {
  url: URL;
  params: Record<string, string>;
  route: { id: string };
};

function pageFor(pathname: string, params: Record<string, string> = {}): FakePage {
  return { url: new URL(pathname, 'http://localhost'), params, route: { id: pathname } };
}

export const page = writable<FakePage>(pageFor('/'));

export function setPage(pathname: string, params: Record<string, string> = {}): void {
  window.history.replaceState({}, '', pathname);
  page.set(pageFor(pathname, params));
}
