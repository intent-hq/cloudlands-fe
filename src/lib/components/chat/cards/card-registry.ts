import type { Component } from 'svelte';
import type { Proposal, ProposalActionDetail } from '$shared/types';
import { isProposal } from '$shared/types';
import { PROPOSAL_RESOURCE_MIME_TYPE } from '$shared/types/proposal-resource';
import { QUESTION_RESOURCE_MIME_TYPE, isQuestion, type Question } from '$shared/types/question-resource';
import {
  getResourceContents,
  type ResourceBlockContents,
} from '$shared/types/resource-block-identity';
import ProposalCard from '../proposals/ProposalCard.svelte';
import QuestionCard from '../questions/QuestionCard.svelte';

/**
 * MIME-keyed card registry for standalone `{ type: "resource", resource:
 * {…} }` content blocks (PROTOCOL §7.1). The daemon attaches canonical
 * resource blocks to the transcript (turn-attachment registry); each
 * registered MIME type maps to a parse step plus the Svelte component that
 * renders it, so MessageContent / StreamingMessageContent dispatch cards
 * without hardcoding per-type branches. Unknown MIME types resolve to null
 * and fall through to the callers' existing rendering.
 */

/** Action callbacks the host component supplies when resolving a card. */
export interface CardHandlers {
  onProposalApply: (detail: ProposalActionDetail) => void;
  onProposalUndo: (proposalId: string) => void;
  /**
   * True once ANY later user message exists after the question-bearing
   * assistant message — questions render inactive/resolved (Agent Q&A wire
   * contract: resolution is derivational, not id-keyed). Hosts that don't
   * track this (e.g. read-only transcript views) may omit it.
   */
  questionsResolved?: boolean;
}

/**
 * Card components take heterogeneous prop shapes; the registry erases them
 * to a spreadable record — each entry's `props` builder is the type-safe
 * seam between the parsed data and the component's actual props.
 */
type CardComponent = Component<any>;

interface CardRegistryEntry<TData> {
  /** Parse the resource `text` into card data; null rejects malformed payloads. */
  parse: (contents: ResourceBlockContents) => TData | null;
  component: CardComponent;
  /** Build the component's props from the parsed data + host handlers. */
  props: (data: TData, handlers: CardHandlers) => Record<string, unknown>;
}

/** A resolved card: the component to render and its props. */
export interface ResolvedCard {
  component: CardComponent;
  props: Record<string, unknown>;
}

function parseProposal(contents: ResourceBlockContents): Proposal | null {
  try {
    const proposal: unknown = JSON.parse(contents.text);
    return isProposal(proposal) ? proposal : null;
  } catch {
    return null;
  }
}

const registry = new Map<string, CardRegistryEntry<never>>();

function register<TData>(mimeType: string, entry: CardRegistryEntry<TData>): void {
  registry.set(mimeType, entry as unknown as CardRegistryEntry<never>);
}

register<Proposal>(PROPOSAL_RESOURCE_MIME_TYPE, {
  parse: parseProposal,
  component: ProposalCard,
  props: (proposal, handlers) => ({
    proposal,
    onApply: handlers.onProposalApply,
    onUndo: handlers.onProposalUndo,
  }),
});

function parseQuestion(contents: ResourceBlockContents): Question | null {
  try {
    const question: unknown = JSON.parse(contents.text);
    return isQuestion(question) ? question : null;
  } catch {
    return null;
  }
}

register<Question>(QUESTION_RESOURCE_MIME_TYPE, {
  parse: parseQuestion,
  component: QuestionCard,
  props: (question, handlers) => ({
    question,
    resolved: handlers.questionsResolved ?? false,
  }),
});

/**
 * Per-block memo of the extract + parse work (the expensive part —
 * JSON.parse of the resource text). Keyed by block object identity: blocks
 * are replaced, never mutated, on store updates, and streaming re-renders
 * re-evaluate `resolveCard` several times per block per chunk. Props are
 * rebuilt on every call (cheap) so handlers stay per-component.
 */
const parseCache = new WeakMap<object, { entry: CardRegistryEntry<never>; data: never } | null>();

/**
 * Resolve a content block to a registered card. Null when the block is not a
 * §7.1 resource block, its MIME type has no registered card, or its payload
 * fails the card's parse — callers fall through to their legacy branches.
 */
export function resolveCard(block: unknown, handlers: CardHandlers): ResolvedCard | null {
  if (!block || typeof block !== 'object') return null;
  let parsed = parseCache.get(block);
  if (parsed === undefined) {
    parsed = null;
    const contents = getResourceContents(block);
    const entry = contents ? registry.get(contents.mimeType) : undefined;
    if (contents && entry) {
      const data = entry.parse(contents);
      if (data !== null) parsed = { entry, data: data as never };
    }
    parseCache.set(block, parsed);
  }
  if (parsed === null) return null;
  return {
    component: parsed.entry.component,
    props: parsed.entry.props(parsed.data, handlers),
  };
}
