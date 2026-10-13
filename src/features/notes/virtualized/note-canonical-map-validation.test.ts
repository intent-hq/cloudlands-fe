import { expect, it } from 'vitest';
import { NotePageReader } from '$lib/client/note-page-reader';
const identity = {
  scope: { backendId: 'b', workspaceId: 'w', noteId: 'n', noteInstanceId: 'i' },
  sourceRevision: 'r',
  snapshotId: 's',
  expiresAt: '2099-01-01T00:00:00Z',
};
const map = {
  kind: 'sourceMap',
  id: 'map',
  profile: 'canonicalNote',
  profileVersion: 1,
  ownerRef: 'owner',
  textNodeId: 'leaf',
  textNodeRef: 'native',
  mapping: 'identity',
  sourceRange: { start: 20, end: 24 },
  renderedRange: { start: 0, end: 4 },
  textRef: 'text',
};
function validate(change: object) {
  const reader = new NotePageReader(async () => ({
    ...identity,
    kind: 'noteContextPage',
    items: [{ ...map, ...change }],
    nextCursor: null,
  }));
  return reader.read('w', 'n', { kind: 'context', contextRef: 'maps' });
}
it.each(['identity', 'entity', 'normalized', 'omitted'])(
  'rejects an empty raw %s map under the frozen contract',
  async (mapping) => {
    await expect(
      validate({
        mapping,
        sourceRange: { start: 24, end: 24 },
        renderedRange: { start: 4, end: 4 },
        textRef: null,
      }),
    ).rejects.toThrow(/source map/);
  },
);
it.each(['entity', 'normalized', 'projection'])(
  'rejects an empty rendered %s map',
  async (mapping) => {
    await expect(
      validate({
        mapping,
        sourceRange: { start: 20, end: mapping === 'projection' ? 20 : 24 },
        renderedRange: { start: 4, end: 4 },
        textRef: null,
      }),
    ).rejects.toThrow(/source map/);
  },
);
it('retains genuine source-less projections and positive omitted syntax', async () => {
  await expect(
    validate({ mapping: 'projection', sourceRange: { start: 20, end: 20 } }),
  ).resolves.toMatchObject({ items: [{ mapping: 'projection', textRef: 'text' }] });
  await expect(
    validate({
      mapping: 'omitted',
      renderedRange: { start: 0, end: 0 },
      textRef: null,
      textNodeId: null,
      textNodeRef: null,
    }),
  ).resolves.toMatchObject({ items: [{ mapping: 'omitted', textRef: null }] });
  await expect(validate({})).resolves.toMatchObject({ items: [{ mapping: 'identity' }] });
});
