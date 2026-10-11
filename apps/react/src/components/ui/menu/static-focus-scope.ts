// Source: Bits FocusScope/FocusScopeManager. Static menus trap focus without hiding siblings.
// Radix emits these lifecycle events before autofocus. Observe them to yield to nested
// scopes without changing dialog/popover implementations or their own focus ownership.
const scopeMount = 'focusScope.autoFocusOnMount';
const scopeUnmount = 'focusScope.autoFocusOnUnmount';
type Scope = { node: HTMLElement; trapped: boolean; lastFocused: HTMLElement | null };
type Registry = ReturnType<typeof createRegistry>;
const registries = new WeakMap<Document, Registry>();

function focusWithin(scope: Scope) {
  const { node, lastFocused } = scope;
  const candidates = Array.from(
    node.querySelectorAll<HTMLElement>(
      '[tabindex],a[href],button,input,select,textarea,[contenteditable="true"]',
    ),
  ).filter((element) => !element.matches(':disabled') && !element.closest('[inert]'));
  const ordered = [
    ...(lastFocused && node.contains(lastFocused) ? [lastFocused] : []),
    ...candidates.filter((element) => element.tabIndex >= 0),
    ...candidates,
    node,
  ];
  for (const candidate of ordered) {
    candidate.focus();
    if (node.ownerDocument.activeElement === candidate) return;
  }
}

function createRegistry(doc: Document) {
  let stack: Scope[] = [];
  const owners = new Set<Scope>();
  const current = () => {
    stack = stack.filter(
      (scope) => scope.node.isConnected && scope.node.dataset.state !== 'closed',
    );
    return stack[0];
  };
  const onMount = (event: Event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const scope = stack.find((entry) => entry.node === event.target) ?? {
      node: event.target,
      trapped: false,
      lastFocused: null,
    };
    stack = [scope, ...stack.filter((entry) => entry !== scope)];
  };
  const onUnmount = (event: Event) => {
    stack = stack.filter((scope) => scope.node !== event.target);
  };
  const onFocus = (event: FocusEvent) => {
    const scope = current();
    if (!scope?.trapped || !(event.target instanceof HTMLElement)) return;
    if (scope.node.contains(event.target)) {
      scope.lastFocused = event.target;
      return;
    }
    event.preventDefault();
    focusWithin(scope);
  };
  const observer = new MutationObserver(() => {
    const scope = current();
    if (scope?.trapped && scope.lastFocused && !scope.node.contains(scope.lastFocused))
      focusWithin(scope);
  });
  doc.addEventListener(scopeMount, onMount, true);
  doc.addEventListener(scopeUnmount, onUnmount, true);
  doc.addEventListener('focusin', onFocus, true);
  // A Radix unmount event may be emitted after its node is detached. Prune those
  // scopes too, so the preceding static menu resumes even without that event.
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  return {
    add(node: HTMLElement) {
      const active = doc.activeElement;
      const scope: Scope = {
        node,
        trapped: true,
        lastFocused: active instanceof HTMLElement && node.contains(active) ? active : null,
      };
      owners.add(scope);
      stack = [scope, ...stack.filter((entry) => entry.node !== node)];
      return () => {
        owners.delete(scope);
        stack = stack.filter((entry) => entry !== scope);
        if (owners.size) return;
        doc.removeEventListener(scopeMount, onMount, true);
        doc.removeEventListener(scopeUnmount, onUnmount, true);
        doc.removeEventListener('focusin', onFocus, true);
        observer.disconnect();
        registries.delete(doc);
      };
    },
  };
}

export function mountStaticMenuFocus(node: HTMLElement): () => void {
  const doc = node.ownerDocument;
  let registry = registries.get(doc);
  if (!registry) {
    registry = createRegistry(doc);
    registries.set(doc, registry);
  }
  return registry.add(node);
}
