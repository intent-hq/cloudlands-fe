import { useCallback, useMemo, useState } from 'react';
import { FileDiff, parsePatchFiles } from '@pierre/diffs';
import type { DiffChunk } from '$shared/types';
import { chunksToUnifiedPatch } from '../../../../../src/features/file-tracking/utils/chunks-to-unified-patch';
import { hashContent } from '../../../../../src/features/file-tracking/components/diff/diff-content-hash';
import {
  acquireDiffWorkerPool,
  releaseDiffWorkerPool,
  getSafeDiffLanguage,
} from '$lib/utils/diff-highlighter-preloader';
import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import { m } from '$shared/paraglide/messages.js';

/** Read-only subset of the canonical Pierre diff presentation and worker lifetime. */
export function WorkspaceDiffRenderer({ chunk, path }: { chunk: DiffChunk; path: string }) {
  const dark = selectIsDarkTheme();
  const [failed, setFailed] = useState(false);
  const patch = useMemo(() => chunksToUnifiedPatch(chunk, path), [chunk, path]);
  const tooLarge =
    patch.length > 2 * 1024 * 1024 || chunk.chunks.reduce((n, h) => n + h.lines.length, 0) > 5000;
  const mount = useCallback(
    (host: HTMLDivElement | null) => {
      setFailed(false);
      if (!host || tooLarge) return;
      let viewer: FileDiff | undefined;
      let acquired = false;
      try {
        const parsed = parsePatchFiles(patch, `${path}:${hashContent(patch)}`);
        const file = parsed[0]?.files[0];
        if (!file || parsed.length !== 1 || parsed[0].files.length !== 1)
          throw new Error('Unsupported diff patch');
        file.lang = getSafeDiffLanguage(file.lang);
        const pool = acquireDiffWorkerPool();
        acquired = true;
        viewer = new FileDiff(
          {
            diffStyle: 'unified',
            diffIndicators: 'bars',
            disableLineNumbers: false,
            overflow: 'scroll',
            hunkSeparators: 'line-info',
            expandUnchanged: false,
            expansionLineCount: 20,
            lineDiffType: 'word-alt',
            maxLineDiffLength: 500,
            disableFileHeader: true,
            enableLineSelection: false,
            theme: { dark: 'github-dark', light: 'github-light' },
            themeType: dark.value ? 'dark' : 'light',
          },
          pool,
        );
        viewer.render({ fileDiff: file, containerWrapper: host });
      } catch {
        setFailed(true);
      }
      return () => {
        try {
          viewer?.cleanUp();
        } finally {
          if (acquired) releaseDiffWorkerPool();
        }
      };
    },
    [path, patch, tooLarge, dark.value],
  );
  return (
    <>
      {tooLarge ? (
        <p>{m.ui_trackedDiff_tooLarge_error()}</p>
      ) : failed ? (
        <p role="alert">{m.workspace_gitReview_unavailable_description()}</p>
      ) : null}
      <div
        ref={mount}
        className="type-code min-w-0 overflow-auto rounded-md border border-border"
        data-testid="workspace-diff-content"
      />
    </>
  );
}
