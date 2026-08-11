import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const initializer = readFileSync(
  resolve(process.cwd(), 'src/lib/components/workspace/CompactWorkspaceInitializer.svelte'),
  'utf8',
);

describe('CompactWorkspaceInitializer create button', () => {
  it('uses the Button semantic foreground color', () => {
    const start = initializer.indexOf('<!-- Create button -->');
    const end = initializer.indexOf('<!-- Error message -->', start);
    const createButtonMarkup = initializer.slice(start, end);

    expect(createButtonMarkup).toContain('<Button onclick={handleSubmit}');
    expect(createButtonMarkup).not.toContain('text-white');
  });
});
