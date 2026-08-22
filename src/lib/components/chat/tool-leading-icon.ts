import type { ToolCategory } from '$lib/utils/tool-classifier';

export type ToolLeadingIconKind = 'eye' | 'hand';

export interface ToolLeadingIconMetadata {
  toolName: string | undefined | null;
  category?: ToolCategory | string | null;
  action?: string | readonly string[] | null;
  toolKind?: unknown;
}

const OBSERVE_WORDS = new Set([
  'read',
  'view',
  'list',
  'search',
  'fetch',
  'get',
  'inspect',
  'status',
  'screenshot',
  'query',
  'find',
]);

const ACTION_WORDS = new Set([
  'write',
  'edit',
  'delete',
  'remove',
  'create',
  'add',
  'update',
  'set',
  'send',
  'delegate',
  'navigate',
  'evaluate',
  'run',
  'execute',
  'launch',
  'terminal',
  'kill',
  'cancel',
  'start',
  'stop',
  'restart',
  'upload',
  'generate',
]);

function words(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function resolveToolLeadingIcon(metadata: ToolLeadingIconMetadata): ToolLeadingIconKind {
  const actions = Array.isArray(metadata.action) ? metadata.action : [metadata.action];
  const canonicalWords = [
    ...words(metadata.toolName),
    ...actions.flatMap(words),
    ...words(metadata.toolKind),
  ];

  if (canonicalWords.some((word) => ACTION_WORDS.has(word))) return 'hand';
  if (canonicalWords.some((word) => OBSERVE_WORDS.has(word))) return 'eye';
  if (metadata.category === 'file-read' || metadata.category === 'search') return 'eye';
  if (metadata.category === 'context-engine') return 'eye';
  return 'hand';
}
