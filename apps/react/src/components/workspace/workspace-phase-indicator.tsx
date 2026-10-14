import type { WorkspacePhase } from '$lib/components/workspace/workspace-phase';
import { WORKSPACE_PHASE_PROGRESS_TRANSITION } from '@/lib/motion/workspace-phase-timing';

interface WorkspacePhaseIndicatorProps {
  phase: WorkspacePhase;
  progress?: number;
  size?: number;
  className?: string;
}
export function WorkspacePhaseIndicator({
  phase,
  progress = 0,
  size = 16,
  className = '',
}: WorkspacePhaseIndicatorProps) {
  const r = size / 2;
  const cx = r;
  const cy = r;
  const strokeWidth = size * 0.12;
  const circleR = r - strokeWidth / 2;
  const pieR = r * 0.35;
  const pieCircumference = 2 * Math.PI * pieR;
  const pieFilled = Math.max(0, Math.min(1, progress)) * pieCircumference;
  const colors = {
    planning: 'var(--workspace-phase-planning)',
    building: 'var(--workspace-phase-building)',
    reviewing: 'var(--workspace-phase-reviewing)',
    shipped: 'var(--color-foreground)',
  };
  const color = colors[phase] || 'currentColor';
  return (
    <div className="relative">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
      >
        <circle cx={cx} cy={cy} r={circleR} stroke={color} strokeWidth={strokeWidth} fill="none" />
        {phase === 'building' ? (
          <circle
            cx={cx}
            cy={cy}
            r={pieR * 0.8}
            fill="none"
            stroke={color}
            strokeWidth={pieR * 1.5}
            strokeDasharray={`${pieFilled} ${pieCircumference}`}
            strokeDashoffset={pieCircumference * 0.25}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ transition: WORKSPACE_PHASE_PROGRESS_TRANSITION }}
          />
        ) : phase === 'reviewing' ? (
          <circle cx={cx} cy={cy} r={circleR * 0.6} fill={color} />
        ) : phase === 'shipped' ? (
          <circle cx={cx} cy={cy} r={circleR} fill={color} />
        ) : null}
      </svg>
      {phase === 'shipped' && (
        <svg
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 fill-background"
          width={size * 0.5}
          viewBox="0 0 8 6"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M7.69471 1.69471C7.87687 1.50611 7.97766 1.25351 7.97539 0.991311C7.97311 0.729114 7.86794 0.478302 7.68253 0.292894C7.49712 0.107485 7.24631 0.00231622 6.98411 3.78025e-05C6.72192 -0.00224062 6.46931 0.0985542 6.28071 0.280712L2.98771 3.57371L1.69471 2.28071C1.50611 2.09855 1.25351 1.99776 0.991311 2.00004C0.729114 2.00232 0.478302 2.10749 0.292894 2.29289C0.107485 2.4783 0.00231622 2.72911 3.78025e-05 2.99131C-0.00224062 3.25351 0.0985542 3.50611 0.280712 3.69471L2.28071 5.69471C2.46824 5.88218 2.72255 5.9875 2.98771 5.9875C3.25288 5.9875 3.50718 5.88218 3.69471 5.69471L7.69471 1.69471Z"
          />
        </svg>
      )}
    </div>
  );
}
