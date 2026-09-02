import type { VideoSource } from '$shared/types/content-block';
import { getWorkspaceVideoSource } from '$shared/types/content-block';
import { intentFileImageUrlToWorkspaceFileUrl } from './workspace-file-image';

export type WorkspaceVideoMarkdownSegment =
  | { type: 'markdown'; content: string }
  | {
      type: 'video';
      source: Extract<VideoSource, { kind: 'workspace' }>;
      name?: string;
      poster?: string;
    };

const IMAGE_LINE_RE = /^\s*!\[([^\]\n]*)\]\((?:<)?(intent:\/\/local\/[^)\s>]+)(?:>)?\)\s*$/;
const VIDEO_FENCE_RE = /^\s*(`{3,}|~{3,})ws-block:video\s*$/;

function resolveVideoPath(path: unknown, workspaceId?: string) {
  if (typeof path !== 'string' || !path || path !== path.trim()) return null;
  const intentUrl = path.startsWith('intent://') ? path : `intent://local/file/${path}`;
  return getWorkspaceVideoSource(intentUrl, workspaceId);
}

function isParagraphBoundary(lines: string[], index: number): boolean {
  return (
    (index === 0 || !lines[index - 1].trim()) &&
    (index === lines.length - 1 || !lines[index + 1].trim())
  );
}

/** Split standalone workspace video markdown into Svelte-renderable segments. */
export function splitWorkspaceVideoMarkdown(
  markdown: string,
  workspaceId?: string,
): WorkspaceVideoMarkdownSegment[] {
  const lines = markdown.split('\n');
  const segments: WorkspaceVideoMarkdownSegment[] = [];
  let markdownLines: string[] = [];

  const flushMarkdown = () => {
    const content = markdownLines.join('\n');
    if (content.trim()) segments.push({ type: 'markdown', content });
    markdownLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const fence = lines[index].match(VIDEO_FENCE_RE);
    if (fence) {
      const closeIndex = lines.findIndex(
        (line, candidate) => candidate > index && line.trim() === fence[1],
      );
      if (closeIndex > index) {
        const rawBlock = lines.slice(index, closeIndex + 1);
        try {
          const payload = JSON.parse(lines.slice(index + 1, closeIndex).join('\n'));
          const source = resolveVideoPath(payload?.path, workspaceId);
          if (source) {
            flushMarkdown();
            segments.push({
              type: 'video',
              source,
              name: typeof payload.path === 'string' ? payload.path : undefined,
              poster: typeof payload.poster === 'string' ? payload.poster : undefined,
            });
            index = closeIndex;
            continue;
          }
        } catch {
          // Invalid rich blocks remain visible as markdown source.
        }
        markdownLines.push(...rawBlock);
        index = closeIndex;
        continue;
      }
    }

    const image = isParagraphBoundary(lines, index) ? lines[index].match(IMAGE_LINE_RE) : null;
    if (!image) {
      markdownLines.push(lines[index]);
      continue;
    }

    const [, alt, intentUrl] = image;
    const source = getWorkspaceVideoSource(intentUrl, workspaceId);
    if (source) {
      flushMarkdown();
      segments.push({ type: 'video', source, name: alt || undefined });
    } else if (intentFileImageUrlToWorkspaceFileUrl(intentUrl, workspaceId)) {
      markdownLines.push(lines[index]);
    } else {
      markdownLines.push(`[${alt}](${intentUrl})`);
    }
  }

  flushMarkdown();
  return segments;
}
