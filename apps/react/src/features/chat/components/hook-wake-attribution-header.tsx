// Source: src/lib/components/chat/HookWakeAttributionHeader.svelte.
import { useLayoutEffect, useRef, useState } from 'react';
import { LightningIcon } from '@phosphor-icons/react';
import { observeOverflow } from '$lib/actions/observe-overflow';
import type { HookWakeAttribution } from '$lib/utils/hook-wake-attribution';
import { m } from '$shared/paraglide/messages.js';
import {
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_ICON_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
} from '$lib/components/chat/subscription-disclosure-classes';

export interface HookWakeAttributionHeaderProps {
  attribution: HookWakeAttribution;
  class?: string;
  className?: string;
}

export function HookWakeAttributionHeader({
  attribution,
  class: sourceClass = '',
  className = sourceClass,
}: HookWakeAttributionHeaderProps) {
  const name = useRef<HTMLSpanElement>(null);
  const [nameOverflow, setNameOverflow] = useState(false);
  useLayoutEffect(() => {
    if (!name.current) return;
    const observer = observeOverflow(name.current, setNameOverflow);
    return () => observer?.destroy?.();
  }, []);

  const stateLabel = (() => {
    if (attribution.reason === 'evicted') {
      return m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    if (attribution.reason === 'dispatched' && attribution.hookStillActive !== undefined) {
      return attribution.hookStillActive
        ? m.chat_hookWakeAttribution_wokeAgentStillActive_after()
        : m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    return m.chat_hookWakeAttribution_wokeAgent_after();
  })();

  return (
    <div
      className={`${SUBSCRIPTION_DISCLOSURE_ROW_CLASS} rounded-md ${className}`}
      data-testid="hook-wake-attribution"
    >
      <span className={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
        <LightningIcon
          size={14}
          weight="regular"
          className={`h-3.5! w-3.5! shrink-0 ${SUBSCRIPTION_ICON_CLASS}`}
          aria-hidden="true"
        />
      </span>
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] items-baseline gap-1 overflow-hidden whitespace-nowrap">
        <span
          ref={name}
          className="min-w-0 max-w-full truncate font-normal text-muted-foreground"
          title={
            attribution.rawName && attribution.rawName !== attribution.displayName
              ? attribution.rawName
              : nameOverflow
                ? attribution.displayName
                : undefined
          }
          data-testid="hook-wake-primary-label"
        >
          {attribution.displayName}
        </span>
        <span
          className="min-w-0 truncate font-normal text-muted-foreground"
          data-testid="hook-wake-status"
        >
          {stateLabel}
        </span>
      </span>
    </div>
  );
}

export default HookWakeAttributionHeader;
