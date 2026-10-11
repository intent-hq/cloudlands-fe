import { CUSTOM_GROUP_TITLE_GEOMETRY } from '$lib/components/diagrams/layout-engine';
import type { ComputedGroup } from '$lib/components/diagrams/types';
import './diagram-group.css';
export interface DiagramGroupProps {
  group: ComputedGroup;
  dimmed?: boolean;
  onHover?: (groupId: string | null) => void;
}
export function DiagramGroup({ group, dimmed = false, onHover }: DiagramGroupProps) {
  return (
    <g
      className={[
        'diagram-group',
        group.semanticStyle && `group-${group.semanticStyle}`,
        dimmed && 'group-dimmed',
      ]
        .filter(Boolean)
        .join(' ')}
      data-group-id={group.id}
      onMouseEnter={() => onHover?.(group.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <rect
        x={group.x}
        y={group.y}
        width={group.width}
        height={group.height}
        className="group-bg"
      />
      <text
        x={group.x + group.width / 2}
        y={group.y + CUSTOM_GROUP_TITLE_GEOMETRY.centerY}
        textAnchor="middle"
        dominantBaseline="middle"
        className="group-label"
      >
        {group.label}
      </text>
    </g>
  );
}
export default DiagramGroup;
