import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('NewSpaceModal nested overlay layering', () => {
  it('raises nested selects, menus, and dialogs above the create modal', () => {
    const modal = source('src/lib/components/modals/NewSpaceModal.svelte');
    const selectContent = source('src/lib/components/ui/select/select-content.svelte');

    expect(modal).toContain('data-new-space-modal');
    expect(modal).toContain("[data-slot='select-content']");
    expect(modal).toContain("[data-slot='menu-content']");
    expect(modal).toContain("[data-slot='dialog-overlay']");
    expect(modal).toContain("[data-slot='dialog-content']");
    expect(selectContent).toContain('data-slot="select-content"');
  });

  it('uses the canonical subtle modal backdrop instead of a smeared heavy blur', () => {
    const modal = source('src/lib/components/modals/NewSpaceModal.svelte');
    const overlay = source('src/lib/components/ui/dialog/dialog-overlay.svelte');

    expect(modal).toContain("import * as Dialog from '$lib/components/ui/dialog'");
    expect(overlay).toContain('fixed inset-0');
    expect(overlay).toContain('bg-foreground/20 backdrop-blur-[1px]');
    expect(modal).not.toContain('bg-background/50 backdrop-blur cursor-pointer');
  });
});
