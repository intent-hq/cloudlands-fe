// Source: src/lib/components/chat/LiveStreamPhaseIndicator.svelte.
import { useEffect, useMemo, useRef, useState } from 'react';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { usePresence, usePresenceTransition } from '@/lib/motion';
import type { LiveStreamPhase } from '../../../../../../src/store/renderer/slices/chat-state/chat-state-types';
import {
  LIVE_STREAM_PHASE_GRACE_MS,
  isPreLivePhase,
  liveStreamPhaseMessage,
  shouldShowLiveStreamPhaseIndicator,
} from '$lib/components/chat/live-stream-phase';
import { chatDisclosureTransition } from './chat-motion';

export interface LiveStreamPhaseIndicatorProps {
  phase?: LiveStreamPhase | null;
  turnInFlight?: boolean;
  /** React spelling of the source's class prop. */
  className?: string;
}

export function LiveStreamPhaseIndicator({
  phase = null,
  turnInFlight = false,
  className = '',
}: LiveStreamPhaseIndicatorProps) {
  const eligible = shouldShowLiveStreamPhaseIndicator({ phase, turnInFlight });
  const [graceElapsed, setGraceElapsed] = useState(false);

  useEffect(() => {
    if (!eligible) {
      // oxlint-disable-next-line react/set-state-in-effect -- Source eligibility loss resets the grace period for the next subscription.
      setGraceElapsed(false);
      return;
    }
    // Depend on eligibility alone: changing pre-live phases keeps the same timer.
    const timer = setTimeout(() => setGraceElapsed(true), LIVE_STREAM_PHASE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [eligible]);

  const visible = eligible && graceElapsed;
  const message = phase !== null && isPreLivePhase(phase) ? liveStreamPhaseMessage(phase) : '';
  // Svelte pauses the outgoing branch: retain its last rendered text and class until exit.
  const items = useMemo(
    () => (visible ? [{ message, className }] : []),
    [visible, message, className],
  );
  const { entries, remove } = usePresence(items, () => 'live-stream-phase');

  return entries.map(({ key, value, present }) => (
    <LiveStreamPhaseRow
      key={key}
      message={value.message}
      className={value.className}
      present={present}
      onExit={() => remove(key)}
    />
  ));
}

function LiveStreamPhaseRow({
  message,
  className,
  present,
  onExit,
}: {
  message: string;
  className: string;
  present: boolean;
  onExit: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  usePresenceTransition(root, present, onExit, chatDisclosureTransition);

  return (
    <div
      ref={root}
      className={`flex items-center gap-2 text-subtle py-1 pl-2 ${className}`}
      data-testid="live-stream-phase-indicator"
      inert={!present}
    >
      <IntentMarkLoader size={14} />
      <span className="text-xs text-subtle font-medium" data-testid="live-stream-phase-message">
        {message}
      </span>
    </div>
  );
}

export default LiveStreamPhaseIndicator;
