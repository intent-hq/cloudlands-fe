import { logger } from '$lib/utils/client-logger';
import { mount, unmount } from 'svelte';
import EnhancedMentionList from './EnhancedMentionList.svelte';

class MentionSuggestionRenderer {
  private component: any = null;
  private popup: HTMLDivElement | null = null;
  private editorElement: HTMLElement | null = null;
  private inputContainer: HTMLElement | null = null;
  // Generation counter to handle the race between onBeforeStart/onStart/onExit.
  // onBeforeStart increments it (runs synchronously before async items()),
  // onStart/onUpdate only proceed if their generation matches the current one.
  // This handles the edge case where TipTap fires onBeforeStart → onExit → onStart
  // in the same update cycle (e.g. when the suggestion moves position).
  private generation = 0;

  onBeforeStart(props: any) {
    this.generation++;

    // Clean up any existing popup from a previous cycle
    this.cleanup();

    // Store reference to editor element for positioning
    if (props.editor?.view?.dom) {
      this.editorElement = props.editor.view.dom;
    }

    // Show the popup immediately with a loading state — don't wait for async items()
    this.popup = document.createElement('div');
    this.popup.className = 'mention-popup';
    document.body.appendChild(this.popup);

    this.positionPopup(props);

    this.component = mount(EnhancedMentionList, {
      target: this.popup,
      props: {
        items: [],
        command: () => {},
        loading: true,
      },
    });
  }

  onStart(props: any) {
    // If onExit was called after our onBeforeStart (race condition),
    // the generation will have been reset to 0. Don't create an orphaned popup.
    if (this.generation === 0) return;

    // Popup was already created in onBeforeStart — just update with real items
    if (this.component && this.popup) {
      this.component.$set({
        items: props.items,
        command: props.command,
        loading: false,
      });
      this.positionPopup(props);
      return;
    }

    // Fallback: if onBeforeStart didn't run (shouldn't happen), create from scratch
    if (props.editor?.view?.dom) {
      this.editorElement = props.editor.view.dom;
    }

    this.popup = document.createElement('div');
    this.popup.className = 'mention-popup';
    document.body.appendChild(this.popup);
    this.positionPopup(props);

    this.component = mount(EnhancedMentionList, {
      target: this.popup,
      props: {
        items: props.items,
        command: props.command,
        loading: false,
      },
    });
  }

  private findInputContainer(): HTMLElement | null {
    if (!this.editorElement) return null;

    // Try to find .rich-input-container first (SimpleRichInput case)
    let container = this.editorElement.closest('.rich-input-container');
    if (container) {
      logger.info('[MentionSuggestionRenderer] Found .rich-input-container');
      return container as HTMLElement;
    }

    // Try to find .rich-textarea (legacy/standalone rich-textarea case)
    container = this.editorElement.closest('.rich-textarea');
    if (container) {
      logger.info('[MentionSuggestionRenderer] Found .rich-textarea');
      return container as HTMLElement;
    }

    // Fallback: find closest ancestor with position: relative
    container = this.editorElement.closest('[style*="position"]');
    if (container) {
      logger.info('[MentionSuggestionRenderer] Found positioned ancestor');
      return container as HTMLElement;
    }

    logger.warn('[MentionSuggestionRenderer] Could not find input container');
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private positionPopup(props: any) {
    if (!this.popup) return;

    // Find or cache the input container
    if (!this.inputContainer && this.editorElement) {
      this.inputContainer = this.findInputContainer();
    }

    if (!this.inputContainer) {
      logger.warn('[MentionSuggestionRenderer] No input container found, cannot position popup');
      return;
    }

    // Get container dimensions
    const containerRect = this.inputContainer.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Set position to fixed, anchored to container
    this.popup.style.position = 'fixed';
    this.popup.style.left = `${containerRect.left}px`;
    this.popup.style.width = `${containerRect.width}px`;
    this.popup.style.zIndex = '1000';

    // Calculate available space
    const spaceBelow = viewportHeight - containerRect.bottom;
    const spaceAbove = containerRect.top;
    const estimatedPopupHeight = 300; // Approximate height for decision

    // Determine if we should position above or below
    const shouldPositionAbove = spaceBelow < estimatedPopupHeight && spaceAbove > spaceBelow;

    if (shouldPositionAbove) {
      // Position above: popup bottom aligns with container top
      this.popup.style.top = 'auto';
      this.popup.style.bottom = `${viewportHeight - containerRect.top + 4}px`;
    } else {
      // Position below: popup top aligns with container bottom
      this.popup.style.bottom = 'auto';
      this.popup.style.top = `${containerRect.bottom + 4}px`;
    }

    logger.info('[MentionSuggestionRenderer] Popup positioned at:', {
      left: this.popup.style.left,
      width: this.popup.style.width,
      top: this.popup.style.top,
      bottom: this.popup.style.bottom,
      zIndex: this.popup.style.zIndex,
      spaceBelow,
      spaceAbove,
      positionedAbove: shouldPositionAbove,
    });
  }

  onUpdate(props: any) {
    if (this.generation === 0) return;

    logger.info('[MentionSuggestionRenderer] onUpdate called', {
      hasComponent: !!this.component,
      hasPopup: !!this.popup,
      itemsCount: props.items?.length,
    });

    // Store reference to editor element if not already captured
    if (!this.editorElement && props.editor?.view?.dom) {
      this.editorElement = props.editor.view.dom;
    }

    // If neither popup nor component exist, initialize everything (onStart was skipped
    // due to async item resolution timing, e.g. when typing "@a" quickly)
    if (!this.popup && !this.component) {
      logger.info('[MentionSuggestionRenderer] Initializing popup and component in onUpdate (onStart was skipped)');
      this.onStart(props);
      return;
    }

    // Update component props if it exists
    if (this.component && this.popup) {
      logger.info('[MentionSuggestionRenderer] Updating component props without remounting');

      // Svelte 5: use $set to update props without unmounting
      // This prevents the animation from replaying on every keystroke
      this.component.$set({
        items: props.items,
        command: props.command,
        loading: false,
      });
    } else if (!this.component && this.popup) {
      // Component doesn't exist, create it
      logger.info('[MentionSuggestionRenderer] Creating component in onUpdate');
      this.component = mount(EnhancedMentionList, {
        target: this.popup,
        props: {
          items: props.items,
          command: props.command,
          loading: false,
        },
      });
    }

    // Update popup position
    this.positionPopup(props);
  }

  onKeyDown(props: any) {
    if (props.event.key === 'Escape') {
      props.event.stopPropagation();
      return true;
    }
    return this.component?.onKeyDown?.(props) || false;
  }

  private cleanup() {
    if (this.popup && this.popup.parentNode) {
      this.popup.parentNode.removeChild(this.popup);
    }
    if (this.component) {
      unmount(this.component);
    }
    this.popup = null;
    this.component = null;
  }

  onExit() {
    this.generation = 0;
    this.cleanup();
  }
}

export function createMentionSuggestionRenderer() {
  const renderer = new MentionSuggestionRenderer();

  return {
    onBeforeStart: (props: any) => renderer.onBeforeStart(props),
    onStart: (props: any) => renderer.onStart(props),
    onUpdate: (props: any) => renderer.onUpdate(props),
    onKeyDown: (props: any) => renderer.onKeyDown(props),
    onExit: () => renderer.onExit(),
  };
}
