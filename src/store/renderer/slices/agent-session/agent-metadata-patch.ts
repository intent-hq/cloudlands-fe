import type { AgentMetadata } from '$shared/types';
import type { AgentMetadataPatch } from './agent-session-types';

/** Apply only declared operations; a clear removes the key, including an absent one. */
export function applyAgentMetadataPatch(
  metadata: AgentMetadata | undefined,
  patch: AgentMetadataPatch,
): AgentMetadata | undefined {
  const operations = Object.entries(patch).filter(([, operation]) => operation !== undefined);
  if (!operations.length) return metadata;
  const next = { ...metadata };
  for (const [key, operation] of operations) {
    if (operation?.op === 'set') {
      // Assignment would invoke Object.prototype.__proto__ rather than store a key.
      Object.defineProperty(next, key, {
        value: operation.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else delete next[key];
  }
  return next;
}
