import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('panel focus ownership', () => {
  it('only exposes stored panel focus from the active visible workspace', () => {
    const layout = readFileSync(resolve(__dirname, '../PanelLayout.svelte'), 'utf8');

    expect(layout).toContain('focusedPanelId={active ? $focusedPanelId$ : null}');
    expect(layout).not.toContain('focusedPanelId={$focusedPanelId$}');
  });
});
