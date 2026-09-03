import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte'),
  'utf8',
);
const chatPanelSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/chat/ChatPanel.svelte'),
  'utf8',
);

describe('Chief card migration contract', () => {
  it('waits for daemon hydration before selecting or creating a current Chief thread', () => {
    expect(source).toContain('const chiefAgentsLoaded$ = selectAgentsLoaded(CHIEF_WORKSPACE_ID)');
    expect(source).toContain('!$chiefAgentsLoaded$ ||');
    expect(source).toContain('resolveChiefThreadOnExpansion(');
    expect(source).toContain('void createNewThread();');
    expect(source).not.toContain('$chiefThreads$.length > 0 ||');
  });

  it('docks the embedded Chief chat to the bottom without an extra wrapper inset', () => {
    expect(source).toContain(
      'class="min-h-0 flex-1 overflow-clip px-2 pt-0 [overflow-clip-margin:0.5rem]"',
    );
    expect(source).not.toContain('class="min-h-0 flex-1 px-2 pb-4 pt-0"');
  });

  it('clips at the padded wrapper with a clip margin so the composer aurora reaches the window edges', () => {
    expect(source).toContain('<section class="flex h-full min-h-0 flex-col">');
    expect(source).not.toContain('flex h-full min-h-0 flex-col overflow-hidden');
    expect(source).toContain('[overflow-clip-margin:0.5rem]');
    // No clip-path utility here: it would clip fixed-position dialogs rendered
    // in this subtree (e.g. RulesInspector), since clip-path clips all painted
    // descendants including position:fixed ones.
    expect(source).not.toContain('[clip-path:');
  });

  it('goes directly to a blank chat instead of rendering Chief empty states', () => {
    expect(source).not.toContain('layout_chiefCard_startThreadHint_description');
    expect(source).not.toContain('faWandMagicSparkles');
    expect(chatPanelSource).not.toContain('ChiefChatEmptyState');
    expect(chatPanelSource).toContain('ChiefStarterPrompts');
  });

  it('shares one in-flight Chief launch across mounted card hosts', () => {
    expect(source).toContain('ensureChiefThreadCreation');
  });

  it('gates thread auto-start on a resolvable provider', () => {
    // Presence only. The behavioral contract — no launch while provider-less,
    // exactly one launch after a provider is configured (skip does not latch
    // hasAutoStartedRef) — is pinned by chief-card-autostart-gate.test.ts.
    expect(source).toContain('const hasResolvableProvider$ = selectHasResolvableProvider()');
    expect(source).toContain('if (!$hasResolvableProvider$) return;');
  });
});
