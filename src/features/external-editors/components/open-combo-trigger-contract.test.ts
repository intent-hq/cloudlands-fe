import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/features/external-editors/components/OpenComboButton.svelte'),
  'utf8',
);
describe('OpenComboButton trigger ownership', () => {
  it('forwards menu trigger props to every dropdown-capable trigger branch', () => {
    expect(source).toContain('{#snippet trigger({ props })}');
    expect(source).toContain('{...actions.length > 1 ? props : {}}');
    expect(source.match(/\{\.\.\.props\}/g)).toHaveLength(2);
    expect(source).not.toContain('onclick={toggle}');
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
