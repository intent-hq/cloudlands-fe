import { describe, it, expect } from 'vitest';
import {
  buildContentFromMergedHunks,
  buildSyntheticChunks,
  mergeChangeParts,
} from '../unified-diff-merger';
import type { ChangePart, DiffHunk } from '../types';

describe('buildSyntheticChunks', () => {
  it('returns empty array for empty content', () => {
    expect(buildSyntheticChunks('', '')).toEqual([]);
  });

  it('creates additions-only hunk for new file', () => {
    const chunks = buildSyntheticChunks('', 'line1\nline2\nline3');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].oldStart).toBe(1);
    expect(chunks[0].oldLines).toBe(0);
    expect(chunks[0].newStart).toBe(1);
    expect(chunks[0].newLines).toBe(3);
    expect(chunks[0].lines).toEqual([
      { type: 'Addition', content: 'line1' },
      { type: 'Addition', content: 'line2' },
      { type: 'Addition', content: 'line3' },
    ]);
  });

  it('creates deletions-only hunk for deleted file', () => {
    const chunks = buildSyntheticChunks('old1\nold2', '');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].oldLines).toBe(2);
    expect(chunks[0].newLines).toBe(0);
    expect(chunks[0].lines).toEqual([
      { type: 'Deletion', content: 'old1' },
      { type: 'Deletion', content: 'old2' },
    ]);
  });

  it('creates deletions + additions for modified file', () => {
    const chunks = buildSyntheticChunks('old line', 'new line');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].oldLines).toBe(1);
    expect(chunks[0].newLines).toBe(1);
    expect(chunks[0].lines).toEqual([
      { type: 'Deletion', content: 'old line' },
      { type: 'Addition', content: 'new line' },
    ]);
  });
});

describe('mergeChangeParts', () => {
  it('returns empty for no parts', () => {
    expect(mergeChangeParts([])).toEqual([]);
  });

  it('uses chunks when available', () => {
    const hunk: DiffHunk = {
      oldStart: 5,
      oldLines: 1,
      newStart: 5,
      newLines: 1,
      lines: [
        { type: 'Deletion', content: 'old' },
        { type: 'Addition', content: 'new' },
      ],
    };
    const parts: ChangePart[] = [
      {
        change: { filePath: 'test.ts', action: 'modify', additions: 1, deletions: 1, toolName: 't', toolCallId: 'id', chunks: [hunk] },
        category: 'staged',
      },
    ];
    const result = mergeChangeParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].headStart).toBe(5);
    expect(result[0].lines).toHaveLength(2);
  });

  it('generates synthetic chunks when no chunks but has oldContent/newContent', () => {
    const parts: ChangePart[] = [
      {
        change: {
          filePath: 'test.ts',
          action: 'modify',
          additions: 1,
          deletions: 1,
          toolName: 't',
          toolCallId: 'id',
          oldContent: 'before',
          newContent: 'after',
          // no chunks
        },
        category: 'committed',
      },
    ];
    const result = mergeChangeParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].lines.some((l) => l.type === 'Deletion' && l.content === 'before')).toBe(true);
    expect(result[0].lines.some((l) => l.type === 'Addition' && l.content === 'after')).toBe(true);
    expect(result[0].lines[0].stage).toBe('committed');
  });

  it('does not generate synthetic chunks when chunks exist', () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      lines: [{ type: 'Deletion', content: 'x' }, { type: 'Addition', content: 'y' }],
    };
    const parts: ChangePart[] = [
      {
        change: {
          filePath: 'test.ts',
          action: 'modify',
          additions: 1,
          deletions: 1,
          toolName: 't',
          toolCallId: 'id',
          oldContent: 'before',
          newContent: 'after',
          chunks: [hunk],
        },
        category: 'staged',
      },
    ];
    const result = mergeChangeParts(parts);
    expect(result).toHaveLength(1);
    // Should use the provided chunks, not synthetic ones
    expect(result[0].lines[0].content).toBe('x');
    expect(result[0].lines[1].content).toBe('y');
  });

  it('handles new file with only newContent', () => {
    const parts: ChangePart[] = [
      {
        change: {
          filePath: 'new.ts',
          action: 'create',
          additions: 2,
          deletions: 0,
          toolName: 't',
          toolCallId: 'id',
          oldContent: '',
          newContent: 'line1\nline2',
        },
        category: 'committed',
      },
    ];
    const result = mergeChangeParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].lines.every((l) => l.type === 'Addition')).toBe(true);
    expect(result[0].lines).toHaveLength(2);
  });

  it('dedupes repeated full-file parts before building merged content', () => {
    const oldContent = '<script lang="ts">\n  const value = 1;\n</script>';
    const newContent = '<script lang="ts">\n  const value = 2;\n</script>';
    const parts: ChangePart[] = Array.from({ length: 5 }, (_, index) => ({
      change: {
        filePath: 'ChatChangesPanel.svelte',
        action: 'modify',
        additions: 1,
        deletions: 1,
        toolName: 'git',
        toolCallId: `duplicate-${index}`,
        oldContent,
        newContent,
      },
      category: 'committed',
    }));

    const mergedContent = buildContentFromMergedHunks(mergeChangeParts(parts));

    expect(mergedContent.oldContent).toBe(oldContent);
    expect(mergedContent.newContent).toBe(newContent);
    expect(
      mergedContent.oldContent.split('\n').filter((line) => line === '<script lang="ts">'),
    ).toHaveLength(1);
    expect(
      mergedContent.newContent.split('\n').filter((line) => line === '<script lang="ts">'),
    ).toHaveLength(1);
  });

  it('pads gaps between non-overlapping snippet hunks from multiple parts', () => {
    const parts: ChangePart[] = [
      {
        change: {
          filePath: 'ChatChangesPanel.svelte',
          action: 'modify',
          additions: 1,
          deletions: 1,
          toolName: 't',
          toolCallId: 'module-snippet',
          chunks: [
            {
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 3,
              lines: [
                { type: 'Context', content: '<script module lang="ts">' },
                { type: 'Deletion', content: '  /** old module docs' },
                { type: 'Addition', content: '  /** new module docs' },
                { type: 'Context', content: '   */' },
              ],
            },
          ],
        },
        category: 'committed',
      },
      {
        change: {
          filePath: 'ChatChangesPanel.svelte',
          action: 'modify',
          additions: 0,
          deletions: 0,
          toolName: 't',
          toolCallId: 'instance-snippet',
          chunks: [
            {
              oldStart: 77,
              oldLines: 2,
              newStart: 77,
              newLines: 2,
              lines: [
                { type: 'Context', content: '<script lang="ts">' },
                { type: 'Context', content: '  /** instance docs' },
              ],
            },
          ],
        },
        category: 'committed',
      },
    ];

    const mergedContent = buildContentFromMergedHunks(mergeChangeParts(parts));
    const newLines = mergedContent.newContent.split('\n');

    expect(newLines[0]).toBe('<script module lang="ts">');
    expect(newLines[1]).toBe('  /** new module docs');
    expect(newLines[76]).toBe('<script lang="ts">');
    expect(newLines[77]).toBe('  /** instance docs');
    expect(newLines.slice(3, 76).every((line) => line === '')).toBe(true);
    expect(mergedContent.newContent).not.toContain('  /** new module docs\n<script lang="ts">');
  });

  it('preserves branch-base collapsed committed content for colliding commit coordinates', () => {
    const parts: ChangePart[] = [
      {
        change: {
          filePath: 'icons.ts',
          action: 'modify',
          additions: 3,
          deletions: 0,
          toolName: 'git',
          toolCallId: 'branch-base-collapsed',
          chunks: [
            {
              oldStart: 22,
              oldLines: 2,
              newStart: 22,
              newLines: 5,
              lines: [
                { type: 'Context', content: 'import { BaseIcon } from "./base";' },
                { type: 'Addition', content: '/** Search icon shown in the command menu. */' },
                { type: 'Addition', content: 'import { SearchIcon } from "./search";' },
                { type: 'Addition', content: 'import { SparklesIcon } from "./sparkles";' },
                { type: 'Context', content: 'export const icons = {' },
              ],
            },
          ],
        },
        category: 'committed',
      },
    ];

    const mergedContent = buildContentFromMergedHunks(mergeChangeParts(parts));
    const newLines = mergedContent.newContent.split('\n');

    expect(newLines.slice(0, 5)).toEqual([
      'import { BaseIcon } from "./base";',
      '/** Search icon shown in the command menu. */',
      'import { SearchIcon } from "./search";',
      'import { SparklesIcon } from "./sparkles";',
      'export const icons = {',
    ]);
    expect(mergedContent.newContent).not.toContain('import { SearchIcon } from "./search";\n/** Search icon');
  });
});
