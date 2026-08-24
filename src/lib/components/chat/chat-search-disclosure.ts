export const CHAT_SEARCH_EXPAND_EVENT = 'chatsearchexpand';
export const CHAT_SEARCH_RESTORE_EVENT = 'chatsearchrestore';

interface SearchDisclosureHandlers {
  onExpand?: () => void;
  onRestore?: () => void;
}

export function searchDisclosureEvents(
  node: HTMLElement,
  initialHandlers: SearchDisclosureHandlers,
) {
  let handlers = initialHandlers;
  const expand = () => handlers.onExpand?.();
  const restore = () => handlers.onRestore?.();
  node.addEventListener(CHAT_SEARCH_EXPAND_EVENT, expand);
  node.addEventListener(CHAT_SEARCH_RESTORE_EVENT, restore);
  return {
    update(nextHandlers: SearchDisclosureHandlers) {
      handlers = nextHandlers;
    },
    destroy() {
      node.removeEventListener(CHAT_SEARCH_EXPAND_EVENT, expand);
      node.removeEventListener(CHAT_SEARCH_RESTORE_EVENT, restore);
    },
  };
}

export function requestSearchDisclosure(node: Element, expand: boolean) {
  node.dispatchEvent(
    new CustomEvent(expand ? CHAT_SEARCH_EXPAND_EVENT : CHAT_SEARCH_RESTORE_EVENT),
  );
}
