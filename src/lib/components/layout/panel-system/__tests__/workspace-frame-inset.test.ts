import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appLayout = readFileSync(resolve(process.cwd(), 'src/routes/(app)/+layout.svelte'), 'utf8');

describe('workspace frame outer inset', () => {
  it('keeps the bottom inset on the non-shrinking shell boundary', () => {
    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 pb-2 pl-2');
    expect(appLayout).toContain('workspace-frame relative mr-2 flex min-h-0 min-w-0 flex-1');
    expect(appLayout).not.toContain('workspace-frame relative mr-2 mb-2');
  });

  it('keeps the single-workspace surface rounded while columns remain transparent', () => {
    expect(appLayout).toContain("showWorkspaceColumns\n              ? ''");
    expect(appLayout).toContain(": 'rounded-xl bg-sidebar border border-border shadow-sm'");
  });
});
