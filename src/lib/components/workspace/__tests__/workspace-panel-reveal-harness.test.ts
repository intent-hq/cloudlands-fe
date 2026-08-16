import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const harnessSource = readFileSync(
  'src/lib/components/workspace/__tests__/mocks/WorkspaceColumnsRevealHarness.svelte',
  'utf8',
);
const runtimeSource = readFileSync(
  'src/lib/components/workspace/__tests__/mocks/WorkspaceColumnsRevealRuntime.svelte',
  'utf8',
);
const mountedTestSource = readFileSync(
  'src/lib/components/workspace/__tests__/workspace-panel-reveal.ct.spec.ts',
  'utf8',
);

describe('WorkspaceColumnsRevealHarness readiness contract', () => {
  it('renders readiness and initialization-error markers before loading the runtime', () => {
    expect(harnessSource).toContain('data-reveal-host');
    expect(harnessSource).toContain('data-reveal-ready={ready}');
    expect(harnessSource).toContain('data-reveal-initialization-error');
    expect(harnessSource).toContain("void import('./WorkspaceColumnsRevealRuntime.svelte')");
    expect(harnessSource).toContain('<svelte:boundary onerror={handleInitializationError}>');
  });

  it('owns store initialization and disposal inside the runtime provider', () => {
    expect(runtimeSource.indexOf('const disposeStore = appStore.init();')).toBeLessThan(
      runtimeSource.indexOf('appStore.dispatch('),
    );
    expect(runtimeSource).toContain('onReady();');
    expect(runtimeSource).toContain('onDestroy(disposeStore);');
  });

  it('requires mounted readiness and surfaces initialization errors before geometry checks', () => {
    expect(mountedTestSource).toContain('await expect(host).toBeVisible();');
    expect(mountedTestSource).toContain(
      'await expect(ready.or(initializationError)).toBeAttached();',
    );
    expect(mountedTestSource).toContain('WorkspaceColumnsRevealHarness initialization failed:');
    expect(mountedTestSource.indexOf('requireReadyHarness(component)')).toBeLessThan(
      mountedTestSource.indexOf('host.evaluate'),
    );
  });
});
