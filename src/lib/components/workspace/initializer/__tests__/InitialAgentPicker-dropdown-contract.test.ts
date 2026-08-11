import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const picker = readFileSync(
  resolve(process.cwd(), 'src/lib/components/workspace/initializer/InitialAgentPicker.svelte'),
  'utf8',
);

describe('InitialAgentPicker specialist dropdown', () => {
  it('lets the menu primitive own trigger toggling', () => {
    const start = picker.indexOf('<DropdownMenu');
    const end = picker.indexOf('</DropdownMenu>', start);
    const dropdownMarkup = picker.slice(start, end);

    expect(dropdownMarkup).toContain('{#snippet trigger()}');
    expect(dropdownMarkup).not.toContain('toggle()');
  });
});
