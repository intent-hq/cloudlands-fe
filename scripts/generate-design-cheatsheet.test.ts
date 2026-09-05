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
    expect(cheatsheet).toContain(
      '`IntentMarkLoader` and `Spinner` from `$lib/components/ui/indicators`',
    );
    expect(cheatsheet).toContain('single indeterminate indicator');
  });
});
