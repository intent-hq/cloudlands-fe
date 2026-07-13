/**
 * TipTap Primitives Index
 *
 * Export all custom TipTap nodes for note primitives
 */

/**
 * Decode base64 string to UTF-8 text, handling Unicode characters.
 * The encoding uses: btoa(String.fromCharCode(...new TextEncoder().encode(text)))
 * So decoding needs: new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
 */
export function decodeBase64Unicode(base64: string): string {
  const binaryString = atob(base64);
  const bytes = Uint8Array.from(binaryString, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export { ReferenceBlockNode } from './reference-block-node';
export { CliBlockNode } from './cli-block-node';
export { AgentActionBlockNode } from './agent-action-block-node';
export { PatchBlockNode } from './patch-block-node';
export { DiagramBlockNode } from './diagram-block-node';

// Export all nodes as an array for easy registration
export const notePrimitiveNodes = [
  'ReferenceBlockNode',
  'CliBlockNode',
  'AgentActionBlockNode',
  'PatchBlockNode',
  'DiagramBlockNode',
];

// Helper to get all node extensions
import { ReferenceBlockNode } from './reference-block-node';
import { CliBlockNode } from './cli-block-node';
import { AgentActionBlockNode } from './agent-action-block-node';
import { PatchBlockNode } from './patch-block-node';
import { DiagramBlockNode } from './diagram-block-node';

export function getNotePrimitiveExtensions() {
  return [ReferenceBlockNode, CliBlockNode, AgentActionBlockNode, PatchBlockNode, DiagramBlockNode];
}
