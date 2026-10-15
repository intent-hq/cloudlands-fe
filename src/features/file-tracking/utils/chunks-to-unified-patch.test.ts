import { describe, it, expect } from 'vitest';
import { parsePatchFiles } from '@pierre/diffs';
import { chunksToUnifiedPatch } from './chunks-to-unified-patch';
import { LineType } from '$shared/types';
describe('canonical chunk patch presentation', () => {
  it('retains deletion/addition/context and hunk line coordinates through the canonical parser', () => {
    const patch = chunksToUnifiedPatch(
      {
        file: 'demo.txt',
        chunks: [
          {
            oldStart: 4,
            oldLines: 2,
            newStart: 4,
            newLines: 2,
            lines: [
              { type: LineType.Deletion, content: 'before\n', oldNumber: 4 },
              { type: LineType.Addition, content: 'after\n', newNumber: 4 },
              { type: LineType.Context, content: 'same\n', oldNumber: 5, newNumber: 5 },
            ],
          },
        ],
      },
      'demo.txt',
    );
    expect(patch).toContain('@@ -4,2 +4,2 @@\n-before\n+after\n same\n');
    const file = parsePatchFiles(patch)[0].files[0];
    expect(file.deletionLines.join('')).toContain('before');
    expect(file.additionLines.join('')).toContain('after');
  });
  it.each([true, false])(
    'renders an added/deleted file without reading the current worktree (%s)',
    (added) => {
      const patch = chunksToUnifiedPatch(
        {
          file: 'file.txt',
          chunks: [
            {
              oldStart: added ? 0 : 1,
              oldLines: added ? 0 : 1,
              newStart: added ? 1 : 0,
              newLines: added ? 1 : 0,
              lines: [
                { type: added ? LineType.Addition : LineType.Deletion, content: 'content\n' },
              ],
            },
          ],
        },
        'file.txt',
      );
      expect(parsePatchFiles(patch)[0].files).toHaveLength(1);
    },
  );
});
