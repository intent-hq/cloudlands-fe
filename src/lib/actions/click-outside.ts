/**
 * Click Outside Action
 *
 * Svelte action to detect clicks outside of an element
 */

export function clickOutside(node: HTMLElement, callback?: () => void) {
  const handleClick = (event: MouseEvent) => {
    if (node && !node.contains(event.target as Node) && !event.defaultPrevented) {
      callback?.();
    }
  };

  document.addEventListener('click', handleClick, true);

  return {
    destroy() {
      document.removeEventListener('click', handleClick, true);
    },
  };
}
