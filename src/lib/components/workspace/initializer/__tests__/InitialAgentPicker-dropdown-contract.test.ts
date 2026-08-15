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

  it('opts both model pickers into the modal collision boundary without focus rings', () => {
    expect(
      picker.match(/collisionBoundary="\[data-model-picker-collision-boundary\]"/g),
    ).toHaveLength(2);
    expect(picker.match(/portal=\{false\}/g)).toHaveLength(2);
    expect(picker.match(/showReasoning/g)).toHaveLength(2);
    expect(picker.match(/onReasoningChange=\{handleReasoningChange\}/g)).toHaveLength(2);
    expect(picker).not.toContain('triggerClass=');
    expect(picker).not.toMatch(/:focus-visible\s*\{[^}]*box-shadow:/s);
    expect(picker).toContain('@media (forced-colors: active)');
  });
});
