import { store as appStore } from '$store/renderer/store';
/**
 * Parse RichTextarea mentions into structured context references
 * for workspace creation.
 */

interface ContextMention {
  identifier: string;
  title: string;
  url?: string;
  description?: string;
  metadata?: string;
  itemType?: string;
  provider?: string;
}

interface FileMention {
  type: string;
  id?: string;
  label?: string;
  uri?: string;
  meta?: Record<string, unknown>;
}

interface InlineImage {
  src: string;
}

interface ContextLogger {
  warn: (message: string, ...args: unknown[]) => void;
}

export interface ContextReference {
  type: string;
  provider?: string;
  identifier?: string;
  title?: string;
  url?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  path?: string;
}

export interface ImageBlock {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * Convert RichTextarea context mentions (Linear issues, Sentry issues, etc.)
 * into structured context references.
 */
export function parseContextMentions(mentions: ContextMention[]): ContextReference[] {
  const refs: ContextReference[] = [];

  for (const mention of mentions) {
    let parsedMetadata: Record<string, unknown> = {};
    if (mention.metadata) {
      try {
        parsedMetadata = JSON.parse(mention.metadata);
      } catch {
        // Ignore parse errors
      }
    }

    const parts: string[] = [];
    parts.push(`[${mention.identifier}] ${mention.title}`);
    if (mention.url) parts.push(`URL: ${mention.url}`);
    if (mention.description) parts.push(`\nDescription:\n${mention.description}`);
    if (parsedMetadata.state) parts.push(`Status: ${parsedMetadata.state as string}`);
    if (parsedMetadata.teamName) parts.push(`Team: ${parsedMetadata.teamName as string}`);
    if (parsedMetadata.priority !== undefined) {
      const priorityLabels = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
      parts.push(
        `Priority: ${priorityLabels[parsedMetadata.priority as number] || parsedMetadata.priority}`,
      );
    }
    if (parsedMetadata.assignee) parts.push(`Assignee: ${parsedMetadata.assignee as string}`);

    refs.push({
      type: mention.itemType || 'unknown',
      provider: mention.provider,
      identifier: mention.identifier,
      title: mention.title,
      url: mention.url,
      content: parts.join('\n'),
      metadata: parsedMetadata,
    });
  }

  return refs;
}

/**
 * Convert RichTextarea file mentions into context references.
 */
export function parseFileMentions(mentions: FileMention[]): ContextReference[] {
  const refs: ContextReference[] = [];

  for (const mention of mentions) {
    if (mention.type !== 'file') continue;

    let filePath = (mention.meta?.fullPath as string) || (mention.meta?.path as string) || '';
    if (!filePath && mention.id?.startsWith('file-')) {
      const idPath = mention.id.slice(5);
      if (idPath.startsWith('/') || /^[A-Za-z]:/.test(idPath)) {
        filePath = idPath;
      }
    }
    if (!filePath && mention.uri) {
      if (mention.uri.startsWith('devspace://file/')) {
        try {
          filePath = decodeURIComponent(mention.uri.slice('devspace://file/'.length));
        } catch {
          // Ignore decode errors
        }
      } else if (mention.uri.startsWith('file:')) {
        filePath = mention.uri.slice(5);
      }
    }
    if (!filePath) {
      filePath = mention.label || (mention.meta?.name as string) || '';
    }

    refs.push({ type: 'file', path: filePath, title: mention.label });
  }

  return refs;
}

/**
 * Convert RichTextarea terminal/script mentions into context references.
 * Keeps onboarding runtime context payloads aligned with regular chat mentions.
 */
export async function parseRuntimeMentions(
  mentions: FileMention[],
  logger?: ContextLogger,
): Promise<ContextReference[]> {
  const refs: ContextReference[] = [];

  for (const mention of mentions) {
    if (mention.type === 'terminal') {
      try {
        const { terminalManager } = await import('$features/terminal/terminal-manager.svelte');
        const wsId = (mention.meta?.workspaceId as string) || '';
        const terminalId = mention.id ?? '';
        const bufferContent = await terminalManager.getBufferContent(terminalId, wsId);
        if (bufferContent) {
          refs.push({
            type: 'terminal',
            content: bufferContent,
            title: mention.label,
            metadata: { terminalName: mention.label, terminalId },
          });
        }
      } catch (error) {
        logger?.warn('[OnboardingContext] Failed to read terminal buffer:', error);
      }
    }

    if (mention.type === 'script') {
      try {
                const { selectScriptOutput, selectScriptById, selectScriptRuntime } = await import(
          '$store/renderer/slices/scripts/scripts-selectors'
        );
        const scriptId = mention.id ?? '';
        const state = appStore.state;
        const outputLines = selectScriptOutput.select(state, scriptId);
        const script = selectScriptById.select(state, scriptId);
        const runtime = selectScriptRuntime.select(state, scriptId);

        let content = `Script: ${script?.name || mention.label}\n`;
        content += `Command: ${script?.command || 'unknown'}\n`;
        content += `Status: ${runtime.status}`;
        if (runtime.exitCode !== null && runtime.exitCode !== undefined) {
          content += ` (exit code: ${runtime.exitCode})`;
        }
        content += '\n';
        if (runtime.detectedUrl) content += `URL: ${runtime.detectedUrl}\n`;
        if (outputLines.length > 0) {
          const lastLines = outputLines
            .slice(-100)
            .map((l: { text: string }) => l.text)
            .join('\n');
          content += `\nOutput (last ${Math.min(outputLines.length, 100)} lines):\n${lastLines}`;
        } else {
          content += '\nNo output yet.';
        }

        refs.push({
          type: 'script',
          content,
          title: script?.name || mention.label,
          metadata: {
            scriptId,
            command: script?.command,
            status: runtime.status,
            exitCode: runtime.exitCode,
            detectedUrl: runtime.detectedUrl,
          },
        });
      } catch (error) {
        logger?.warn('[OnboardingContext] Failed to resolve script context:', error);
      }
    }
  }

  return refs;
}

/**
 * Extract a structured Linear issue from context references (if present).
 */
export function extractLinearIssue(refs: ContextReference[]) {
  const ref = refs.find((r) => r.type === 'linear-issue');
  if (!ref) return undefined;
  const m = ref.metadata ?? {};
  return {
    id: (m.id as string) ?? ref.identifier ?? '',
    identifier: ref.identifier ?? '',
    title: ref.title ?? '',
    description: m.description as string | undefined,
    url: ref.url,
    teamName: m.teamName as string | undefined,
    teamKey: m.teamKey as string | undefined,
    state: m.state as string | undefined,
    priority: m.priority as number | undefined,
  };
}

/**
 * Extract a structured Sentry issue from context references (if present).
 */
export function extractSentryIssue(refs: ContextReference[]) {
  const ref = refs.find((r) => r.type === 'sentry-issue');
  if (!ref) return undefined;
  const m = ref.metadata ?? {};
  return {
    id: (m.id as string) ?? ref.identifier ?? '',
    shortId: ref.identifier ?? '',
    title: ref.title ?? '',
    culprit: m.culprit as string | undefined,
    permalink: ref.url || (m.permalink as string | undefined),
    projectSlug: m.projectSlug as string | undefined,
    projectName: m.projectName as string | undefined,
    level: m.level as string | undefined,
    status: m.status as string | undefined,
    count: m.count as number | undefined,
    firstSeen: m.firstSeen as string | undefined,
    lastSeen: m.lastSeen as string | undefined,
  };
}

/**
 * Parse inline images from the editor into image blocks for the agent.
 */
export function parseInlineImages(images: InlineImage[]): ImageBlock[] {
  const blocks: ImageBlock[] = [];
  for (const img of images) {
    const match = img.src.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const [, mimeType, base64Data] = match;
      blocks.push({ type: 'image', data: base64Data, mimeType });
    }
  }
  return blocks;
}
