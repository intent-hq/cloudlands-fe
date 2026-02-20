/**
 * Tab drag-and-drop utilities for reordering tabs
 * Provides smooth drag-to-reorder functionality with visual feedback
 */

export interface DragState {
  isDragging: boolean;
  draggedId: string | null;
  dragOverId: string | null;
  offsetX: number;
}

/**
 * Initialize drag state for tab reordering
 */
export function createDragState(): DragState {
  return {
    isDragging: false,
    draggedId: null,
    dragOverId: null,
    offsetX: 0,
  };
}

/**
 * Handle drag start for a tab
 */
export function handleDragStart(e: DragEvent, tabId: string, state: DragState): void {
  if (!e.dataTransfer) return;

  state.isDragging = true;
  state.draggedId = tabId;
  state.offsetX = e.clientX;

  // Set drag image to be semi-transparent
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', tabId);

  // Create a custom drag image
  const dragImage = new Image();
  dragImage.src =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E";
  e.dataTransfer.setDragImage(dragImage, 0, 0);
}

/**
 * Handle drag over for a tab
 */
export function handleDragOver(e: DragEvent, tabId: string, state: DragState): void {
  if (!e.dataTransfer) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  state.dragOverId = tabId;
}

/**
 * Handle drag leave for a tab
 */
export function handleDragLeave(state: DragState): void {
  state.dragOverId = null;
}

/**
 * Handle drop for a tab
 * Returns true if drop was successful
 */
export function handleDrop(
  e: DragEvent,
  tabId: string,
  state: DragState,
  onReorder: (fromId: string, toId: string) => void,
): boolean {
  if (!e.dataTransfer || !state.draggedId) return false;

  e.preventDefault();

  if (state.draggedId !== tabId) {
    onReorder(state.draggedId, tabId);
  }

  resetDragState(state);
  return true;
}

/**
 * Handle drag end
 */
export function handleDragEnd(state: DragState): void {
  resetDragState(state);
}

/**
 * Reset drag state
 */
function resetDragState(state: DragState): void {
  state.isDragging = false;
  state.draggedId = null;
  state.dragOverId = null;
  state.offsetX = 0;
}

/**
 * Scroll tab container to show a specific tab
 */
export function scrollTabIntoView(tabElement: HTMLElement, containerElement: HTMLElement): void {
  const tabRect = tabElement.getBoundingClientRect();
  const containerRect = containerElement.getBoundingClientRect();

  // Check if tab is outside visible area
  if (tabRect.left < containerRect.left) {
    // Scroll left
    containerElement.scrollLeft -= containerRect.left - tabRect.left + 10;
  } else if (tabRect.right > containerRect.right) {
    // Scroll right
    containerElement.scrollLeft += tabRect.right - containerRect.right + 10;
  }
}
