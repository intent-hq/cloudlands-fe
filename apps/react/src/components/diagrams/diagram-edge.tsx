import { useCallback, useLayoutEffect, useState } from 'react';
import { createDiagramEdge, type DiagramEdgeProps } from './diagram-edge-model';
import './diagram-edge.css';
export type { DiagramEdgeProps } from './diagram-edge-model';
export function DiagramEdge(props: DiagramEdgeProps) {
  const [model] = useState(() => createDiagramEdge(props));
  useLayoutEffect(() => {
    model.update(props);
  }, [model, props]);
  useLayoutEffect(() => model.mount(), [model]);
  const rootRef = useCallback((element: SVGGElement | null) => model.setRoot(element), [model]);
  const bounds = model.revealMaskBounds.value;
  return (
    <g
      ref={rootRef}
      className={model.edgeClass.value}
      data-edge-id={props.edge.id}
      data-edge-from={props.edge.from}
      data-edge-to={props.edge.to}
      data-edge-motion-progress={model.motionProgress.value}
    >
      <defs>
        <mask
          id={model.revealMaskId.value}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          {...bounds}
          style={{ maskType: 'alpha' }}
        >
          <path
            d={model.displayedPath.value}
            className="edge-reveal-mask-path"
            pathLength="1"
            fill="none"
            stroke="white"
            strokeWidth={Math.max(12, (props.terminalGap ?? 0) * 3)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>
      <g mask={`url(#${model.revealMaskId.value})`}>
        <path
          d={model.displayedPath.value}
          className="edge-path"
          markerEnd={model.markerUrl.value}
          vectorEffect="non-scaling-stroke"
        />
        {(props.edge.animated || props.edge.dashed) && props.edge.points?.[0] && (
          <circle
            className="edge-origin"
            cx={props.edge.points[0].x}
            cy={props.edge.points[0].y}
            r="1.5"
            aria-hidden="true"
          />
        )}
      </g>
    </g>
  );
}
export default DiagramEdge;
