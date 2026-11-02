// @verify-changed-triggers: scripts/i18n-used-message-keys.mjs, scripts/build-i18n-bundle.mjs

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectUsedMessageKeys, messageKeysInSource } from './i18n-used-message-keys.mjs';

const keys = new Set(['greeting_label', 'farewell_description', 'unused_label']);

describe('messageKeysInSource', () => {
  it('finds direct m. and msg. references', () => {
    const source = 'm.greeting_label(); msg.farewell_description({ name });';
    expect([...messageKeysInSource(source, keys)].sort()).toEqual([
      'farewell_description',
      'greeting_label',
    ]);
  });

  it('finds a reference that a formatter split across lines', () => {
    const source = `const parts = m
          .farewell_description({ path: SLOT })
          .split(SLOT);`;
    expect([...messageKeysInSource(source, keys)]).toEqual(['farewell_description']);
  });

  it('ignores identifiers that only end in m and names outside the catalog', () => {
    const source = 'item.greeting_label; m.not_in_catalog(); form.unused_label;';
    expect([...messageKeysInSource(source, keys)]).toEqual([]);
  });
});

describe('collectUsedMessageKeys on this repository', () => {
  it('ships every message the profile remove dialog renders', () => {
    const root = process.cwd();
    const catalog = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    const used = collectUsedMessageKeys(join(root, 'src'), new Set(Object.keys(catalog)));
    expect(used).toContain('settings_providerProfileKinds_removeFolder_description');
  });
});
