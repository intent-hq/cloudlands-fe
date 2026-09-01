import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/components/chat/ChatChangesPanel.svelte'),
  'utf8',
);

describe('ChatChangesPanel viewed checkbox presentation', () => {
  it('uses the compact shared checkbox without changing the viewed interaction boundary', () => {
    expect(source).toContain("import { Checkbox } from '$lib/components/ui/checkbox'");
    expect(source).toMatch(/<Checkbox[\s\S]*?checked=\{isViewed\}[\s\S]*?size="sm"/);
    expect(source).toContain('onCheckedChange={() => toggleViewed(change.filePath, expandKey)}');
    expect(source).toContain('onclick={(e: MouseEvent) => e.stopPropagation()}');
    expect(source).toContain('ariaLabel={m.chat_changesPanel_viewed_label()}');
    expect(source).not.toContain('class="sr-only peer"');
    expect(source).not.toContain('peer-checked:bg-primary');
  });
});
