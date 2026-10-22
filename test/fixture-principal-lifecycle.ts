import { expect, type Page, type TestInfo } from '@playwright/test';

type Fixture = 'SidebarLauncherHost' | 'TitlebarWorkspaceControlsHarness';

export async function checkFixturePrincipalLifecycle(
  page: Page,
  info: TestInfo,
  baseUrl: string,
  fixture: Fixture,
  borrowed: boolean,
) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}test/fixtures/titlebar-controls.html`);
  const result = await page.evaluate(
    async ({ fixture, borrowed }) => {
      // The existing bootstrap flag permits a test-owned store outside component
      // initialization. Only the real principal helper establishes authority.
      Object.assign(window, {
        process: { env: { NODE_ENV: 'test' } },
        __PLAYWRIGHT_CT_STORE_BOOTSTRAP__: true,
        electronAPI: {
          invoke: async (channel: string) => {
            if (channel !== 'window:get-zoom-factor') throw new Error(`Unexpected IPC ${channel}`);
            return { success: true, data: 1 };
          },
          on: (channel: string, handler: (payload: unknown) => void) => {
            const listener = (event: Event) => handler((event as CustomEvent).detail);
            window.addEventListener(channel, listener);
            return () => window.removeEventListener(channel, listener);
          },
          offById: (remove: () => void) => remove(),
        },
      });
      const [
        { mount, unmount, tick },
        { store },
        { admitLegacyPrincipal },
        principal,
        guest,
        host,
      ] = await Promise.all([
        import('/@id/svelte'),
        import('/src/store/renderer/store.ts'),
        import('/src/test/fixtures/principal-state.ts'),
        import('/src/store/renderer/slices/principal/principal-slice.ts'),
        import('/src/store/renderer/slices/guest-sessions/guest-sessions-slice.ts'),
        import(`/test/fixtures/${fixture}.svelte`),
      ]);
      const disposeBorrowed = borrowed ? store.init() : undefined;
      if (borrowed) admitLegacyPrincipal('guest');
      const before = borrowed ? structuredClone(store.state.principal) : principal.initialState;
      const target = document.createElement('div');
      document.body.replaceChildren(target);
      try {
        const instance = mount(host.default, {
          target,
          props: { width: 320, zoom: 1, theme: 'light', selectedTab: 'overview' },
        });
        await tick();
        const mounted = structuredClone(store.state.principal);
        let unmountError: string | null = null;
        try {
          await unmount(instance);
          await tick();
        } catch (error) {
          unmountError = String(error);
        }
        let after = null;
        let stateError: string | null = null;
        let dispatchError: string | null = null;
        try {
          after = structuredClone(store.getStoreStateSnapshot().principal);
        } catch (error) {
          stateError = String(error);
        }
        try {
          store.dispatch(guest.guestSessionsListUnavailable());
        } catch (error) {
          dispatchError = String(error);
        }
        return { before, mounted, after, unmountError, stateError, dispatchError };
      } finally {
        disposeBorrowed?.();
        // Close any store left live by a failing unmount.
        store.dispose();
      }
    },
    { fixture, borrowed },
  );
  await info.attach('principal-lifecycle', {
    body: JSON.stringify({ fixture, borrowed, actualUrl: baseUrl, ...result, pageErrors }, null, 2),
    contentType: 'application/json',
  });
  expect(result.mounted.snapshot?.principal.isAdministrator).toBe(true);
  expect(result.unmountError).toBeNull();
  expect(pageErrors).toEqual([]);
  if (borrowed) {
    expect(result.stateError).toBeNull();
    expect(result.dispatchError).toBeNull();
    expect(result.after).toEqual(result.before);
    if (borrowed) expect(result.after.snapshot.principal.isAdministrator).toBe(false);
  } else {
    expect(result.stateError).toContain('before Store.init() has been called');
    expect(result.dispatchError).toContain('before Store.init() has been called');
  }
}
