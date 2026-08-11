import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Files panel description punctuation', () => {
  it('keeps the trailing period inside the linked path text', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const branchStart = sidebar.indexOf("{:else if tabId === 'files'");
    const branchEnd = sidebar.indexOf('{:else}', branchStart);
    const filesDescription = sidebar.slice(branchStart, branchEnd);

    expect(filesDescription).toContain(".join('/')}.</span");
    expect(filesDescription).not.toMatch(/<\/OpenComboButton><\/span\s*>\./);
  });
});
