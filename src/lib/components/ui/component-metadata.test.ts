import { describe, expect, it } from 'vitest';
import { parseUiComponentMetadata } from './component-metadata';
import { selectMetadata } from './select/select.meta';

describe('component metadata usage contract', () => {
  it('keeps existing metadata valid without usage', () => {
    expect(parseUiComponentMetadata(selectMetadata)).toEqual(selectMetadata);
    expect(selectMetadata.usage).toBeUndefined();
  });

  it('preserves authored snippet formatting', () => {
    const usage = '\n  <Select options={options} />\n';
    expect(parseUiComponentMetadata({ ...selectMetadata, usage }).usage).toBe(usage);
  });

  it.each(['', '  \n\t', 42, null])('rejects empty or non-string usage: %j', (usage) => {
    expect(() => parseUiComponentMetadata({ ...selectMetadata, usage })).toThrow(/usage/);
  });
});
