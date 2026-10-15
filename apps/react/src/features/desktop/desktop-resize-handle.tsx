import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  setWidth,
  setResizablePanelSize,
  DEFAULT_WIDTH,
  MIN_WIDTH,
  MAX_WIDTH,
} from '../../../../../src/store/renderer/slices/ui-layout/ui-layout-slice';
import {
  updateSizes,
  resizePanelLayoutAtRootDivider,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import { resizePanelWidthsAtDivider } from '$shared/panel-layout-sizing';
import { resizeAdjacentPanels } from '$lib/components/layout/panel-system/panel-resize';
import { m } from '$shared/paraglide/messages.js';
type ResizeProps = { workspaceId: string; active: boolean } & (
  | { kind: 'sidebar'; side: 'left' | 'right' }
  | {
      kind: 'split';
      path: number[];
      sizes: number[];
      index: number;
      vertical: boolean;
    }
);
/** DOM previews use the source sizing helpers; canonical actions own the commit. */
export function DesktopResizeHandle(props: ResizeProps) {
  const authority = selectAdmittedWorkspaceReadContext(props.workspaceId).value;
  const current = useRef({ active: props.active, authority });
  useLayoutEffect(() => {
    current.current = { active: props.active, authority };
  }, [props.active, authority]);
  const canCommit = () =>
    props.active &&
    authority !== null &&
    current.current.active &&
    current.current.authority === authority &&
    selectAdmittedWorkspaceReadContext.select(store.state, props.workspaceId) === authority;
  const lifetime = props.kind === 'split' ? props.workspaceId : props.side;
  const cleanup = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => cleanup.current?.(), [props.kind, lifetime, props.active, authority]);
  function begin(element: HTMLElement) {
    const parent = element.parentElement!;
    const rect = parent.getBoundingClientRect();
    const children = Array.from(
      parent.querySelectorAll<HTMLElement>(':scope > .desktop-split-child'),
    );
    const widths = children.map((child) => child.getBoundingClientRect().width);
    const original = children.map((child) => child.style.flex);
    let nextWidths = widths;
    let nextSizes = props.kind === 'split' ? props.sizes : [];
    let sidebarWidth = rect.width;
    const root = props.kind === 'split' && !props.vertical && props.path.length === 0;
    return {
      preview(delta: number) {
        if (props.kind === 'sidebar') {
          sidebarWidth = Math.max(
            MIN_WIDTH,
            Math.min(MAX_WIDTH, rect.width + delta * (props.side === 'left' ? 1 : -1)),
          );
          parent.style.width = `${sidebarWidth}px`;
          return;
        }
        if (root) {
          nextWidths = resizePanelWidthsAtDivider(widths, props.index, delta).panelWidths;
          children.forEach((child, index) => {
            child.style.flex = `0 0 ${nextWidths[index]}px`;
          });
        } else {
          nextSizes = resizeAdjacentPanels(
            props.sizes,
            props.index,
            (100 * delta) / (props.vertical ? rect.height : rect.width),
          );
          children.forEach((child, index) => {
            child.style.flex = `${nextSizes[index]} 1 0`;
          });
        }
      },
      finish(commit: boolean) {
        commit = commit && canCommit();
        if (props.kind === 'sidebar') {
          parent.style.width = `${commit ? sidebarWidth : rect.width}px`;
          if (commit) {
            store.dispatch(setWidth(sidebarWidth));
            store.dispatch(setResizablePanelSize('workspace-left-panel-width', sidebarWidth));
          }
          return;
        }
        children.forEach((child, index) => {
          child.style.flex = original[index];
        });
        if (commit)
          store.dispatch(
            root
              ? resizePanelLayoutAtRootDivider(props.workspaceId, widths, nextWidths)
              : updateSizes(props.workspaceId, props.path, nextSizes),
          );
      },
    };
  }
  return (
    <Button
      variant="plain"
      aria-label={m.layout_panelSplitHandle_resize_ariaLabel()}
      className={`desktop-resize-handle ${props.kind === 'sidebar' ? `sidebar ${props.side}` : props.vertical ? 'vertical' : 'horizontal'}`}
      onDoubleClick={() => {
        if (!canCommit()) return;
        if (props.kind === 'sidebar') {
          store.dispatch(setWidth(DEFAULT_WIDTH));
          store.dispatch(setResizablePanelSize('workspace-left-panel-width', DEFAULT_WIDTH));
        }
      }}
      onKeyDown={(event) => {
        if (!canCommit() || cleanup.current || event.ctrlKey || event.metaKey || event.altKey)
          return;
        const vertical = props.kind === 'split' && props.vertical;
        if (
          event.key !== (vertical ? 'ArrowUp' : 'ArrowLeft') &&
          event.key !== (vertical ? 'ArrowDown' : 'ArrowRight')
        )
          return;
        event.preventDefault();
        const resize = begin(event.currentTarget);
        resize.preview(
          (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) *
            (event.shiftKey ? 20 : 10),
        );
        resize.finish(true);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !canCommit()) return;
        event.preventDefault();
        cleanup.current?.();
        const resize = begin(event.currentTarget);
        const start = props.kind === 'split' && props.vertical ? event.clientY : event.clientX;
        const move = (next: PointerEvent) =>
          resize.preview(
            (props.kind === 'split' && props.vertical ? next.clientY : next.clientX) - start,
          );
        const stop = (commit: boolean) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', cancel);
          window.removeEventListener('keydown', escape);
          document.body.classList.remove('panel-resizing');
          resize.finish(commit);
          cleanup.current = null;
        };
        const end = () => stop(true);
        const cancel = () => stop(false);
        const escape = (key: KeyboardEvent) => {
          if (key.key === 'Escape') {
            key.preventDefault();
            cancel();
          }
        };
        cleanup.current = cancel;
        document.body.classList.add('panel-resizing');
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', cancel);
        window.addEventListener('keydown', escape);
      }}
    />
  );
}
