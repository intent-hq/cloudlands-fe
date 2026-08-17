import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseAgentMessage,
  parseSuggestedPrompts,
  groupParsedBlocks,
  groupContentBlocks,
} from '../messageParser';
import type { RenderBlock, RenderContentBlock } from '../messageParser';
import type { ContentBlock } from '$shared/types/content-block';
import { syntheticFixtures } from './message-render-corpus/synthetic';

/**
 * Golden-fixture regression corpus for the chat message render pipeline.
 *
 * Each fixture (synthetic or harvested from real local-DB assistant messages)
 * is pushed through the same pipeline MessageContent.svelte uses:
 *
 *   ContentBlock[] -> groupContentBlocks() -> per text block:
 *     parseSuggestedPrompts() -> parseAgentMessage() -> groupParsedBlocks()
 *
 * and the resulting render tree is locked in as a golden file. Goldens capture
 * CURRENT behavior. Fixtures carrying a knownBad / KNOWN_BAD marker are
 * documented bugs: they are excluded from the no-content-loss invariant, and
 * their goldens are expected to CHANGE when the corresponding fix lands
 * (update the golden + remove the marker in the fix PR). The
 * intent-hq/monorepo#2689 entries (tag literals inside inline code / fenced
 * code scanned as real group/think tags) flipped to correct output when the
 * code-region-aware scanner landed and now serve as regression coverage.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, 'message-render-corpus');
const HARVESTED_DIR = path.join(CORPUS_DIR, 'harvested');

interface ManifestEntry {
  id: string;
  workspace: string;
  size: number;
  features: string[];
  suspicious: boolean;
  why: string;
}

const manifest: ManifestEntry[] = JSON.parse(
  fs.readFileSync(path.join(CORPUS_DIR, 'manifest.json'), 'utf8'),
);

// ---------------------------------------------------------------------------
// Render pipeline harness (mirrors MessageContent.svelte)
// ---------------------------------------------------------------------------

interface RenderedMessage {
  prompts: string[];
  tree: unknown[];
}

function serializeParsedBlock(block: RenderBlock): unknown {
  if (block.type === 'group') {
    return {
      type: 'group',
      name: block.name,
      isStreaming: block.isStreaming,
      children: block.children.map((child) => serializeParsedBlock(child)),
    };
  }
  const out: Record<string, unknown> = { type: block.type, content: block.content };
  if (block.metadata && Object.keys(block.metadata).length > 0) out.metadata = block.metadata;
  return out;
}

function renderTextBlock(text: string): { prompts: string[]; blocks: unknown[] } {
  const { prompts, cleanedContent } = parseSuggestedPrompts(text);
  const parsed = parseAgentMessage(cleanedContent);
  const grouped = groupParsedBlocks(parsed);
  return {
    prompts: prompts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))),
    blocks: grouped.map((b) => serializeParsedBlock(b)),
  };
}

function summarizeNonTextBlock(block: ContentBlock): unknown {
  const out: Record<string, unknown> = { type: block.type };
  if (block.type === 'tool_use') {
    out.name = (block as { name?: string }).name;
    if (block.input !== undefined) out.input = block.input;
  } else if (block.type === 'tool_result') {
    if (block.output !== undefined) out.output = block.output;
    if (block.is_error) out.is_error = true;
  } else if (block.type === 'thinking') {
    out.content = block.content ?? block.text ?? '';
  } else {
    if (block.text !== undefined) out.text = block.text;
    if (block.content !== undefined) out.content = block.content;
  }
  return out;
}

function renderMessage(blocks: ContentBlock[]): RenderedMessage {
  const grouped: RenderContentBlock[] = groupContentBlocks(blocks, false);
  const prompts: string[] = [];
  const tree: unknown[] = [];

  function renderContentBlock(block: ContentBlock): unknown {
    if (block.type === 'text') {
      const text = block.text ?? block.content ?? '';
      const rendered = renderTextBlock(text);
      prompts.push(...rendered.prompts);
      return { type: 'text', blocks: rendered.blocks };
    }
    return summarizeNonTextBlock(block);
  }

  for (const block of grouped) {
    if (block.type === 'content_group') {
      tree.push({
        type: 'content_group',
        name: block.name,
        isStreaming: block.isStreaming,
        children: block.children.map((child) => renderContentBlock(child)),
      });
    } else {
      tree.push(renderContentBlock(block));
    }
  }

  return { prompts, tree };
}

// ---------------------------------------------------------------------------
// No-content-loss invariant
// ---------------------------------------------------------------------------

// Tag syntax legitimately consumed by the pipeline (group/think scanning and
// special-block parsing). Everything else in a text block must survive into
// the render tree.
const TAG_SYNTAX_REGEX =
  /<group:([^>\n<]+)>|<group:([^>\n<]+)\n|<group:([^>\n<]+)$|<group:([^>\n<]+)<\/group(?::[^>\n<]*)?>|<\/group(?::([^>\n<]*))?>|<\/?think(?:ing)?>|<\/?augment_code_snippet[^>]*>|<\/?agent_digest>|<<<\/?DETECTED_SCRIPTS>>>|<\/?COMMIT_MESSAGE>/g;

const TOKEN_REGEX = /[A-Za-z0-9_]{4,}/g;

// Tokens that are render-pipeline syntax (fence keywords, attribute names)
// rather than user content; they may be consumed without loss of meaning.
const SYNTAX_TOKENS = new Set([
  'group',
  'think',
  'thinking',
  'augment_code_snippet',
  'agent_digest',
  'suggested',
  'prompts',
  'path',
  'mode',
  'delay',
  'block',
  'diagram',
  'workspace',
]);

/**
 * Every significant word token from the fixture's text blocks (minus tag
 * syntax and suggested-prompts blocks) must appear somewhere in the rendered
 * output — as prose, code content, a group name, metadata, or a prompt.
 */
function assertNoContentLoss(blocks: ContentBlock[], rendered: RenderedMessage): void {
  const serialized = JSON.stringify(rendered);
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    const raw = block.text ?? block.content ?? '';
    const { cleanedContent } = parseSuggestedPrompts(raw);
    const withoutTags = cleanedContent.replace(TAG_SYNTAX_REGEX, ' ');
    const tokens = withoutTags.match(TOKEN_REGEX) ?? [];
    const missing = tokens.filter((t) => !SYNTAX_TOKENS.has(t) && !serialized.includes(t));
    expect(
      missing,
      `tokens lost by the render pipeline: ${missing.slice(0, 10).join(', ')}`,
    ).toEqual([]);
  }
}

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

describe('message render corpus — synthetic', () => {
  for (const fixture of syntheticFixtures) {
    describe(fixture.id, () => {
      const rendered = renderMessage(fixture.blocks);

      it('matches golden', async () => {
        const golden = {
          note: fixture.note,
          ...(fixture.knownBad ? { KNOWN_BAD: fixture.knownBad } : {}),
          prompts: rendered.prompts,
          tree: rendered.tree,
        };
        await expect(JSON.stringify(golden, null, 2) + '\n').toMatchFileSnapshot(
          `./message-render-corpus/goldens/synthetic/${fixture.id}.golden.json`,
        );
      });

      if (!fixture.knownBad) {
        it('loses no content', () => {
          assertNoContentLoss(fixture.blocks, rendered);
        });
      }

      it('parses every streaming prefix without throwing and settles identically', () => {
        const fullText = fixture.blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? b.content ?? '')
          .join('');
        // Streamed re-parse at coarse steps: must never throw.
        for (let end = 0; end <= fullText.length; end += 17) {
          groupContentBlocks([{ type: 'text', text: fullText.slice(0, end) }], true);
        }
        // A settled one-shot parse is deterministic across repeat calls.
        expect(renderMessage(fixture.blocks)).toEqual(rendered);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Harvested fixtures (sanitized real assistant messages from the local DB)
// ---------------------------------------------------------------------------

/**
 * Messages whose CURRENT rendering is broken. Goldens lock in the broken
 * output; a fix PR is expected to change them and shrink this list.
 * The intent-hq/monorepo#2689 entries (tag literals inside inline code or
 * fenced code scanned as real tags) were removed when the code-region-aware
 * scanner landed; their goldens now double as regression coverage.
 */
const KNOWN_BAD_HARVESTED = new Map<string, string>([]);

describe('message render corpus — harvested', () => {
  for (const entry of manifest) {
    const knownBad = KNOWN_BAD_HARVESTED.get(entry.id);
    describe(entry.id, () => {
      const blocks: ContentBlock[] = JSON.parse(
        fs.readFileSync(path.join(HARVESTED_DIR, `${entry.id}.json`), 'utf8'),
      );
      const rendered = renderMessage(blocks);

      it('matches golden', async () => {
        const golden = {
          source: `local intentd.db agent_message ${entry.id} (sanitized)`,
          features: entry.features,
          ...(knownBad ? { KNOWN_BAD: knownBad } : {}),
          prompts: rendered.prompts,
          tree: rendered.tree,
        };
        await expect(JSON.stringify(golden, null, 2) + '\n').toMatchFileSnapshot(
          `./message-render-corpus/goldens/harvested/${entry.id}.golden.json`,
        );
      });

      if (!knownBad) {
        it('loses no content', () => {
          assertNoContentLoss(blocks, rendered);
        });
      }
    });
  }
});
