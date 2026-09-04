import type { VideoSource } from '$shared/types/content-block';
import { getWorkspaceVideoSource } from '$shared/types/content-block';
import { parseWorkspaceFileImageUrl } from './image-actions';
import {
  intentFileImageUrlToWorkspaceFileUrl,
  workspaceFileMediaUrlToIntentFileUrl,
} from './workspace-file-image';

export type WorkspaceVideoMarkdownSegment =
  | { type: 'markdown'; content: string }
  | {
      type: 'video';
      source: Extract<VideoSource, { kind: 'workspace' }>;
      name?: string;
      poster?: string;
    };

const IMAGE_LINE_RE =
  /^\s*!\[([^\]\n]*)\]\((?:<)?((?:intent:\/\/local\/|workspace-file:\/\/)[^)\s>]+)(?:>)?\)\s*$/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function resolveVideoPath(path: unknown, workspaceId?: string) {
  if (typeof path !== 'string' || !path || path !== path.trim()) return null;
  if (path.startsWith('workspace-file://')) {
    const target = parseWorkspaceFileImageUrl(path);
    if (!target || target.workspaceId !== workspaceId) return null;
    const portableUrl = workspaceFileMediaUrlToIntentFileUrl(path);
    return portableUrl ? getWorkspaceVideoSource(portableUrl, workspaceId) : null;
  }
  const intentUrl = path.startsWith('intent://') ? path : `intent://local/file/${path}`;
  return getWorkspaceVideoSource(intentUrl, workspaceId);
}

function resolvesWorkspaceImage(path: string, workspaceId?: string): boolean {
  if (path.startsWith('workspace-file://')) {
    const target = parseWorkspaceFileImageUrl(path);
    if (!target || target.workspaceId !== workspaceId) return false;
    const portableUrl = workspaceFileMediaUrlToIntentFileUrl(path);
    return !!portableUrl && !!intentFileImageUrlToWorkspaceFileUrl(portableUrl, workspaceId);
  }
  return !!intentFileImageUrlToWorkspaceFileUrl(path, workspaceId);
}

function isParagraphBoundary(lines: string[], index: number): boolean {
  return (
    (index === 0 || !lines[index - 1].trim()) &&
    (index === lines.length - 1 || !lines[index + 1].trim())
  );
}

function findFenceClose(lines: string[], index: number, openingFence: string): number {
  const marker = openingFence[0];
  return lines.findIndex((line, candidate) => {
    if (candidate <= index) return false;
    const closingFence = line.trim();
    return (
      closingFence.length >= openingFence.length &&
      closingFence.split('').every((character) => character === marker)
    );
  });
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
    const fence = lines[index].match(FENCE_RE);
    if (fence) {
      const closeIndex = findFenceClose(lines, index, fence[1]);
      if (closeIndex > index) {
        const rawBlock = lines.slice(index, closeIndex + 1);
        if (fence[2].trim() === 'ws-block:video') {
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
        }
        markdownLines.push(...rawBlock);
        index = closeIndex;
        continue;
      }

      markdownLines.push(...lines.slice(index));
      break;
    }

    const isIndentedCode = /^(?: {4}|\t)/.test(lines[index]);
    const image =
      !isIndentedCode && isParagraphBoundary(lines, index)
        ? lines[index].match(IMAGE_LINE_RE)
        : null;
    if (!image) {
      markdownLines.push(lines[index]);
      continue;
    }

    const [, alt, mediaUrl] = image;
    const source = resolveVideoPath(mediaUrl, workspaceId);
    if (source) {
      flushMarkdown();
      segments.push({ type: 'video', source, name: alt || undefined });
    } else if (resolvesWorkspaceImage(mediaUrl, workspaceId)) {
      markdownLines.push(lines[index]);
    } else {
      markdownLines.push(`[${alt}](${mediaUrl})`);
    }
  }

  flushMarkdown();
  return segments;
}
