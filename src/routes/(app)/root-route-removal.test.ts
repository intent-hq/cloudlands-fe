import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoute = resolve(process.cwd(), 'src/routes/(app)');
const layoutSource = readFileSync(resolve(appRoute, '+layout.svelte'), 'utf8');
const uiTargetsSource = readFileSync(
  resolve(process.cwd(), 'src/shared/app-ui-targets.ts'),
  'utf8',
);
const initializerSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/workspace/CompactWorkspaceInitializer.svelte'),
  'utf8',
);
const windowSource = readFileSync(resolve(process.cwd(), 'src/main/window.ts'), 'utf8');

describe('root route removal', () => {
  it('does not ship a home page route', () => {
    expect(existsSync(resolve(appRoute, '+page.svelte'))).toBe(false);
    expect(uiTargetsSource).not.toContain("id: 'home'");
    expect(initializerSource).not.toContain('stayOnHomePage');
    expect(initializerSource).not.toContain('rapidFire');
    expect(layoutSource).not.toContain('workspace_home_');
    expect(
      existsSync(resolve(process.cwd(), 'src/lib/components/workspace/WorkspaceTableView.svelte')),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), 'src/lib/components/workspace/TaskFlameBar.svelte')),
    ).toBe(false);
  });

  it('redirects legacy root loads to a workspace or workspace creation', () => {
    expect(layoutSource).toContain("window.location.pathname !== '/'");
    expect(layoutSource).toContain("'/workspace/new'");
    expect(layoutSource).toContain('openWorkspaceTab(targetWorkspace.id)');
    expect(layoutSource).toContain('goto(target, { replaceState: true })');
  });

  it('opens fresh and legacy root windows on the workspace bootstrap route', () => {
    expect(windowSource).toContain("const DEFAULT_WINDOW_ROUTE = '/workspace/new'");
    expect(windowSource).toContain("session.route === '/' ? DEFAULT_WINDOW_ROUTE : session.route");
    expect(windowSource).toContain(
      'buildLoadUrl(`${DEFAULT_WINDOW_ROUTE}?deepLink=${encodedAction}`)',
    );
  });

  it('does not prune persisted tabs from partial workspace-list snapshots', () => {
    expect(layoutSource).not.toContain('cleanupInvalidWorkspaceTabs');
  });
});
