export interface OperationalClusterBlock {
  type: string;
  text?: string;
  content?: string;
}

export function isOperationalClusterBlock(block: OperationalClusterBlock): boolean {
  return block.type === 'thinking' || block.type === 'tool_use' || block.type === 'content_group';
}

export function getOperationalGroupContentSpacingClass<T extends OperationalClusterBlock>(
  blocks?: readonly T[],
): string {
  const firstVisibleBlock = blocks?.[0];
  if (!firstVisibleBlock || isOperationalClusterBlock(firstVisibleBlock)) return '';
  return 'pt-4';
}
