import { describe, expect, it } from 'vitest';
import { tinyDiffMapFixture } from './fixtures';
import { parseDiffMapDocument } from './parse-rich-block';

describe('parseDiffMapDocument', () => {
  it('accepts full-document sections that reference known groups', () => {
    const group = tinyDiffMapFixture.document.groups[0];
    const document = {
      ...tinyDiffMapFixture.document,
      sections: [
        {
          id: 'section:src',
          path: 'src',
          displayPrefix: '',
          displayName: 'src',
          groupIds: [group.id],
          changedCount: group.changedCount,
        },
      ],
    };

    expect(parseDiffMapDocument(document)?.sections).toEqual(document.sections);
  });

  it.each([
    [{ id: 'section:src', groupIds: null }],
    [
      {
        id: 'section:src',
        path: 'src',
        displayPrefix: '',
        displayName: 'src',
        groupIds: ['group:missing'],
        changedCount: 1,
      },
    ],
  ])('rejects malformed or dangling sections without throwing', (sections) => {
    const document = { ...tinyDiffMapFixture.document, sections };

    expect(() => parseDiffMapDocument(document)).not.toThrow();
    expect(parseDiffMapDocument(document)).toBeNull();
  });
});
