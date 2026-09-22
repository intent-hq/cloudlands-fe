import type { Note } from '$shared/types';
import { extractOrderedSpecTaskIds } from '$shared/utils/task-stats';

// Sort notes by their order in the parent's content, falling back to peerOrder/createdAt
export function sortByContentOrder(notesToSort: Note[], parentContent: string | undefined): Note[] {
  const orderFromContent = extractOrderedSpecTaskIds(parentContent);
  const orderMap = new Map(orderFromContent.map((id, index) => [id, index]));

  return [...notesToSort].sort((a, b) => {
    const aId = a.id as string;
    const bId = b.id as string;
    const aOrder = orderMap.get(aId);
    const bOrder = orderMap.get(bId);

    // If both are in the content, sort by content order
    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }
    // If only one is in the content, prioritize the one in content
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;

    // Neither in content - fall back to peerOrder then createdAt
    const aPeerOrder = a.metadata?.task?.peerOrder ?? 0;
    const bPeerOrder = b.metadata?.task?.peerOrder ?? 0;
    if (aPeerOrder !== bPeerOrder) {
      return aPeerOrder - bPeerOrder;
    }
    const aCreated = (a.createdAt || a.created_at || '') as string;
    const bCreated = (b.createdAt || b.created_at || '') as string;
    return aCreated.localeCompare(bCreated);
  });
}
