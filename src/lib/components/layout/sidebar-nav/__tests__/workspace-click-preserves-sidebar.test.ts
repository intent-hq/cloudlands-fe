import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('workspace list navigation', () => {
  it.each(['../cards/AllWorkspacesCard.svelte', '../cards/ActiveWorkspacesCard.svelte'])(
    'keeps the global sidebar open when navigating from %s',
    (path) => {
      const card = source(path);

      expect(card).toContain('goto(route)');
      expect(card).not.toContain('closeAll(false)');
      expect(card).not.toMatch(/\bcloseAll\b/);
    },
  );
});
