import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function expectHydrateOpenNavigateOrder(content: string): void {
  const bootstrapIndex = content.indexOf('bootstrapNewWorkspaceLayout(');
  const hydrateIndex = content.indexOf('hydrateWorkspaceNavigation(workspace.id');
  const openIndex = content.indexOf('appStore.dispatch(openWorkspaceTab(workspace.id))');
  const navigateIndex = content.indexOf('await goto(`/workspace/${workspace.id}`', openIndex);

  expect(bootstrapIndex).toBeGreaterThan(-1);
  expect(hydrateIndex).toBeGreaterThan(bootstrapIndex);
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

  it('seeds the panel layout before attachment delivery in both creation flows', () => {
    for (const path of [
      'src/lib/components/workspace/CompactWorkspaceInitializer.svelte',
      'src/features/onboarding/OnboardingPage.svelte',
    ]) {
      const content = source(path);
      const bootstrapIndex = content.indexOf('bootstrapNewWorkspaceLayout(');
      const attachmentIndex = content.indexOf('await redeemStagedAttachments(', bootstrapIndex);

      expect(bootstrapIndex).toBeGreaterThan(-1);
      expect(attachmentIndex).toBeGreaterThan(bootstrapIndex);
      expect(content).toContain("mainPanel: { type: 'empty' }");
      expect(content).toContain('drawer: { open: false, type: null, itemId: null }');
    }
  });

  it('reveals selected horizontal workspaces once after width expansion settles', () => {
    const columns = source('src/lib/components/workspace/WorkspaceColumnsView.svelte');

    expect(columns).toContain('const workspaceId = $currentWorkspaceId$;');
    expect(columns).toContain('void tick().then(() => {');
    expect(columns).toContain('scheduleWorkspaceReveal(workspaceId);');
    expect(columns).toContain('scheduleRevealAfterLayout(');
    expect(columns).toContain('LAYOUT_WIDTH_SETTLE_MS');
    expect(columns).toContain(
      'scrollWorkspaceColumnIntoView(scroller, workspaceId, resolvedBehavior, inline)',
    );
    expect(columns.match(/scheduleWorkspaceReveal\(workspaceId\);/g)).toHaveLength(1);
  });
});
