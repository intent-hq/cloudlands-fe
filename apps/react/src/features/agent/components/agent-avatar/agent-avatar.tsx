import { getAgentAvatarDesign } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-design';
import {
  agentAvatarGeometry,
  defaultAgentAvatarVariant,
  type AgentAvatarVariant,
} from '../../../../../../../src/features/agent/components/agent-avatar/avatar-size';
import { AgentAvatarArt } from './agent-avatar-art';
import './agent-avatar.css';

export interface AgentAvatarProps {
  agentId?: string;
  specialist?: string | null;
  /** Specialist icon metadata takes precedence over the specialist-id map when valid. */
  icon?: string | null;
  provider?: string;
  variant?: AgentAvatarVariant;
  /** @deprecated Use a named variant. Numeric sizes remain until consumer migration completes. */
  size?: number;
  class?: string;
  className?: string;
  ariaLabel?: string;
}

export function AgentAvatar({
  agentId = '',
  specialist = null,
  icon = null,
  provider = undefined,
  variant = defaultAgentAvatarVariant,
  size = undefined,
  class: sourceClass = '',
  className = '',
  ariaLabel = undefined,
}: AgentAvatarProps) {
  void provider;
  const design = getAgentAvatarDesign(agentId, specialist, icon);
  const renderedSize = size ?? agentAvatarGeometry[variant].surface;
  const usesNamedVariant = size === undefined;

  return (
    <svg
      width={renderedSize}
      height={renderedSize}
      viewBox="0 0 16 16"
      fill="none"
      overflow="hidden"
      xmlns="http://www.w3.org/2000/svg"
      className={`agent-avatar agent-avatar--${usesNamedVariant ? 'named' : 'legacy'} ${sourceClass} ${className}`}
      style={
        usesNamedVariant ? undefined : { width: `${renderedSize}px`, height: `${renderedSize}px` }
      }
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : 'true'}
      focusable="false"
      data-agent-avatar=""
      data-avatar-variant={usesNamedVariant ? variant : undefined}
      data-avatar-design={design}
    >
      {ariaLabel && <title>{ariaLabel}</title>}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.33"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      >
        <AgentAvatarArt design={design} />
      </g>
    </svg>
  );
}
