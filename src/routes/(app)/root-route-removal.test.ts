import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoute = resolve(process.cwd(), 'src/routes/(app)');
const layoutSource = readFileSync(resolve(appRoute, '+layout.svelte'), 'utf8');
const uiTargetsSource = readFileSync(
  resolve(process.cwd(), 'src/shared/app-ui-targets.ts'),
  'utf8',
);
const windowSource = readFileSync(resolve(process.cwd(), 'src/main/window.ts'), 'utf8');

describe('root route removal', () => {
  it('ships only the minimal home empty state, not the legacy home page', () => {
    const pageSource = readFileSync(resolve(appRoute, '+page.svelte'), 'utf8');
    expect(pageSource).toContain('navigateToNewWorkspace()');
    expect(pageSource).not.toContain('workspace_home_');
    expect(uiTargetsSource).not.toContain("id: 'home'");
    expect(
      existsSync(
        resolve(process.cwd(), 'src/lib/components/workspace/workspace creation shell.svelte'),
      ),
    ).toBe(false);
    expect(layoutSource).not.toContain('workspace_home_');
    expect(
      existsSync(resolve(process.cwd(), 'src/lib/components/workspace/WorkspaceTableView.svelte')),
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), 'src/lib/components/workspace/TaskFlameBar.svelte')),
    ).toBe(false);
  });

  it('routes boot and legacy root loads through the backend-derived setup gate', () => {
    expect(layoutSource).toContain('decideBootRoute({');
    expect(layoutSource).toContain('openWorkspaceTab(decision.openTabWorkspaceId)');
    expect(layoutSource).toContain('bootRouteGateResolved()');
    expect(layoutSource).toContain('goto(decision.target, { replaceState: true })');
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
