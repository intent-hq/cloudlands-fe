import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/components/chat/ChatChangesPanel.svelte'),
  'utf8',
);

describe('ChatChangesPanel viewed Toggle presentation', () => {
  it('uses the compact textless Toggle without changing the viewed interaction boundary', () => {
    expect(source).toContain("import { Toggle } from '$lib/components/ui/toggle'");
    expect(source).toMatch(/<Toggle[\s\S]*?pressed=\{isViewed\}[\s\S]*?size="xs"/);
    expect(source).toContain('onChange={() => toggleViewed(change.filePath, expandKey)}');
    expect(source).toContain('onclick={(e: MouseEvent) => e.stopPropagation()}');
    expect(source).toContain('ariaLabel={m.chat_changesPanel_viewed_label()}');
    expect(source).toContain('{m.chat_changesPanel_viewed_label()}\n          </button>');
    expect(source).toMatch(
      /ariaLabel=\{m\.chat_changesPanel_viewed_label\(\)\}[\s\S]*?size="xs"[\s\S]*?\/>/,
    );
    expect(source).not.toContain('class="sr-only peer"');
    expect(source).not.toContain('peer-checked:bg-primary');
  });
});
