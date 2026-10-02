import { fileURLToPath } from 'node:url';
import { runSandbox, parseSandboxArgs } from './runner.mjs';

if (!process.argv[2] || process.argv[2] === 'native') {
  await runSandbox(
    parseSandboxArgs([
      'button',
      '--state',
      'default',
      '--width',
      '1280',
      '--base-url',
      process.env.HOME_ORG_BASE_URL ?? 'http://127.0.0.1:5636',
    ]),
    async ({ page }) => {
      await page.evaluate(async () => {
        const [{ resolveBackendTransport }, { createElectronIpcBackendTransport }] =
          await Promise.all([
            import('/src/lib/client/live/backend-transport-factory.ts'),
            import('/src/lib/client/live/electron-ipc-transport.ts'),
          ]);
        resolveBackendTransport().request = createElectronIpcBackendTransport().request;
        const [{ mount }, { default: Harness }] = await Promise.all([
          import('/node_modules/svelte/src/index-client.js'),
          import('/src/features/home/home-integrations-harness.svelte'),
        ]);
        const target = document.createElement('div');
        target.id = 'org-test';
        target.style = 'position:fixed;inset:0;background:var(--background);z-index:1';
        document.body.append(target);
        mount(Harness, { target, props: { organization: 'acme', repoCount: 0 } });
      });
      const root = page.locator('#org-test');
      const list = root.getByRole('listbox', { name: 'Pull requests' });
      await list
        .getByRole('option')
        .waitFor({ timeout: 10000 })
        .catch(async (e) => {
          console.log(await root.innerText());
          console.log(await page.evaluate(() => window.__homeIntegrationBrowser?.calls));
          throw e;
        });
      if (!(await list.innerText()).includes('outside-sidebar'))
        throw Error('Missing repository outside sidebar');
      const calls = () => page.evaluate(() => window.__homeIntegrationBrowser.calls);
      const searches = async () =>
        (await calls()).filter((c) => c.method === 'github.pulls.search');
      const first = (await searches())[0].params;
      if (first.org !== 'acme' || 'owner' in first || 'repo' in first || 'repos' in first)
        throw Error('Organization request narrowed to repository');
      await root.getByRole('button', { name: 'Load more', exact: true }).click();
      await page.waitForFunction(
        () => document.querySelectorAll('#org-test [role=option]').length === 2,
      );
      if ((await searches())[1].params.nextToken !== 'org-page-two')
        throw Error('Organization cursor not used');
      await root.getByRole('searchbox').fill('stale');
      await page.waitForFunction(() =>
        window.__homeIntegrationBrowser.calls.some((c) => c.params.query === 'stale'),
      );
      await page.evaluate(async () => {
        const [{ store }, { mountHomeIntegrations }] = await Promise.all([
          import('/src/store/renderer/store.ts'),
          import('/src/features/home/home-integrations-slice.ts'),
        ]);
        store.dispatch(
          mountHomeIntegrations({
            kind: 'prs',
            repositories: [],
            organization: 'other-org',
            workspaceId: 'home-route',
          }),
        );
      });
      await page.waitForFunction(() =>
        document.querySelector('#org-test [role=listbox]')?.textContent.includes('other-org'),
      );
      await page.evaluate(() => window.__homeIntegrationBrowser.releaseSearch());
      if ((await list.innerText()).includes('Stale search response'))
        throw Error('Stale organization result crossed scope');
      await list.getByRole('option').click();
      await page.waitForFunction(() =>
        window.__homeIntegrationBrowser.calls.some(
          (c) =>
            c.method === 'github.pulls.get' &&
            c.params.owner === 'other-org' &&
            c.params.repo === 'outside-sidebar',
        ),
      );
      await page.screenshot({
        path: fileURLToPath(
          new URL('../../.demo-artifacts/home-org-pr-search.png', import.meta.url),
        ),
      });
      console.log(
        'PASS org-only wire scope, unseen repository, cursor, stale org cancellation, hit-specific detail',
      );
    },
  );
}

if (!process.argv[2] || process.argv[2] === 'legacy') {
  await runSandbox(
    parseSandboxArgs([
      'button',
      '--state',
      'default',
      '--width',
      '1280',
      '--base-url',
      process.env.HOME_ORG_BASE_URL ?? 'http://127.0.0.1:5636',
    ]),
    async ({ page }) => {
      await page.evaluate(async () => {
        const [{ resolveBackendTransport }, { createElectronIpcBackendTransport }] =
          await Promise.all([
            import('/src/lib/client/live/backend-transport-factory.ts'),
            import('/src/lib/client/live/electron-ipc-transport.ts'),
          ]);
        resolveBackendTransport().request = createElectronIpcBackendTransport().request;
        const [{ mount }, { default: Harness }] = await Promise.all([
          import('/node_modules/svelte/src/index-client.js'),
          import('/src/features/home/home-integrations-harness.svelte'),
        ]);
        const target = document.createElement('div');
        target.id = 'org-test';
        target.style = 'position:fixed;inset:0;background:var(--background);z-index:1';
        document.body.append(target);
        mount(Harness, { target, props: { organization: 'legacy-acme', repoCount: 0 } });
      });
      await page.waitForFunction(
        () => document.querySelectorAll('#org-test [role=option]').length === 2,
      );
      const calls = await page.evaluate(() => window.__homeIntegrationBrowser.calls);
      const repos = calls.filter((c) => c.method === 'github.repos.search');
      const batches = calls.filter((c) => c.method === 'github.pulls.search' && c.params.repo);
      if (
        repos.length !== 2 ||
        repos[1].params.nextToken !== 'repos-two' ||
        batches.length !== 2 ||
        batches[0].params.repos.length !== 5 ||
        batches[0].params.repo !== 'outside-sidebar' ||
        batches[1].params.repo !== 'repo7'
      )
        throw Error('Legacy enumeration or batching failed');
      await page.screenshot({
        path: fileURLToPath(
          new URL('../../.demo-artifacts/home-org-pr-legacy.png', import.meta.url),
        ),
      });
      console.log(
        'PASS legacy org enumeration spans all pages and outside-sidebar repositories in bounded PR batches',
      );
    },
  );
}

if (!process.argv[2] || process.argv[2] === 'incomplete') {
  await runSandbox(
    parseSandboxArgs([
      'button',
      '--state',
      'default',
      '--width',
      '1280',
      '--base-url',
      process.env.HOME_ORG_BASE_URL ?? 'http://127.0.0.1:5636',
    ]),
    async ({ page }) => {
      await page.evaluate(async () => {
        const [{ resolveBackendTransport }, { createElectronIpcBackendTransport }] =
          await Promise.all([
            import('/src/lib/client/live/backend-transport-factory.ts'),
            import('/src/lib/client/live/electron-ipc-transport.ts'),
          ]);
        resolveBackendTransport().request = createElectronIpcBackendTransport().request;
        const [{ mount }, { default: Harness }] = await Promise.all([
          import('/node_modules/svelte/src/index-client.js'),
          import('/src/features/home/home-integrations-harness.svelte'),
        ]);
        const target = document.createElement('div');
        target.id = 'org-test';
        target.style = 'position:fixed;inset:0;background:var(--background);z-index:1';
        document.body.append(target);
        mount(Harness, { target, props: { organization: 'legacy-loop', repoCount: 0 } });
      });
      const root = page.locator('#org-test');
      await root.getByRole('alert').waitFor();
      if (!(await root.getByRole('alert').innerText()).includes('complete repository list'))
        throw Error(await root.innerText());
      const calls = await page.evaluate(() => window.__homeIntegrationBrowser.calls);
      if (
        calls.filter((c) => c.method === 'github.repos.search').length !== 2 ||
        calls.filter((c) => c.method === 'github.pulls.search').length !== 1
      )
        throw Error('Partial enumeration must never search subset');
      await page.screenshot({
        path: fileURLToPath(
          new URL('../../.demo-artifacts/home-org-pr-incomplete.png', import.meta.url),
        ),
      });
      console.log('PASS repeated repository cursor refuses partial organization search');
    },
  );
}
