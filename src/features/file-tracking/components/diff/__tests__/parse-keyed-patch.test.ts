import { describe, expect, it } from 'vitest';
import { hashContent, parseKeyedPatch } from '../diff-content-hash';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;

describe('parseKeyedPatch', () => {
  it('keys each parsed file on the file name and patch hash', () => {
    const [parsed] = parseKeyedPatch('src/a.ts', PATCH);
    const key = parsed.files[0].cacheKey;
    expect(key).toBeDefined();
    expect(key).toContain(`src/a.ts:${hashContent(PATCH)}`);
  });

  it('gives different patches of the same file different keys', () => {
    const changed = PATCH.replace('+const b = 3;', '+const b = 4;');
    const first = parseKeyedPatch('src/a.ts', PATCH)[0].files[0].cacheKey;
    const second = parseKeyedPatch('src/a.ts', changed)[0].files[0].cacheKey;
    expect(first).not.toBe(second);
  });
});
