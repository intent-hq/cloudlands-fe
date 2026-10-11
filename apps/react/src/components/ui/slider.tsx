// Source: src/lib/components/ui/slider/slider.svelte and slider.types.ts.
// The source's native range, scalar API and editable readout are retained instead of stock shadcn's array API.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type InputEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { cn } from '@/lib/utils';
import {
  Spring,
  springIn,
  crispOut,
  usePresence,
  usePresenceTransition,
  type SpringTierName,
  type TransitionFactory,
} from '@/lib/motion';
import './slider.css';
export type SliderValue = number | [number, number];
export type SliderValuePosition = 'left' | 'right' | 'top' | 'bottom' | 'tooltip';
export type SliderAppearance = 'default' | 'overlay';
export type SliderProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'defaultValue'> & {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  formatValue?: (value: number) => string;
  steps?: number[];
  showSteps?: boolean;
  showValue?: boolean;
  valuePosition?: SliderValuePosition;
  appearance?: SliderAppearance;
  onInteractionStart?: () => void;
};
const THUMB_SIZE = 20;
const THUMB_SIZE_REST = 16;
const TRACK_HEIGHT = 18;
const TRACK_INSET = (THUMB_SIZE - TRACK_HEIGHT) / 2;
const centerStyle = (percent: number) =>
  `calc(${percent * 100}% + ${THUMB_SIZE / 2 - percent * THUMB_SIZE}px)`;
const thumbStyle = (percent: number) => `calc(${percent * 100}% - ${percent * THUMB_SIZE}px)`;
const fillStyle = (percent: number) =>
  `calc(${percent * 100}% + ${THUMB_SIZE / 2 - TRACK_INSET - percent * THUMB_SIZE}px)`;
const tooltipTransition: TransitionFactory =
  (node) =>
  ({ direction } = {}) =>
    direction === 'out'
      ? crispOut(node, { tier: 'fast', y: 4, scale: 0.98 })
      : springIn(node, { tier: 'fast', y: 4, scale: 0.98 });
function SliderTooltip({
  value,
  percent,
  pressed,
  present,
  onExit,
}: {
  value: string;
  percent: number;
  pressed: boolean;
  present: boolean;
  onExit: () => void;
}) {
  const root = useRef<HTMLOutputElement>(null);
  usePresenceTransition(root, present, onExit, tooltipTransition);
  return (
    <output
      ref={root}
      data-slot="slider-tooltip"
      className="pointer-events-none absolute top-[-20px] z-30 -translate-x-1/2 whitespace-nowrap rounded-(--shape-input-radius) bg-foreground px-2 py-1 text-xs text-background tabular-nums"
      style={{ left: centerStyle(percent), fontVariationSettings: "'wght' 500" }}
      hidden={pressed}
      aria-hidden="true"
    >
      {value}
    </output>
  );
}
function useSliderSpring(target: number, tier: SpringTierName, instant = false) {
  const [current, setCurrent] = useState(target);
  const initial = useRef(target);
  const controller = useRef<Spring<number> | null>(null);
  useLayoutEffect(() => {
    const spring = new Spring(initial.current, tier);
    controller.current = spring;
    const stop = spring.subscribe(() => setCurrent(spring.current));
    return () => {
      stop();
      spring.destroy();
      controller.current = null;
    };
  }, [tier]);
  useLayoutEffect(() => {
    void controller.current?.set(target, { instant });
  }, [target, instant]);
  return current;
}
export function Slider({
  ref,
  value: controlled,
  defaultValue = 0,
  min: minProp = 0,
  max: maxProp = 100,
  step: stepProp = 1,
  steps,
  showSteps = false,
  showValue = false,
  valuePosition = 'right',
  appearance = 'default',
  disabled = false,
  onInteractionStart,
  onValueChange,
  onInput,
  onKeyDown,
  onFocus,
  onBlur,
  formatValue = String,
  className,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-valuetext': ariaValueText,
  ...rest
}: SliderProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const input = useRef<HTMLInputElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const [pressed, setPressed] = useState(false);
  const dragging = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const editingNow = useRef(false);
  const [editValue, setEditValue] = useState('');
  const [previewValue, setPreviewValue] = useState<number | null>(null);
  const [tooltipReady, setTooltipReady] = useState(false);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepValues = useMemo(() => {
    if (!steps?.length) return null;
    const sorted = [...new Set(steps.filter(Number.isFinite))].sort((a, b) => a - b);
    return sorted.length ? sorted : null;
  }, [steps]);
  const min = stepValues?.[0] ?? Number(minProp);
  const max = stepValues?.[stepValues.length - 1] ?? Number(maxProp);
  const step = Math.max(Number(stepProp) || 1, Number.EPSILON);
  const invalid = ariaInvalid === true || ariaInvalid === 'true';
  function snap(candidate: number) {
    const clamped = Math.max(min, Math.min(max, candidate));
    if (stepValues)
      return stepValues.reduce((nearest, option) =>
        Math.abs(option - clamped) < Math.abs(nearest - clamped) ? option : nearest,
      );
    const snapped = min + Math.round((clamped - min) / step) * step;
    return Number(Math.max(min, Math.min(max, snapped)).toFixed(12));
  }
  const toPercent = (candidate: number) =>
    max === min ? 0 : Math.max(0, Math.min(1, (candidate - min) / (max - min)));
  const candidates = stepValues ?? [min, max, snap(min + step), snap(max - step)];
  const decimals = (candidate: number) => {
    const [coefficient, exponent = '0'] = String(candidate).split('e');
    return Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
  };
  const precision = Math.min(12, Math.max(decimals(min), decimals(step)));
  const valueWidth = candidates.reduce((width, candidate) => {
    const raw = String(candidate);
    const formatted = formatValue(candidate);
    const numericWidth = stepValues ? raw.length : candidate.toFixed(precision).length;
    return Math.max(
      width,
      formatted.length,
      numericWidth + Math.max(0, formatted.length - raw.length),
    );
  }, 1);
  const currentPercent = toPercent(value);
  const previewPercent = previewValue === null ? null : toPercent(previewValue);
  const thumbPosition = useSliderSpring(currentPercent, 'moderate', pressed);
  const thumbSize = useSliderSpring(hovered || pressed ? THUMB_SIZE : THUMB_SIZE_REST, 'fast');
  const previews = useMemo(
    () =>
      previewValue !== null && tooltipReady
        ? [{ id: 'preview', value: formatValue(previewValue), percent: previewPercent ?? 0 }]
        : [],
    [previewValue, tooltipReady, formatValue, previewPercent],
  );
  const tooltip = usePresence(previews, (entry) => entry.id);
  useEffect(
    () => () => {
      if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (editing) {
      editInput.current?.focus();
      editInput.current?.select();
    }
  }, [editing]);
  function valueFromClientX(clientX: number) {
    const node = track.current;
    if (!node) return min;
    const rect = node.getBoundingClientRect();
    const layoutWidth = node.offsetWidth || rect.width;
    if (layoutWidth <= THUMB_SIZE || rect.width <= 0) return min;
    const scale = rect.width / layoutWidth;
    const localX = (clientX - rect.left) / scale;
    return snap(
      min +
        Math.max(0, Math.min(1, (localX - THUMB_SIZE / 2) / (layoutWidth - THUMB_SIZE))) *
          (max - min),
    );
  }
  function dispatchInput(next: number) {
    const node = input.current;
    if (!node) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(node, String(next));
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function dispatchChange() {
    input.current?.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function handleInput(event: InputEvent<HTMLInputElement>) {
    const next = snap(event.currentTarget.valueAsNumber);
    event.currentTarget.value = String(next);
    if (next !== value) {
      setInternal(next);
      onValueChange?.(next);
    }
    onInput?.(event);
  }
  function handleKeydown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    const index = stepValues?.indexOf(snap(value)) ?? -1;
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = stepValues ? stepValues[Math.min(stepValues.length - 1, index + 1)] : value + step;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = stepValues ? stepValues[Math.max(0, index - 1)] : value - step;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      case 'PageUp':
        next = stepValues
          ? stepValues[Math.min(stepValues.length - 1, index + 10)]
          : value + step * 10;
        break;
      case 'PageDown':
        next = stepValues ? stepValues[Math.max(0, index - 10)] : value - step * 10;
        break;
    }
    if (next === undefined) return;
    event.preventDefault();
    const snapped = snap(next);
    if (snapped === value) return;
    dispatchInput(snapped);
    dispatchChange();
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    onInteractionStart?.();
    event.preventDefault();
    dragging.current = true;
    setPressed(true);
    dispatchInput(valueFromClientX(event.clientX));
    input.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const next = valueFromClientX(event.clientX);
    if (!dragging.current) setPreviewValue(next);
    else dispatchInput(next);
  }
  function pointerEnd() {
    if (!dragging.current) return;
    dragging.current = false;
    setPressed(false);
    setPreviewValue(null);
    dispatchChange();
  }
  function startEditing() {
    if (disabled || valuePosition === 'tooltip') return;
    setEditValue(String(value));
    editingNow.current = true;
    setEditing(true);
  }
  function commitEditing() {
    if (!editingNow.current) return;
    editingNow.current = false;
    setEditing(false);
    const parsed = Number.parseFloat(editValue);
    if (Number.isFinite(parsed)) {
      dispatchInput(snap(parsed));
      dispatchChange();
    }
  }
  function cancelEditing() {
    editingNow.current = false;
    setEditing(false);
  }
  const valueDisplay = (
    <span
      data-slot="slider-value"
      className="inline-grid shrink-0 text-[13px] leading-none text-muted-foreground tabular-nums"
      style={{
        fontVariationSettings: "'wght' 500",
        width: `${valueWidth}ch`,
        alignSelf: valuePosition === 'top' || valuePosition === 'bottom' ? 'center' : undefined,
        textAlign: valuePosition === 'left' || valuePosition === 'right' ? 'right' : 'center',
      }}
    >
      {editing ? (
        <input
          ref={editInput}
          value={editValue}
          onChange={(event) => setEditValue(event.currentTarget.value)}
          type="number"
          min={min}
          max={max}
          step={stepValues ? 'any' : step}
          aria-label={ariaLabel}
          className="slider-value-input w-full min-w-0 rounded-(--shape-input-radius) border-b border-border bg-transparent text-foreground outline-none [text-align:inherit]"
          onBlur={commitEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitEditing();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelEditing();
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="w-full min-w-0 cursor-text select-none rounded-(--shape-input-radius) text-inherit whitespace-nowrap [text-align:inherit]"
          disabled={disabled}
          onClick={startEditing}
        >
          {formatValue(value)}
        </button>
      )}
    </span>
  );
  const previewLeft =
    previewPercent === null
      ? '0px'
      : previewValue === min
        ? `${TRACK_INSET}px`
        : centerStyle(Math.min(currentPercent, previewPercent));
  const distance = Math.abs((previewPercent ?? currentPercent) - currentPercent);
  const previewWidth =
    previewPercent === null
      ? '0px'
      : previewValue === min
        ? `calc(${centerStyle(currentPercent)} - ${TRACK_INSET}px)`
        : previewValue === max
          ? `calc(100% - ${centerStyle(currentPercent)} - ${TRACK_INSET}px)`
          : `calc(${distance * 100}% - ${distance * THUMB_SIZE}px)`;
  return (
    <div
      data-slot="slider-root"
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-pressed={pressed || undefined}
      data-appearance={appearance}
      className={cn(
        'flex w-full min-w-24 select-none touch-none overflow-visible',
        valuePosition === 'left' || valuePosition === 'right'
          ? 'flex-row items-center gap-2'
          : 'flex-col gap-1',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {showValue && (valuePosition === 'left' || valuePosition === 'top') && valueDisplay}
      <div className="relative min-w-0 flex-1 overflow-visible">
        <input
          {...rest}
          ref={(node) => {
            input.current = node;
            if (typeof ref === 'function') return ref(node);
            if (ref) ref.current = node;
          }}
          type="range"
          min={min}
          max={max}
          step={stepValues ? 'any' : step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-valuenow={value}
          aria-valuetext={ariaValueText ?? formatValue(value)}
          data-slot="slider"
          className={cn(
            'peer pointer-events-none absolute inset-0 z-20 h-9 w-full cursor-ew-resize opacity-0 outline-none',
            'aria-invalid:accent-danger aria-invalid:ring-1 aria-invalid:ring-danger/25',
            className,
          )}
          onInput={handleInput}
          onChange={rest.onChange ?? (() => {})}
          onKeyDown={handleKeydown}
          onFocus={(event) => {
            setFocused(event.currentTarget.matches(':focus-visible'));
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
        />
        <div
          ref={track}
          data-slot="slider-track"
          role="presentation"
          className="slider-hit-area relative h-9 w-full cursor-ew-resize overflow-visible"
          onPointerEnter={() => {
            if (disabled) return;
            setHovered(true);
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            hoverTimeout.current = setTimeout(() => setTooltipReady(true), 100);
          }}
          onPointerLeave={() => {
            setHovered(false);
            setTooltipReady(false);
            setPreviewValue(null);
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
        >
          {tooltip.entries.map((entry) => (
            <SliderTooltip
              key={entry.key}
              value={entry.value.value}
              percent={entry.value.percent}
              pressed={pressed}
              present={entry.present}
              onExit={() => tooltip.remove(entry.key)}
            />
          ))}
          <span
            aria-hidden="true"
            data-slot="slider-track-background"
            className={cn(
              'absolute inset-x-px top-[9px] h-[18px] overflow-hidden rounded-full border bg-transparent',
              appearance === 'overlay' ? 'border-transparent' : 'border-border',
            )}
          />
          <span
            aria-hidden="true"
            data-slot="slider-fill"
            className={cn(
              'absolute top-[9px] left-px h-[18px] rounded-full',
              appearance === 'overlay'
                ? 'bg-transparent'
                : invalid
                  ? 'bg-danger/30 dark:bg-danger/35'
                  : 'bg-selected/50 dark:bg-accent/40',
            )}
            style={{ width: fillStyle(thumbPosition) }}
          />
          <span
            aria-hidden="true"
            data-slot="slider-preview"
            className={cn(
              'pointer-events-none absolute top-[9px] h-[18px] rounded-full transition-opacity duration-spring-fast ease-spring-fast motion-reduce:transition-none',
              appearance === 'overlay' ? 'bg-transparent' : 'bg-accent/40',
              (previewValue === null || pressed) && 'opacity-0',
            )}
            style={{ left: previewLeft, width: previewWidth }}
          />
          {showSteps &&
            stepValues?.map((pip) => (
              <span
                key={pip}
                aria-hidden="true"
                data-slot="slider-pip"
                className="pointer-events-none absolute top-1/2 z-10 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30"
                style={{ left: centerStyle(toPercent(pip)) }}
              />
            ))}
          <span
            aria-hidden="true"
            data-slot="slider-thumb"
            className={cn(
              'pointer-events-none absolute top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-background shadow-(--elevation-raised)',
              focused && 'outline outline-1 outline-focus-ring outline-offset-2 shadow-none',
              invalid && 'border-danger',
            )}
            style={{
              left: thumbStyle(thumbPosition),
              width: `${thumbSize}px`,
              height: `${thumbSize}px`,
            }}
          />
        </div>
      </div>
      {showValue && (valuePosition === 'right' || valuePosition === 'bottom') && valueDisplay}
    </div>
  );
}
export { Slider as Root };
