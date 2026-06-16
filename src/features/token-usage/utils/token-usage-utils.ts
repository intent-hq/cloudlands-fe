/**
 * Token Usage Utils
 *
 * Pure, dependency-light helpers for extracting session join keys from parsed
 * agent JSONs and summing token usage from parsed auggie session JSONs.
 * No stores, services, or side effects.
 */

import type {
  SessionTokenUsage,
  TokenUsageByModel,
  TokenUsageTotals,
} from '../token-usage-types';

/** Session join key + cache validity token extracted from a persisted agent JSON. */
export interface AgentSessionInfo {
  /** `acpSessionId` with `backendSessionId` fallback; null when neither is present. */
  sessionId: string | null;
  /** Id of the last persisted message; null when there are no messages. */
  lastMessageId: string | null;
}

/** Response node type that carries `token_usage` in auggie session files. */
const TOKEN_USAGE_NODE_TYPE = 10;

/** Response node type that carries `billing_metadata` (with `effective_model_name`). */
const BILLING_METADATA_NODE_TYPE = 9;

/** Bucket for token nodes whose model name cannot be resolved. */
export const UNKNOWN_MODEL = 'unknown';

export function createEmptyTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Extract the session id (`acpSessionId` ?? `backendSessionId`) and the id of
 * the last persisted message from a parsed agent JSON. Tolerates any shape and
 * never throws.
 */
export function extractAgentSessionInfo(parsedAgent: unknown): AgentSessionInfo {
  const agent = asRecord(parsedAgent);
  if (!agent) {
    return { sessionId: null, lastMessageId: null };
  }

  const sessionId = asString(agent.acpSessionId) ?? asString(agent.backendSessionId);

  const messages = Array.isArray(agent.messages)
    ? agent.messages
    : Array.isArray(agent.chatHistory)
      ? agent.chatHistory
      : [];
  const lastMessage = asRecord(messages[messages.length - 1]);
  const lastMessageId = lastMessage ? asString(lastMessage.id) : null;

  return { sessionId, lastMessageId };
}

/**
 * Sum, in a single pass over `response_nodes`, the 4 token consumption fields
 * from `type === 10` (`token_usage`) nodes — both as workspace-level totals
 * and per model. Other `token_usage` fields are context sizes/limits and are
 * intentionally ignored.
 *
 * Model attribution (verified against real session files 2026-06-12): type-10
 * nodes carry no model name; it lives in the type-9 `billing_metadata` node's
 * `effective_model_name`, which precedes its type-10 node within the same
 * exchange. Each type-10 node is attributed to the last model name seen in
 * its exchange; nodes seen before any model name fall back to the exchange's
 * model once known, otherwise to `"unknown"`.
 *
 * Tolerates any shape (null `token_usage`/`billing_metadata`, missing arrays,
 * corrupt entries) and never throws; missing/null numeric fields count as 0.
 */
export function sumSessionTokenUsage(parsedSession: unknown): SessionTokenUsage {
  const totals = createEmptyTotals();
  const byModel: TokenUsageByModel = {};
  const session = asRecord(parsedSession);
  if (!session || !Array.isArray(session.chatHistory)) {
    return { totals, byModel };
  }

  const addToModel = (model: string, delta: TokenUsageTotals): void => {
    byModel[model] = addTotals(byModel[model] ?? createEmptyTotals(), delta);
  };

  for (const entry of session.chatHistory) {
    const exchange = asRecord(asRecord(entry)?.exchange);
    const responseNodes = exchange?.response_nodes;
    if (!Array.isArray(responseNodes)) {
      continue;
    }
    let currentModel: string | null = null;
    let pending: TokenUsageTotals | null = null;
    for (const node of responseNodes) {
      const nodeRecord = asRecord(node);
      if (!nodeRecord) {
        continue;
      }
      if (nodeRecord.type === TOKEN_USAGE_NODE_TYPE) {
        const usage = asRecord(nodeRecord.token_usage);
        if (!usage) {
          continue;
        }
        const delta: TokenUsageTotals = {
          inputTokens: asNumber(usage.input_tokens),
          outputTokens: asNumber(usage.output_tokens),
          cacheReadTokens: asNumber(usage.cache_read_input_tokens),
          cacheCreationTokens: asNumber(usage.cache_creation_input_tokens),
        };
        addTotals(totals, delta);
        if (currentModel) {
          addToModel(currentModel, delta);
        } else {
          pending = addTotals(pending ?? createEmptyTotals(), delta);
        }
      } else if (nodeRecord.type === BILLING_METADATA_NODE_TYPE) {
        const billing = asRecord(nodeRecord.billing_metadata);
        const model = billing ? asString(billing.effective_model_name) : null;
        if (model) {
          currentModel = model;
        }
      }
    }
    if (pending) {
      addToModel(currentModel ?? UNKNOWN_MODEL, pending);
    }
  }

  return { totals, byModel };
}

/** Add `delta` into `target` (mutating) and return `target`. */
export function addTotals(target: TokenUsageTotals, delta: TokenUsageTotals): TokenUsageTotals {
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheReadTokens += delta.cacheReadTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  return target;
}

/** Merge `delta`'s per-model totals into `target` (mutating) and return `target`. */
export function mergeByModel(
  target: TokenUsageByModel,
  delta: TokenUsageByModel,
): TokenUsageByModel {
  for (const [model, modelTotals] of Object.entries(delta)) {
    target[model] = addTotals(target[model] ?? createEmptyTotals(), modelTotals);
  }
  return target;
}

