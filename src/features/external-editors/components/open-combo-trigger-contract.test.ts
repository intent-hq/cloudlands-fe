import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/features/external-editors/components/OpenComboButton.svelte'),
  'utf8',
);
const dropdownSource = readFileSync(
  resolve(process.cwd(), 'src/lib/components/ui/dropdown-menu.svelte'),
  'utf8',
);

describe('OpenComboButton trigger ownership', () => {
  it('uses the menu wrapper guarded fallback for dropdown triggers', () => {
    expect(source).toContain('{#snippet trigger({ toggle })}');
    expect(source).toContain('onclick={actions.length > 1 ? toggle : handlePrimaryClick}');
    expect(source).toContain('onclick={toggle}');
    expect(dropdownSource).toContain('const openBeforeClick = open');
    expect(dropdownSource).toContain('if (open === openBeforeClick) open = !openBeforeClick');
  });

  it('keeps the full-mode primary action outside dropdown activation', () => {
    expect(source).toContain('onpointerdown={keepPrimaryActionOutsideDropdown}');
    expect(source).toContain('onkeydown={keepPrimaryActionOutsideDropdown}');
    expect(source).toContain('event.stopPropagation()');
  });

  it('routes the guaranteed Finder action through the shell bridge', () => {
    expect(source).toContain("case 'finder':");
    expect(source).toContain("await invoke('shell:showItemInFolder', { path: targetPath })");
  });
});
