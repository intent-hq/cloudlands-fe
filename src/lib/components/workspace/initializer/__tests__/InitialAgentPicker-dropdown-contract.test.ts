import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const picker = readFileSync(
  resolve(process.cwd(), 'src/lib/components/workspace/initializer/InitialAgentPicker.svelte'),
  'utf8',
);

describe('InitialAgentPicker specialist dropdown', () => {
  it('uses the menu trigger toggle only after single-agent mode is selected', () => {
    const start = picker.indexOf('<DropdownMenu');
    const end = picker.indexOf('</DropdownMenu>', start);
    const dropdownMarkup = picker.slice(start, end);

    expect(dropdownMarkup).toContain('{#snippet trigger({ toggle }');
    expect(dropdownMarkup).toContain('if (isTeamMode)');
    expect(dropdownMarkup).toContain('toggle();');
  });
});
