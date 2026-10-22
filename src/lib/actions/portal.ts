import type { Action } from 'svelte/action';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PortalAction');

/**
 * Svelte action to portal an element to a different part of the DOM
 * @param node - The element to portal
 * @param target - The target selector or element to portal to (defaults to 'body')
 */
export const portal: Action<HTMLElement, string | HTMLElement> = (node, target = 'body') => {
  let targetElement: HTMLElement | null = null;

  function moveNode() {
    // Get the target element
    if (typeof target === 'string') {
      targetElement = document.querySelector(target);
    } else {
      targetElement = target;
    }

    if (!targetElement) {
      logger.warn(`Portal target "${target}" not found`);
      return;
    }

    // Move the node to the target
    targetElement.appendChild(node);
  }

  // Move node on mount
  moveNode();

  return {
    update(newTarget) {
      target = newTarget;
      moveNode();
    },
    destroy() {
      // Remove the node when destroyed
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    },
  };
};
