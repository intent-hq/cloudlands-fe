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
    expect(source).toContain('if ($currentChiefThread$)');
    expect(source).toContain('void createNewThread();');
    expect(source).not.toContain('$chiefThreads$.length > 0 ||');
  });

  it('docks the embedded Chief chat to the bottom without an extra wrapper inset', () => {
    expect(source).toContain('class="min-h-0 flex-1 px-2 pt-0"');
    expect(source).not.toContain('class="min-h-0 flex-1 px-2 pb-4 pt-0"');
  });

  it('keeps the compact thread picker trigger at caption scale', () => {
    expect(source).toContain('class="type-caption min-w-0 flex-1 truncate text-left font-medium"');
    expect(source).not.toContain('class="type-title min-w-0 flex-1 truncate text-left"');
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
});
