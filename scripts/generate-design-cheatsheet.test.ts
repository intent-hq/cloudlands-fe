// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cheatsheetPath,
  generateDesignCheatsheet,
  monorepoDocsDir,
  runDesignCheatsheetGenerator,
} from './generate-design-cheatsheet';

describe('generated design-system cheatsheet', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  function tempTarget() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-cheatsheet-'));
    tempDirs.push(dir);
    return path.join(dir, 'docs', 'fe', 'DESIGN_SYSTEM_CHEATSHEET.md');
  }

  it('fails the check loudly when the companion artifact is missing', async () => {
    const result = await runDesignCheatsheetGenerator('check', tempTarget());

    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('missing');
    expect(result.message).toContain('monorepo artifact');
    expect(result.message).not.toContain('stale');
  });

  it('accepts a freshly written artifact and rejects a stale one', async () => {
    const target = tempTarget();

    expect((await runDesignCheatsheetGenerator('write', target)).exitCode).toBe(0);
    expect((await runDesignCheatsheetGenerator('check', target)).exitCode).toBe(0);
    fs.appendFileSync(target, '\nstale\n');
    const stale = await runDesignCheatsheetGenerator('check', target);
    expect(stale.exitCode).toBe(1);
    expect(stale.message).toContain('stale');
  });

  // The committed copy lives in the monorepo's docs/fe/. A monorepo checkout must keep
  // it current; a standalone checkout cannot produce it, so the check reports that
  // explicitly instead of skipping.
  it('keeps the committed cheatsheet current with the pattern manifest', async () => {
    const result = await runDesignCheatsheetGenerator('check');

    if (fs.existsSync(monorepoDocsDir)) {
      expect(result.exitCode, result.message).toBe(0);
      expect(fs.readFileSync(cheatsheetPath, 'utf8')).toBe(await generateDesignCheatsheet());
    } else {
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('monorepo artifact');
    }
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
