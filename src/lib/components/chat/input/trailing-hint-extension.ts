import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { faRotateLeft, faXmark } from '@fortawesome/free-solid-svg-icons';

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
  const definition = icon === 'dismiss' ? faXmark : faRotateLeft;
  const [width, height, , , pathData] = definition.icon;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');

  const paths = Array.isArray(pathData) ? pathData : [pathData];
  for (const data of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
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
