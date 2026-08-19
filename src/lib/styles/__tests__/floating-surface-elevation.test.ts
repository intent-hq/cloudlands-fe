import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');
}

describe('floating surface elevation', () => {
  it.each([
    'src/lib/components/ui/tooltip/tooltip-content.svelte',
    'src/lib/components/ui/menu/menu-content.svelte',
    'src/lib/components/ui/menu/menu-sub-content.svelte',
    'src/lib/components/ui/combobox/combobox.svelte',
    'src/lib/components/ui/dropdown/Dropdown.svelte',
    'src/lib/components/ui/toast/Toast.svelte',
    'src/lib/components/workspace/WorkspaceHoverCard.svelte',
  ])('%s uses the shared overlay elevation utility', (file) => {
    expect(source(file)).toContain('shadow-(--elevation-overlay)');
  });

  it.each([
    'src/lib/components/tiptap/TaskMenu.svelte',
    'src/lib/components/tiptap/BubbleMenu.svelte',
    'src/lib/components/tiptap/LaunchFromSelectionDialog.svelte',
    'src/lib/components/layout/panel-system/HandleDropOverlay.svelte',
  ])('%s uses the shared overlay elevation value', (file) => {
    expect(source(file)).toContain('box-shadow: var(--elevation-overlay)');
  });
});
