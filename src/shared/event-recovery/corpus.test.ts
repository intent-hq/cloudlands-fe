// @verify-changed-triggers: src/shared/event-recovery/__fixtures__/contract.json
// Exact copy of intent-hq/intent docs/protocol/fixtures/event-stream-recovery/contract.json
// Source commit: 531eb9ee2f231f383fcd192f7c33b022bb795ead. No transcribed local expectations.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('keeps the canonical contract corpus byte-for-byte at its reviewed source revision', () => {
  const bytes = readFileSync(resolve('src/shared/event-recovery/__fixtures__/contract.json'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '972219db1abdff8b90e62800ab50b2806c8701c382569fdc556f7fbe022435a9',
  );
});
