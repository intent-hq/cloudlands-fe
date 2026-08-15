import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function expectHydrateOpenNavigateOrder(content: string): void {
  const hydrateIndex = content.indexOf('hydrateWorkspaceNavigation(workspace.id');
  const openIndex = content.indexOf('appStore.dispatch(openWorkspaceTab(workspace.id))');
  const navigateIndex = content.indexOf('await goto(`/workspace/${workspace.id}`', openIndex);

  expect(hydrateIndex).toBeGreaterThan(-1);
  expect(openIndex).toBeGreaterThan(hydrateIndex);
  expect(navigateIndex).toBeGreaterThan(openIndex);
}

describe('workspace creation auto-open contract', () => {
  it('selects the created workspace after hydrating its initial agent in both creation flows', () => {
    expectHydrateOpenNavigateOrder(
      source('src/lib/components/workspace/CompactWorkspaceInitializer.svelte'),
    );
    expectHydrateOpenNavigateOrder(source('src/features/onboarding/OnboardingPage.svelte'));
  });

  it('seeds the panel layout before attachment delivery and keeps legacy navigation empty', () => {
    const initializer = source('src/lib/components/workspace/CompactWorkspaceInitializer.svelte');
    const bootstrapIndex = initializer.indexOf('bootstrapNewWorkspaceLayout(');
    const attachmentIndex = initializer.indexOf('await redeemStagedAttachments(');

    expect(bootstrapIndex).toBeGreaterThan(-1);
    expect(attachmentIndex).toBeGreaterThan(bootstrapIndex);
    expect(initializer).toContain("mainPanel: { type: 'empty' }");
    expect(initializer).toContain('drawer: { open: false, type: null, itemId: null }');
  });

  it('reveals selected horizontal workspaces once after width expansion settles', () => {
    const columns = source('src/lib/components/workspace/WorkspaceColumnsView.svelte');

    expect(columns).toContain('const workspaceId = $currentWorkspaceId$;');
    expect(columns).toContain('void tick().then(() => {');
    expect(columns).toContain('scheduleRevealAfterLayout((behavior) => {');
    expect(columns).toContain('LAYOUT_WIDTH_SETTLE_MS');
    expect(columns).toContain(
      'scrollWorkspaceColumnIntoView(scroller, workspaceId, resolvedBehavior, inline)',
    );
    expect(columns.match(/reveal\(behavior\)/g)).toHaveLength(1);
  });
});
