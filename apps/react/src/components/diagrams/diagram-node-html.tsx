import { Fragment, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import type { ComputedNode, NodeStyleConfig } from '$lib/components/diagrams/types';
import { DEFAULT_NODE_STYLE } from '$lib/components/diagrams/types';
import {
  semanticFilenameUnits,
  splitSemanticLabel,
} from '$lib/components/diagrams/diagram-label-wrap';
import { m } from '$shared/paraglide/messages.js';
import { getDiagramNodeIcon } from './diagram-node-icons';
import './diagram-node-html.css';

export interface DiagramNodeHTMLProps {
  node: ComputedNode;
  editable?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  styleConfig?: NodeStyleConfig;
  onMove?: (x: number, y: number) => void;
  onHover?: (nodeId: string | null) => void;
  onBindingClick?: (event: MouseEvent, binding: { type: string; target: string }) => void;
}
export function DiagramNodeHTML({
  node,
  editable = false,
  dimmed = false,
  highlighted = false,
  styleConfig = DEFAULT_NODE_STYLE,
  onMove,
  onHover,
  onBindingClick,
}: DiagramNodeHTMLProps) {
  const nodeEl = useRef<HTMLElement | null>(null);
  const labelEl = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const current = useRef({ node, editable, onMove });
  useLayoutEffect(() => {
    current.current = { node, editable, onMove };
  });
  function clientToSVG(clientX: number, clientY: number) {
    const ctm = nodeEl.current?.closest('svg')?.getScreenCTM();
    if (ctm) {
      const inverse = ctm.inverse();
      return {
        x: inverse.a * clientX + inverse.c * clientY + inverse.e,
        y: inverse.b * clientX + inverse.d * clientY + inverse.f,
      };
    }
    return { x: clientX, y: clientY };
  }
  useLayoutEffect(() => {
    const view = nodeEl.current?.ownerDocument.defaultView;
    if (!view) return;
    const move = (event: MouseEvent) => {
      if (!drag.current || !current.current.editable) return;
      const point = clientToSVG(event.clientX, event.clientY);
      current.current.onMove?.(point.x - drag.current.x, point.y - drag.current.y);
    };
    const up = () => {
      drag.current = null;
    };
    view.addEventListener('mousemove', move);
    view.addEventListener('mouseup', up);
    return () => {
      view.removeEventListener('mousemove', move);
      view.removeEventListener('mouseup', up);
    };
  }, []);
  useLayoutEffect(() => {
    const element = labelEl.current;
    if (!element) return;
    const measure = () => {
      const overflow =
        element.clientWidth > 0 &&
        element.clientHeight > 0 &&
        (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
      if (node.label && (overflow || node.label.trim() !== element.textContent?.trim()))
        element.title = node.label;
      else element.removeAttribute('title');
    };
    const resize = new ResizeObserver(measure);
    const mutation = new MutationObserver(measure);
    resize.observe(element);
    mutation.observe(element, { childList: true, characterData: true, subtree: true });
    element.ownerDocument.fonts?.addEventListener('loadingdone', measure);
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      element.ownerDocument.fonts?.removeEventListener('loadingdone', measure);
      element.removeAttribute('title');
    };
  }, [node.label]);
  const binding = node.binding ?? node.bindings?.[0];
  const defaults = styleConfig === DEFAULT_NODE_STYLE;
  const icon = getDiagramNodeIcon(node.kind);
  const NodeIcon = icon.component;
  const units = semanticFilenameUnits(node.label);
  const props = {
    className: [
      'diagram-node-html',
      node.semanticStyle && `node-${node.semanticStyle}`,
      node.kind && `node-kind-${node.kind}`,
      binding && 'node-clickable',
      editable && 'node-editable',
      dimmed && 'node-dimmed',
      highlighted && 'node-state-highlighted',
    ]
      .filter(Boolean)
      .join(' '),
    'data-semantic-style': node.semanticStyle ?? 'default',
    'data-default-style': defaults,
    'data-state-highlighted': highlighted,
    'data-dimmed': dimmed,
    'data-store-node': ['db', 'store', 'data_store'].includes(node.kind ?? ''),
    'aria-label': binding
      ? m.diagram_node_openBinding_ariaLabel({ label: node.label, type: binding.type })
      : undefined,
    style: {
      '--label-font-size': `${styleConfig.labelFontSize}px`,
      '--label-line-height': styleConfig.labelLineHeight,
      '--kind-font-size': `${defaults ? 11 : styleConfig.kindFontSize}px`,
      '--kind-line-height': styleConfig.kindLineHeight,
      '--padding-x': `${defaults ? 10 : styleConfig.paddingX}px`,
      '--padding-y': `${defaults ? 7 : styleConfig.paddingY}px`,
      '--gap': `${defaults ? 2 : styleConfig.gap}px`,
    } as CSSProperties,
    onMouseDown: (event: React.MouseEvent) => {
      if (editable) {
        const point = clientToSVG(event.clientX, event.clientY);
        drag.current = { x: point.x - node.x, y: point.y - node.y };
      }
    },
    onClick: (event: React.MouseEvent) => {
      if (binding) onBindingClick?.(event.nativeEvent, binding);
    },
    onMouseEnter: () => onHover?.(node.id),
    onMouseLeave: () => onHover?.(null),
    onFocus: () => onHover?.(node.id),
    onBlur: () => onHover?.(null),
  };
  const content = (
    <div className="node-content">
      <div className="node-row">
        <span className="node-icon" data-node-icon aria-hidden="true">
          <NodeIcon
            size={14}
            weight="regular"
            data-icon={icon.name}
            data-weight="regular"
            aria-hidden="true"
          />
        </span>
        <div className="node-copy">
          <div className="node-label" ref={labelEl}>
            {units
              ? units.map((unit, index) => (
                  <Fragment key={index}>
                    <span className="semantic-filename-unit">{unit}</span>
                    {index < units.length - 1 && <wbr />}
                  </Fragment>
                ))
              : splitSemanticLabel(node.label).map((part, index) => (
                  <Fragment key={index}>
                    {part.text}
                    {part.hardBreak ? <br /> : part.breakAfter ? <wbr /> : null}
                  </Fragment>
                ))}
          </div>
          {node.kind && <div className="node-kind-label">{node.kind}</div>}
        </div>
      </div>
    </div>
  );
  return binding ? (
    <Button
      {...props}
      ref={(el) => {
        nodeEl.current = el;
      }}
      variant="plain"
      wrapContent={false}
    >
      {content}
    </Button>
  ) : (
    <div
      {...props}
      ref={(el) => {
        nodeEl.current = el;
      }}
    >
      {content}
    </div>
  );
}
export default DiagramNodeHTML;
