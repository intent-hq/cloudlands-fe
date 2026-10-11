import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { HoverCard } from '@/components/ui/hover-card';
import { fly, usePresence, usePresenceTransition } from '@/lib/motion';
import type { DiagramState, DiagramNarrative } from '$shared/types/notes-primitives';
import { m } from '$shared/paraglide/messages.js';
import './diagram-controls.css';
export interface DiagramControlsProps {
  states: DiagramState[];
  currentStateId?: string;
  onStateChange: (stateId: string) => void;
}
function getNarrative(narrative: DiagramNarrative | string | undefined): DiagramNarrative | null {
  return !narrative ? null : typeof narrative === 'string' ? { text: narrative } : narrative;
}
function Narrative({
  narrative,
  direction,
  present,
  onExit,
}: {
  narrative: DiagramNarrative;
  direction: 'left' | 'right';
  present: boolean;
  onExit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestDirection = useRef(direction);
  useLayoutEffect(() => {
    latestDirection.current = direction;
  }, [direction]);
  const transition = useMemo(
    () =>
      (node: HTMLElement) =>
      ({ direction: phase = 'in' }: { direction?: 'in' | 'out' } = {}) => {
        const distance = (latestDirection.current === 'left' ? 8 : -8) * (phase === 'out' ? -1 : 1);
        const recipe = fly(node, { axis: 'x', distance, tier: 'fast' }, { direction: phase });
        return typeof recipe === 'function' ? recipe({ direction: phase }) : recipe;
      },
    [],
  );
  usePresenceTransition(ref, present, onExit, transition);
  return (
    <div ref={ref} className="narrative">
      {narrative.title && <div className="narrative-title">{narrative.title}</div>}
      {narrative.text && <div className="narrative-text">{narrative.text}</div>}
    </div>
  );
}
export function DiagramControls({ states, currentStateId, onStateChange }: DiagramControlsProps) {
  const currentIndex = currentStateId
    ? states.findIndex((state) => state.id === currentStateId)
    : -1;
  const currentState = currentIndex >= 0 ? states[currentIndex] : null;
  const [previousIndex, setPreviousIndex] = useState(-1);
  const direction = previousIndex < currentIndex ? 'left' : 'right';
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const navigation = useRef<HTMLFieldSetElement>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const latest = useRef({ states, currentStateId });
  useLayoutEffect(() => {
    latest.current = { states, currentStateId };
  }, [states, currentStateId]);
  useEffect(
    () => () => {
      if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    },
    [],
  );
  const narrative = useMemo(() => getNarrative(currentState?.narrative), [currentState?.narrative]);
  const items = useMemo(
    () => (narrative ? [{ id: currentIndex, narrative }] : []),
    [currentIndex, narrative],
  );
  const presence = usePresence(items, (item) => item.id);
  function goToState(index: number) {
    setPreviousIndex(currentIndex);
    setHoveredIndex(null);
    onStateChange(states[index].id);
  }
  function keydown(event: KeyboardEvent, index: number) {
    if (states.length <= 1) return;
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, index - 1)
        : event.key === 'ArrowRight'
          ? Math.min(states.length - 1, index + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? states.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    if (next === index) return;
    goToState(next);
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    const stateId = states[next]?.id,
      element = navigation.current;
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = undefined;
      if (
        element !== navigation.current ||
        stateId !== latest.current.currentStateId ||
        states !== latest.current.states
      )
        return;
      element
        ?.querySelector<HTMLButtonElement>(`[data-diagram-step-index="${next}"]`)
        ?.focus({ preventScroll: true });
    });
  }
  return (
    <div className="diagram-controls">
      <div className="controls-inner">
        <div className="narrative-region" aria-live="polite" aria-atomic="true">
          {presence.entries.map((entry) => (
            <Narrative
              key={entry.key}
              narrative={entry.value.narrative}
              direction={direction}
              present={entry.present}
              onExit={() => presence.remove(entry.key)}
            />
          ))}
        </div>
        <fieldset
          className="state-navigation"
          aria-label={m.diagram_controls_walkthrough_ariaLabel()}
          ref={navigation}
        >
          <div className="stepper">
            {states.map((state, index) => {
              const preview = getNarrative(state.narrative);
              return (
                <span key={state.id} style={{ display: 'contents' }}>
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    iconOnly
                    className={`stepper-dot ${index === currentIndex ? 'active' : ''} ${index < currentIndex ? 'completed' : ''}`}
                    data-diagram-step-index={index}
                    style={{ anchorName: `--segment-${index}` } as CSSProperties}
                    onClick={() => goToState(index)}
                    onKeyDown={(event) => keydown(event, index)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    aria-current={index === currentIndex ? 'step' : undefined}
                    tabIndex={index === currentIndex ? 0 : -1}
                    aria-label={m.diagram_controls_state_ariaLabel({
                      number: index + 1,
                      title:
                        preview?.title ||
                        m.diagram_controls_stateNumber_label({ number: index + 1 }),
                    })}
                  />
                  {hoveredIndex === index && preview && (
                    <HoverCard
                      anchor={`--segment-${index}`}
                      position="top"
                      className="rounded-md !pointer-events-none"
                    >
                      <div className="p-2.5">
                        {preview.title && (
                          <div className="text-xs font-medium mb-0.5">{preview.title}</div>
                        )}
                        {preview.text && (
                          <div className="text-ui text-subtle leading-snug">{preview.text}</div>
                        )}
                      </div>
                    </HoverCard>
                  )}
                </span>
              );
            })}
          </div>
          <span
            className="step-counter"
            aria-label={m.diagram_controls_stepCounter_ariaLabel({
              current: currentIndex + 1,
              total: states.length,
            })}
          >
            {currentIndex + 1}/{states.length}
          </span>
          {states.length > 1 && (
            <div className="navigation-buttons">
              <Button
                variant="ghost"
                size="icon-compact"
                iconOnly
                className="diagram-nav-button"
                onClick={() => {
                  setPreviousIndex(currentIndex);
                  if (currentIndex > 0) onStateChange(states[currentIndex - 1].id);
                }}
                disabled={currentIndex <= 0}
                aria-label={m.diagram_controls_previousStep_ariaLabel()}
              >
                <CaretLeftIcon className="text-ui" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-compact"
                iconOnly
                className="diagram-nav-button"
                onClick={() => {
                  setPreviousIndex(currentIndex);
                  if (currentIndex < states.length - 1) onStateChange(states[currentIndex + 1].id);
                }}
                disabled={currentIndex >= states.length - 1}
                aria-label={m.diagram_controls_nextStep_ariaLabel()}
              >
                <CaretRightIcon className="text-ui" aria-hidden="true" />
              </Button>
            </div>
          )}
        </fieldset>
      </div>
    </div>
  );
}
export default DiagramControls;
