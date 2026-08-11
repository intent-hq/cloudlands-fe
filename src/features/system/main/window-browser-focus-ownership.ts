const windowBrowserFocusOwners = new Map<number, string>();

export function hasWindowBrowserFocusOwner(windowId: number): boolean {
  return windowBrowserFocusOwners.has(windowId);
}

export function updateWindowBrowserFocusOwner(
  windowId: number,
  browserFocused: boolean,
  focusOwnerId: string,
): void {
  if (browserFocused) {
    windowBrowserFocusOwners.set(windowId, focusOwnerId);
  } else if (windowBrowserFocusOwners.get(windowId) === focusOwnerId) {
    windowBrowserFocusOwners.delete(windowId);
  }
}

export function clearWindowBrowserFocusOwner(windowId: number): void {
  windowBrowserFocusOwners.delete(windowId);
}
