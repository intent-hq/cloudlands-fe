// Source: Bits FocusScopeManager and FocusScope's capture-phase focus containment.
// This coordinates DOM-local scopes; each primitive still owns its focus lifecycle.
import { useCallback, useRef, type Ref } from 'react';

type Scope = { node: HTMLElement; trapped: boolean; lastFocused: HTMLElement | null };
type Registry = ReturnType<typeof createRegistry>;
const registries = new WeakMap<Document, Registry>();

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === 'function') return ref(node);
  if (ref) ref.current = node;
}

function canFocus(element: HTMLElement) {
  return (
    !element.matches(':disabled, input[type="hidden"]') &&
    !element.closest('[inert]') &&
    element.getClientRects().length > 0 &&
    element.ownerDocument.defaultView?.getComputedStyle(element).visibility === 'visible'
  );
}

function focusWithin(scope: Scope) {
  const { node, lastFocused } = scope;
  const candidates = Array.from(
    node.querySelectorAll<HTMLElement>(
      '[tabindex],a[href],area[href],button,input,select,textarea,summary,iframe,audio[controls],video[controls],[contenteditable="true"]',
    ),
  ).filter(canFocus);
  const tabbables = candidates
    .filter((element) => element.tabIndex >= 0)
    .sort((a, b) => {
      // Positive tab indices precede zero; equal indices retain document order.
      const aIndex = a.tabIndex || Infinity;
      const bIndex = b.tabIndex || Infinity;
      return aIndex === bIndex ? 0 : aIndex - bIndex;
    });
  const ordered = [
    ...(lastFocused && node.contains(lastFocused) && canFocus(lastFocused) ? [lastFocused] : []),
    ...tabbables,
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
  const onFocus = (event: FocusEvent) => {
    const scope = stack[0];
    if (!scope?.trapped || !(event.target instanceof HTMLElement)) return;
    if (scope.node.contains(event.target)) {
      scope.lastFocused = event.target;
      return;
    }
    event.preventDefault();
    focusWithin(scope);
  };
  doc.addEventListener('focusin', onFocus, true);
  return {
    add(node: HTMLElement, trapped: boolean) {
      const active = doc.activeElement;
      const scope: Scope = {
        node,
        trapped,
        lastFocused: active instanceof HTMLElement && node.contains(active) ? active : null,
      };
      // Every newly enabled scope pauses its predecessor, including nontrapping scopes.
      stack.unshift(scope);
      const observer = trapped
        ? new MutationObserver(() => {
            if (stack[0] === scope && scope.lastFocused && !node.contains(scope.lastFocused))
              focusWithin(scope);
          })
        : undefined;
      observer?.observe(node, { subtree: true, childList: true });
      return () => {
        observer?.disconnect();
        stack = stack.filter((entry) => entry !== scope);
        if (stack.length) return;
        doc.removeEventListener('focusin', onFocus, true);
        registries.delete(doc);
      };
    },
  };
}

/** Register only while open, even when a primitive keeps its closed content mounted. */
export function useFocusScopeRef<T extends HTMLElement>(
  {
    enabled,
    trapped = false,
    onMount,
  }: { enabled: boolean; trapped?: boolean; onMount?: () => void },
  forwardedRef?: Ref<T>,
) {
  const mount = useRef(onMount);
  // oxlint-disable-next-line react/refs -- Read only by the commit-phase ref callback; keeping it current must not remount the scope.
  mount.current = onMount;
  return useCallback(
    (node: T | null) => {
      const cleanupRef = assignRef(forwardedRef, node);
      let release: (() => void) | undefined;
      if (node && enabled) {
        const doc = node.ownerDocument;
        let registry = registries.get(doc);
        if (!registry) {
          registry = createRegistry(doc);
          registries.set(doc, registry);
        }
        release = registry.add(node, trapped);
        mount.current?.();
      }
      return () => {
        release?.();
        if (typeof cleanupRef === 'function') cleanupRef();
        else assignRef(forwardedRef, null);
      };
    },
    [enabled, trapped, forwardedRef],
  );
}
