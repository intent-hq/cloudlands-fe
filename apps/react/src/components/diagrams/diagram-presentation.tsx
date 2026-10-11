import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';
import { DiagramActionsMenu } from './diagram-actions-menu';
import './diagram-presentation.css';
export interface DiagramPresentationProps {
  kind: 'mermaid' | 'custom';
  children: ReactNode;
  header?: ReactNode;
  actions?: ReactNode;
  actionsInTopMargin?: boolean;
  rendererOwnsActions?: boolean;
  selected?: boolean;
  exportable?: boolean;
  fileName?: string;
}
export function DiagramPresentation({
  kind,
  children,
  header,
  actions,
  actionsInTopMargin = false,
  rendererOwnsActions = false,
  selected = false,
  exportable = true,
  fileName,
}: DiagramPresentationProps) {
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [measurements, setMeasurements] = useState<{
    noteWidth?: number;
    controlsWidth?: number;
    settled: boolean;
    initializing: boolean;
  }>({ settled: false, initializing: false });
  const current = useRef(measurements);
  useLayoutEffect(() => {
    current.current = measurements;
  }, [measurements]);
  useLayoutEffect(() => {
    if (!content) return;
    const lane = content.closest<HTMLElement>('.node-mermaidBlock, .node-diagram_block');
    const prose = lane?.parentElement;
    if (!lane || !prose?.matches('.tiptap-editor.ProseMirror')) {
      // oxlint-disable-next-line react/set-state-in-effect -- Publish the measured DOM embedding and readiness before paint.
      setMeasurements({ settled: true, initializing: false });
      return;
    }
    setMeasurements((value) => ({ ...value, initializing: true }));
    let intrinsic = 0,
      revision = 0;
    let initializing = true,
      disposed = false;
    let cancelRead: (() => void) | undefined, cancelWrite: (() => void) | undefined;
    const measure = () => {
      cancelRead = undefined;
      const measuredRevision = revision;
      const custom = content.querySelector<HTMLElement>('[data-diagram-intrinsic-width]');
      const svg = content.querySelector<SVGSVGElement>('.mermaid-svg > svg');
      if (custom?.dataset.diagramSettled === 'true')
        intrinsic = Number(custom.dataset.diagramIntrinsicWidth);
      else if (svg?.dataset.layoutSettled === 'true') intrinsic = svg.viewBox.baseVal.width + 16;
      else if (!custom && !svg) intrinsic = 0;
      const laneWidth = lane.clientWidth,
        proseWidth = prose.clientWidth;
      const noteWidth = Math.min(laneWidth, Math.max(proseWidth, intrinsic));
      const controlsWidth = Math.min(laneWidth, proseWidth);
      const settled = custom
        ? custom.dataset.diagramSettled === 'true'
        : svg
          ? svg.dataset.layoutSettled === 'true'
          : !content.querySelector('[data-render-settled="false"]');
      cancelWrite = scheduleLayoutWrite(() => {
        if (disposed || revision !== measuredRevision) return;
        cancelWrite = undefined;
        const widthChanged = current.current.noteWidth !== noteWidth;
        if (initializing && settled && laneWidth > 0 && proseWidth > 0) {
          if (widthChanged) cancelRead ??= scheduleLayoutRead(measure);
          else initializing = false;
        }
        const next = { noteWidth, controlsWidth, settled, initializing };
        current.current = next;
        setMeasurements(next);
      });
    };
    const update = () => {
      revision += 1;
      setMeasurements((value) => (value.settled ? { ...value, settled: false } : value));
      cancelWrite?.();
      cancelWrite = undefined;
      cancelRead ??= scheduleLayoutRead(measure);
    };
    const resize = new ResizeObserver(update);
    resize.observe(lane);
    resize.observe(prose);
    const mutation = new MutationObserver(update);
    mutation.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-diagram-settled',
        'data-diagram-intrinsic-width',
        'data-layout-settled',
        'data-render-settled',
      ],
    });
    update();
    return () => {
      disposed = true;
      resize.disconnect();
      mutation.disconnect();
      cancelRead?.();
      cancelWrite?.();
    };
  }, [content]);
  return (
    <section
      className={[
        'diagram-presentation',
        selected && 'selected',
        measurements.initializing && 'initializing',
        rendererOwnsActions && 'renderer-owns-actions',
      ]
        .filter(Boolean)
        .join(' ')}
      inert={measurements.initializing}
      data-diagram-presentation
      data-diagram-presentation-settled={measurements.settled}
      data-diagram-presentation-initializing={measurements.initializing}
      data-diagram-kind={kind}
      style={
        {
          width: measurements.noteWidth,
          minWidth: measurements.noteWidth === undefined ? undefined : 0,
          '--diagram-controls-width':
            measurements.controlsWidth === undefined
              ? undefined
              : `${measurements.controlsWidth}px`,
        } as CSSProperties
      }
    >
      {header && (
        <header className="diagram-presentation-header" data-diagram-presentation-header>
          {header}
        </header>
      )}
      {!rendererOwnsActions && (actions || exportable) && (
        <div
          className={`diagram-presentation-actions${actionsInTopMargin ? ' actions-in-top-margin' : ''}`}
          data-diagram-presentation-actions
        >
          {actions}
          {exportable && (
            <DiagramActionsMenu
              container={content ?? undefined}
              fileName={fileName}
              compactTrigger={actionsInTopMargin}
            />
          )}
        </div>
      )}
      <div
        ref={setContent}
        className="diagram-presentation-content"
        data-diagram-presentation-content
      >
        {children}
      </div>
    </section>
  );
}
export default DiagramPresentation;
