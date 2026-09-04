/**
 * SvelteNodeViewRenderer - Svelte 5 compatible TipTap node view renderer
 *
 * Mimics the svelte-tiptap library API while using Svelte 5's reactivity.
 * Uses $state for reactive props that are passed directly to components.
 *
 * @see https://github.com/sibiraj-s/svelte-tiptap
 */

import { NodeView, Editor, getRenderedAttributes } from '@tiptap/core';
import type {
  NodeViewRenderer,
  NodeViewProps,
  NodeViewRendererOptions,
  DecorationWithType,
} from '@tiptap/core';
import type { Decoration, DecorationSource } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type Component, getAllContexts, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

import { NODE_VIEW_CONTEXT_KEY } from './context';

interface RendererUpdateProps {
  oldNode: ProseMirrorNode;
  oldDecorations: readonly Decoration[];
  oldInnerDecorations: DecorationSource;
  newNode: ProseMirrorNode;
  newDecorations: readonly Decoration[];
  newInnerDecorations: DecorationSource;
  updateProps: () => void;
}

type AttrProps =
  | Record<string, string>
  | ((props: {
      node: ProseMirrorNode;
      HTMLAttributes: Record<string, unknown>;
    }) => Record<string, string>);

export interface SvelteNodeViewRendererOptions extends NodeViewRendererOptions {
  /** Custom update handler - return false to recreate the node view */
  update?: ((props: RendererUpdateProps) => boolean) | null;
  /** HTML element type for the wrapper (default: 'div' for block, 'span' for inline) */
  as?: string;
  /** Additional attributes to apply to the wrapper element */
  attrs?: AttrProps;
  /** Svelte context to pass to the component */
  context?: ReturnType<typeof getAllContexts>;
}

/**
 * Simple renderer to hold the mounted Svelte component and manage its lifecycle
 */
class SvelteRenderer {
  component: ReturnType<typeof mount>;
  props: NodeViewProps;
  dom: HTMLElement;

  constructor(
    component: ReturnType<typeof mount>,
    { element, props }: { element: HTMLElement; props: NodeViewProps },
  ) {
    this.component = component;
    this.props = props;
    this.dom = element;
    this.dom.classList.add('svelte-renderer');
  }

  updateProps(props: Partial<NodeViewProps>): void {
    Object.assign(this.props, props);
  }

  updateAttributes(attributes: Record<string, string>): void {
    Object.keys(attributes).forEach((key) => {
      this.dom.setAttribute(key, attributes[key]);
    });
  }

  destroy(): void {
    unmount(this.component);
  }
}

/**
 * Svelte NodeView that extends TipTap's NodeView class
 */
class SvelteNodeView extends NodeView<
  Component<NodeViewProps>,
  Editor,
  SvelteNodeViewRendererOptions
> {
  declare renderer: SvelteRenderer;
  declare contentDOMElement: HTMLElement | null;

  override mount(): void {
    const Component = this.component;

    // Create reactive props using $state pattern - Object.assign keeps reactivity
    const props: NodeViewProps = $state({
      editor: this.editor,
      node: this.node,
      decorations: this.decorations as DecorationWithType[],
      innerDecorations: this.innerDecorations,
      view: this.view,
      selected: false,
      extension: this.extension,
      HTMLAttributes: this.HTMLAttributes,
      getPos: () => this.getPos(),
      updateAttributes: (attributes = {}) => this.updateAttributes(attributes),
      deleteNode: () => this.deleteNode(),
    });

    // Create contentDOM for non-leaf nodes
    this.contentDOMElement = this.node.isLeaf
      ? null
      : document.createElement(this.node.isInline ? 'span' : 'div');

    if (this.contentDOMElement) {
      // Fix for whiteSpace not inheriting properly in Chrome/Safari
      this.contentDOMElement.style.whiteSpace = 'inherit';
    }

    // Set up context with drag handler
    const context = this.options.context || new SvelteMap();
    context.set(NODE_VIEW_CONTEXT_KEY, {
      onDragStart: this.onDragStart.bind(this),
      contentDOMElement: this.contentDOMElement,
    });

    // Create wrapper element
    const as = this.options.as ?? (this.node.isInline ? 'span' : 'div');
    const target = document.createElement(as);
    target.classList.add(`node-${this.node.type.name}`);

    // Listen for selection updates
    this.handleSelectionUpdate = this.handleSelectionUpdate.bind(this);
    this.editor.on('selectionUpdate', this.handleSelectionUpdate);

    // Mount the Svelte component
    const svelteComponent = mount(Component, { target, props, context });

    this.renderer = new SvelteRenderer(svelteComponent, {
      element: target,
      props,
    });

    this.appendContentDOM();
    this.updateElementAttributes();
  }

  private appendContentDOM(): void {
    const contentElement = this.dom.querySelector('[data-node-view-content]');

    if (
      this.contentDOMElement &&
      contentElement &&
      !contentElement.contains(this.contentDOMElement)
    ) {
      contentElement.appendChild(this.contentDOMElement);
    }
  }

  /**
   * Schedule re-appending contentDOM after a microtask.
   * This is needed because Svelte's reactive updates may not have finished
   * when update() is called, so the new [data-node-view-content] element
   * might not exist yet in the DOM.
   */
  private scheduleAppendContentDOM(): void {
    // First try synchronously (in case DOM is already updated)
    this.appendContentDOM();

    // Then schedule a deferred attempt for Svelte's async updates
    queueMicrotask(() => {
      if (!this.contentDOMElement) return;
      this.appendContentDOM();
    });
  }

  override get dom(): HTMLElement {
    if (!this.renderer.dom.firstElementChild?.hasAttribute('data-node-view-wrapper')) {
      console.warn('Please use the NodeViewWrapper component for your node view.');
    }
    return this.renderer.dom;
  }

  override get contentDOM(): HTMLElement | null {
    if (this.node.isLeaf) {
      return null;
    }
    return this.contentDOMElement;
  }

  handleSelectionUpdate(): void {
    const { from, to } = this.editor.state.selection;
    const pos = this.getPos();

    if (typeof pos !== 'number') {
      return;
    }

    if (from <= pos && to >= pos + this.node.nodeSize) {
      if (this.renderer.props.selected) {
        return;
      }
      this.selectNode();
    } else {
      if (!this.renderer.props.selected) {
        return;
      }
      this.deselectNode();
    }
  }

  update(
    node: ProseMirrorNode,
    decorations: readonly Decoration[],
    innerDecorations: DecorationSource,
  ): boolean {
    const updateProps = (props: Partial<NodeViewProps>) => {
      this.renderer.updateProps(props);

      if (typeof this.options.attrs === 'function') {
        this.updateElementAttributes();
      }
    };

    // Custom update handler
    if (typeof this.options.update === 'function') {
      const oldNode = this.node;
      const oldDecorations = this.decorations;
      const oldInnerDecorations = this.innerDecorations;

      this.node = node;
      this.decorations = decorations;
      this.innerDecorations = innerDecorations;

      const result = this.options.update({
        oldNode,
        oldDecorations,
        oldInnerDecorations,
        newNode: node,
        newDecorations: decorations,
        newInnerDecorations: innerDecorations,
        updateProps: () =>
          updateProps({
            node,
            decorations: decorations as DecorationWithType[],
            innerDecorations,
          }),
      });

      // Re-append contentDOM in case the Svelte component re-rendered and
      // the [data-node-view-content] element changed (e.g., conditional rendering)
      this.scheduleAppendContentDOM();

      return result;
    }

    // Check if node type changed (should recreate)
    if (node.type !== this.node.type) {
      return false;
    }

    // No changes, skip update
    if (
      node === this.node &&
      this.decorations === decorations &&
      this.innerDecorations === innerDecorations
    ) {
      return true;
    }

    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;

    updateProps({
      node,
      decorations: decorations as DecorationWithType[],
      innerDecorations,
    });

    // Re-append contentDOM in case the Svelte component re-rendered and
    // the [data-node-view-content] element changed (e.g., conditional rendering)
    this.scheduleAppendContentDOM();

    return true;
  }

  selectNode(): void {
    this.renderer.updateProps({ selected: true });
    this.renderer.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.renderer.updateProps({ selected: false });
    this.renderer.dom.classList.remove('ProseMirror-selectednode');
  }

  destroy(): void {
    this.renderer.destroy();
    this.editor.off('selectionUpdate', this.handleSelectionUpdate);
    this.contentDOMElement = null;
  }

  /**
   * Update attributes on the wrapper element
   */
  updateElementAttributes(): void {
    if (this.options.attrs) {
      let attrsObj: Record<string, string> = {};
      if (typeof this.options.attrs === 'function') {
        const extensionAttributes = this.editor.extensionManager.attributes;
        const HTMLAttributes = getRenderedAttributes(this.node, extensionAttributes);
        attrsObj = this.options.attrs({ node: this.node, HTMLAttributes });
      } else {
        attrsObj = this.options.attrs;
      }
      this.renderer.updateAttributes(attrsObj);
    }
  }
}

/**
 * Create a TipTap node view renderer for a Svelte component
 *
 * @param component - Svelte component to render
 * @param options - Renderer options
 * @returns Node view renderer function
 */
export function SvelteNodeViewRenderer(
  component: Component<NodeViewProps>,
  options?: Partial<SvelteNodeViewRendererOptions>,
): NodeViewRenderer {
  return (props): SvelteNodeView => new SvelteNodeView(component, props, options);
}
