// Source: src/lib/components/chat/ToolStatusIcon.svelte.
import { CheckCircleIcon, XCircleIcon } from '@phosphor-icons/react';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { m } from '$shared/paraglide/messages.js';
import {
  CHAT_OPERATIONAL_ICON_CLASS,
  CHAT_OPERATIONAL_LEADING_CLASS,
} from '$lib/components/chat/operational-disclosure-classes';

export interface ToolStatusIconProps {
  status: 'running' | 'completed' | 'error';
}

export function ToolStatusIcon({ status }: ToolStatusIconProps) {
  const presentation =
    status === 'running'
      ? {
          icon: null,
          label: m.workspace_devScripts_running_label(),
          className: 'text-muted-foreground',
        }
      : status === 'error'
        ? {
            icon: XCircleIcon,
            label: m.chat_toolCall_failed_label(),
            className: 'text-danger',
          }
        : {
            icon: CheckCircleIcon,
            label: m.chat_toolCall_success_label(),
            className: 'text-success',
          };
  const Icon = presentation.icon;

  return (
    <span
      className={`${CHAT_OPERATIONAL_LEADING_CLASS} shrink-0 ${presentation.className}`}
      data-testid="tool-call-status"
      data-tool-status={status === 'completed' ? 'success' : status}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- The source image groups inline artwork and status text, which an img cannot contain.
      role="img"
      aria-label={presentation.label}
      title={presentation.label}
    >
      {Icon ? (
        <Icon
          size={16}
          weight="regular"
          aria-hidden="true"
          className={CHAT_OPERATIONAL_ICON_CLASS}
        />
      ) : (
        <IntentMarkLoader size={12} className={CHAT_OPERATIONAL_ICON_CLASS} />
      )}
      <span className="sr-only">{presentation.label}</span>
    </span>
  );
}

export default ToolStatusIcon;
