import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const TRAILING_HINT_ICON_PATHS = {
  dismiss:
    'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z',
  undo: 'M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z',
} as const;

export interface TrailingHint {
  kind: 'ready' | 'enhancing' | 'enhanced';
  label: string;
  shortcut?: string;
  icon?: 'dismiss' | 'undo';
  ariaLabel: string;
  onActivate: () => void;
}

type TrailingHintState = TrailingHint | null;

export const trailingHintPluginKey = new PluginKey<TrailingHintState>('trailingHint');

function bindActivation(element: HTMLElement, hint: TrailingHint) {
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hint.onActivate();
  });
}

function bindTooltip(element: HTMLElement, label: string) {
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let tooltip: HTMLDivElement | null = null;

  const hide = () => {
    if (showTimeout) clearTimeout(showTimeout);
    showTimeout = null;
    tooltip?.remove();
    tooltip = null;
  };

  const show = () => {
    hide();
    showTimeout = setTimeout(() => {
      if (!element.isConnected) return;
      const anchorRect = element.getBoundingClientRect();
      tooltip = document.createElement('div');
      tooltip.className = 'prompt-trailing-hint-tooltip';
      tooltip.role = 'tooltip';
      tooltip.textContent = label;
      document.body.append(tooltip);

      const tooltipRect = tooltip.getBoundingClientRect();
      const halfWidth = tooltipRect.width / 2;
      const center = anchorRect.left + anchorRect.width / 2;
      const left = Math.min(window.innerWidth - halfWidth - 8, Math.max(halfWidth + 8, center));
      const showAbove = anchorRect.top >= tooltipRect.height + 8;
      tooltip.dataset.side = showAbove ? 'top' : 'bottom';
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${showAbove ? anchorRect.top - 8 : anchorRect.bottom + 8}px`;
    }, 300);
  };

  element.addEventListener('mouseenter', show);
  element.addEventListener('mouseleave', hide);
  element.addEventListener('mousedown', hide);
  element.addEventListener('blur', hide);
}

function appendIcon(button: HTMLButtonElement, icon: 'dismiss' | 'undo') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', TRAILING_HINT_ICON_PATHS[icon]);
  svg.append(path);
  button.append(svg);
}

function createHintElement(hint: TrailingHint): HTMLElement {
  const root = document.createElement(hint.icon ? 'span' : 'button');
  root.contentEditable = 'false';
  root.className = 'prompt-trailing-hint';
  root.dataset.state = hint.kind;

  if (root instanceof HTMLButtonElement) {
    root.type = 'button';
    root.tabIndex = -1;
    root.setAttribute('aria-label', hint.ariaLabel);
    bindTooltip(root, hint.ariaLabel);
    bindActivation(root, hint);
  }

  if (hint.label) {
    const label = document.createElement('span');
    label.textContent = hint.label;
    root.append(label);
  }

  if (hint.icon) {
    const action = document.createElement('button');
    action.type = 'button';
    action.tabIndex = -1;
    action.contentEditable = 'false';
    action.className = 'prompt-trailing-hint-action';
    action.setAttribute('aria-label', hint.ariaLabel);
    bindTooltip(action, hint.ariaLabel);
    appendIcon(action, hint.icon);
    bindActivation(action, hint);
    root.append(action);
  }

  if (hint.shortcut) {
    const shortcut = document.createElement('kbd');
    shortcut.textContent = hint.shortcut;
    root.append(shortcut);
  }

  return root;
}

function findLastTextPosition(doc: Parameters<typeof DecorationSet.create>[0]): number {
  let position = 1;
  doc.descendants((node, nodePosition) => {
    if (node.isText && node.textContent.trim()) {
      position = nodePosition + node.nodeSize;
    }
  });
  return position;
}

export const TrailingHintExtension = Extension.create({
  name: 'trailingHint',

  addProseMirrorPlugins() {
    return [
      new Plugin<TrailingHintState>({
        key: trailingHintPluginKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const next = transaction.getMeta(trailingHintPluginKey) as
              TrailingHintState | undefined;
            return next === undefined ? previous : next;
          },
        },
        props: {
          handleKeyDown(view, event) {
            const hint = trailingHintPluginKey.getState(view.state);
            const { selection, doc } = view.state;
            const isUnmodifiedRightArrow =
              event.key === 'ArrowRight' &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.shiftKey;
            const isAtEnd = selection.empty && selection.to >= doc.content.size - 1;

            if (hint?.shortcut !== '→' || !isUnmodifiedRightArrow || !isAtEnd) return false;

            event.preventDefault();
            hint.onActivate();
            return true;
          },
          decorations(state) {
            const hint = trailingHintPluginKey.getState(state);
            if (!hint) return DecorationSet.empty;

            const position = findLastTextPosition(state.doc);
            return DecorationSet.create(state.doc, [
              Decoration.widget(position, () => createHintElement(hint), {
                key: `prompt-trailing-hint-${hint.kind}`,
                side: 1,
                ignoreSelection: true,
                stopEvent: (event) => event.type === 'mousedown' || event.type === 'click',
              }),
            ]);
          },
        },
      }),
    ];
  },
});
