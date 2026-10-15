import { LineType, type DiffChunk } from '$shared/types';

export function chunksToUnifiedPatch(chunk: DiffChunk, path: string): string {
  const a = `a/${path}`;
  const b = `b/${path}`;
  const lines: string[] = [`diff --git ${a} ${b}`, `--- ${a}`, `+++ ${b}`];
  for (const hunk of chunk.chunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const line of hunk.lines) {
      const prefix =
        line.type === LineType.Addition ? '+' : line.type === LineType.Deletion ? '-' : ' ';
      // Strip a single trailing newline so we can re-emit it after the prefix;
      // pierre's parser expects one entry per logical line in the patch text.
      const body = line.content.endsWith('\n') ? line.content.slice(0, -1) : line.content;
      lines.push(`${prefix}${body}`);
    }
  }
  return lines.join('\n') + '\n';
}
