import { getAgentAvatarStateLabel } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-state-label';
import type { AvatarState } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
import {
  agentAvatarGeometry,
  defaultAgentAvatarVariant,
  type AgentAvatarVariant,
} from '../../../../../../../src/features/agent/components/agent-avatar/avatar-size';
import { AgentAvatar } from './agent-avatar';
import './agent-avatar-with-state.css';

export type { AvatarState } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
export type { AgentAvatarVariant } from '../../../../../../../src/features/agent/components/agent-avatar/avatar-size';

export interface AgentAvatarWithStateProps {
  agentId: string;
  specialist?: string | null;
  /** Specialist icon metadata takes precedence over the specialist-id map when valid. */
  icon?: string | null;
  provider?: string;
  variant?: AgentAvatarVariant;
  /** @deprecated Use a named variant. Numeric sizes remain until consumer migration completes. */
  size?: number;
  state?: AvatarState;
  class?: string;
  className?: string;
}

export function AgentAvatarWithState({
  agentId,
  specialist = null,
  icon = null,
  provider = undefined,
  variant = defaultAgentAvatarVariant,
  size = undefined,
  state = 'idle',
  class: sourceClass = '',
  className = '',
}: AgentAvatarWithStateProps) {
  const stateLabel = getAgentAvatarStateLabel(state);
  const renderedSize = size ?? agentAvatarGeometry[variant].surface;
  const usesNamedVariant = size === undefined;

  return (
    <span
      className={`agent-avatar-with-state agent-avatar-with-state--${state} ${sourceClass} ${className}`}
      style={
        usesNamedVariant ? undefined : { width: `${renderedSize}px`, height: `${renderedSize}px` }
      }
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The source image groups inline SVG artwork and the unread dot; an img cannot contain them.
      role="img"
      aria-label={stateLabel}
      title={stateLabel}
      data-agent-avatar-with-state=""
      data-agent-avatar-surface=""
      data-avatar-state={state}
      data-avatar-variant={usesNamedVariant ? variant : undefined}
    >
      <AgentAvatar
        agentId={agentId}
        specialist={specialist}
        icon={icon}
        provider={provider}
        variant={variant}
        size={size}
      />
      {state === 'unread' && <span className="agent-avatar-unread-dot" data-avatar-unread-dot="" />}
    </span>
  );
}
