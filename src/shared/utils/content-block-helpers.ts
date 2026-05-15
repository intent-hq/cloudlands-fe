import type { ContentBlock } from '$shared/types';

export function getContentBlockText(block: ContentBlock): string {
  return block.text ?? block.content ?? '';
}

export function getContentBlockRichness(block: ContentBlock): number {
  if (block.type === 'text' || block.type === 'thinking' || block.type === 'code') {
    return getContentBlockText(block).length;
  }
  return 1;
}

export function getContentBlocksRichness(blocks: readonly ContentBlock[]): number {
  return blocks.reduce((total, block) => total + getContentBlockRichness(block), 0);
}

export function getToolUseContentBlockKey(block: ContentBlock): string | undefined {
  return block.type === 'tool_use' ? (block.id ?? block.toolCallId) : undefined;
}

export function getToolResultContentBlockKey(block: ContentBlock): string | undefined {
  return block.type === 'tool_result'
    ? (block.tool_use_id ?? block.toolCallId ?? block.id)
    : undefined;
}

export function getIdBackedContentBlockKey(block: ContentBlock): string | undefined {
  if (block.type === 'text') return undefined;
  return block.id ? `${block.type}:${block.id}` : undefined;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

function simpleStringHash(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sampledPayloadHash(value: string): string {
  const length = value.length;
  const headLength = 64;
  const tailLength = 64;
  const middleSamples = 8;
  if (length <= headLength + tailLength + middleSamples) return simpleStringHash(value);

  const head = value.slice(0, headLength);
  const tail = value.slice(length - tailLength);
  const interiorStart = headLength;
  const interiorEnd = length - tailLength;
  const interiorLength = interiorEnd - interiorStart;
  let middle = '';
  for (let i = 1; i <= middleSamples; i++) {
    const offset = interiorStart + Math.floor((i * interiorLength) / (middleSamples + 1));
    middle += value.charCodeAt(offset).toString(16);
  }
  return simpleStringHash(head + middle + tail);
}

export function getContentBlockFingerprint(block: ContentBlock): string | null {
  if (block.type === 'text' || block.type === 'thinking') {
    return getContentBlockText(block);
  }
  if (block.type === 'tool_use') {
    return `tool_use:${block.name ?? block.toolName ?? ''}:${stableStringify(block.input ?? {})}`;
  }
  if (block.type === 'tool_result') {
    return `tool_result:${getToolResultContentBlockKey(block) ?? ''}:${stableStringify(block.output ?? block.content ?? '')}`;
  }
  if (block.type === 'code') {
    return `code:${block.language ?? ''}:${getContentBlockText(block)}`;
  }
  if (block.type === 'image') {
    const data = block.data ?? '';
    return `image:${block.mimeType ?? ''}:${data.length}:${sampledPayloadHash(data)}`;
  }
  if (block.type === 'audio') {
    const data = block.data ?? '';
    return `audio:${block.mimeType ?? ''}:${data.length}:${sampledPayloadHash(data)}:${block.transcript ?? ''}`;
  }
  if (block.type === 'file') {
    const data = block.data ?? '';
    return `file:${block.mimeType ?? ''}:${block.fileName ?? ''}:${data.length}:${sampledPayloadHash(data)}`;
  }
  return getIdBackedContentBlockKey(block) ?? null;
}
