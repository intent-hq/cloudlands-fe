// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cheatsheetPath,
  generateDesignCheatsheet,
  runDesignCheatsheetGenerator,
} from './generate-design-cheatsheet';

describe('generated design-system cheatsheet', () => {
  it('keeps the committed cheatsheet current with the pattern manifest', async () => {
    const result = await runDesignCheatsheetGenerator('check');

    expect(result.exitCode, result.message).toBe(0);
    expect(fs.readFileSync(cheatsheetPath, 'utf8')).toBe(await generateDesignCheatsheet());
  });

  it('points loading feedback to the shared indeterminate indicator', async () => {
    const cheatsheet = await generateDesignCheatsheet();
    expect(cheatsheet).toContain('`IntentMarkLoader` from `$lib/components/ui/indicators`');
    expect(cheatsheet).toContain('only indeterminate indicator');
  });

  it('documents the Button emphasis order, sizes, and compatibility aliases', async () => {
    const cheatsheet = await generateDesignCheatsheet();
    const primary = cheatsheet.indexOf('**Primary:** `primary`');
    const secondary = cheatsheet.indexOf('**Secondary:** `secondary`');
    const ghost = cheatsheet.indexOf('**Ghost:** `ghost`');
    const destructive = cheatsheet.indexOf('**Destructive:** `destructive`');

    expect(primary).toBeGreaterThan(-1);
    expect(primary).toBeLessThan(secondary);
    expect(secondary).toBeLessThan(ghost);
    expect(ghost).toBeLessThan(destructive);
    expect(cheatsheet).toContain('**Small:** `sm`; icon-only `icon-sm`');
    expect(cheatsheet).toContain('**Medium:** `default`; icon-only `icon`');
    expect(cheatsheet).toContain('**Large:** `lg`; icon-only `icon-lg`');
    expect(cheatsheet).toContain('`variant="default"` → `variant="secondary"`');
    expect(cheatsheet).toContain('`variant="neumorphic"` → `variant="outline"`');
    expect(cheatsheet).toContain('`size="xs"` → `size="compact"`');
  });
});
