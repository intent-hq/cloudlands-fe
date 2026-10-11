import { useEffect, useId, useRef, useState, type HTMLAttributes } from 'react';
import { Button } from '@/components/ui/button';
import { CopyFeedback } from '@/components/ui/copy-feedback';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSize, type UiSize } from '@/components/ui/size-context';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import './copy-input.css';

type CopyStatus = 'idle' | 'copied' | 'error';
export interface CopyInputProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'aria-label' | 'onCopy'
> {
  value: string;
  label?: string;
  disabled?: boolean;
  variant?: 'icon' | 'button';
  align?: 'right' | 'left';
  size?: UiSize;
  onCopy?: () => void;
}

export function CopyInput({
  value,
  label,
  disabled = false,
  variant = 'icon',
  align = 'right',
  size,
  onCopy,
  className,
  ...props
}: CopyInputProps) {
  const uid = useId();
  const contextSize = useSize();
  const buttonId = `${uid}-button`;
  const labelId = `${uid}-label`;
  const resolvedSize = size ?? contextSize;
  const rowPadding = resolvedSize === 'compact' ? 'py-1' : 'py-2';
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [copyCount, setCopyCount] = useState(0);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipState, setTooltipState] = useState<'idle' | 'copied' | 'suppressed'>('idle');
  const tooltipWasVisible = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  const idleLabel = label ? m.ui_copyButton_label() : m.ui_copyInput_copyToClipboard_ariaLabel();
  const statusLabel =
    status === 'copied'
      ? m.ui_copyInput_copied_label()
      : status === 'error'
        ? m.ui_copyInput_copyFailed_ariaLabel()
        : idleLabel;
  const actionLabel =
    status === 'copied'
      ? m.ui_copyInput_copied_label()
      : status === 'error'
        ? m.ui_copyInput_failed_label()
        : m.ui_copyButton_label();
  const resolvedTooltipOpen =
    tooltipState === 'copied' ? true : tooltipState === 'suppressed' ? false : tooltipOpen;

  function copyViaExecCommand() {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  async function handleCopy() {
    if (disabled) return;
    let copied = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else copied = copyViaExecCommand();
    } catch {
      copied = copyViaExecCommand();
    }
    if (copied) onCopy?.();
    if (!mounted.current) return;
    setStatus(copied ? 'copied' : 'error');
    setCopyCount((count) => count + 1);
    setTooltipState(tooltipWasVisible.current ? 'copied' : 'suppressed');
    setTooltipOpen(tooltipWasVisible.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStatus('idle');
      setTooltipState('suppressed');
      setTooltipOpen(false);
    }, 2000);
  }

  const icon =
    status === 'idle' ? (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
        <path d="M9.5 4.5V3.25A1.75 1.75 0 0 0 7.75 1.5h-4.5A1.75 1.75 0 0 0 1.5 3.25v4.5A1.75 1.75 0 0 0 3.25 9.5H4.5" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="2 4 20 16" fill="none" aria-hidden="true">
        <path
          className="copy-input-draw"
          pathLength="1"
          strokeDasharray="1"
          d={status === 'copied' ? 'M6 12L10 16L18 8' : 'M9 9L15 15M15 9L9 15'}
        />
      </svg>
    );
  const action = (
    <span
      data-slot="copy-input-action"
      className={cn(
        'flex shrink-0 items-center px-1.5 text-muted-foreground transition-colors duration-spring-fast ease-spring-fast group-hover:text-foreground motion-reduce:transition-none',
        rowPadding,
      )}
    >
      <CopyFeedback
        transitionKey={`${status}-${copyCount}`}
        slot="copy-input-feedback"
        className={cn(
          'flex items-center justify-center gap-1.5 [&_svg]:shrink-0 [&_svg]:stroke-current [&_svg]:stroke-[1.5] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast group-hover:[&_svg]:stroke-2 motion-reduce:[&_svg]:transition-none',
          status === 'error' && 'text-danger',
        )}
        scale={status === 'idle' ? 0.8 : 0.6}
        exitScale={0.8}
      >
        {icon}
        {variant === 'button' && (
          <span className="inline-grid select-none text-left">
            <span className="invisible col-start-1 row-start-1" aria-hidden="true">
              {m.ui_copyInput_copied_label()}
            </span>
            <span data-slot="copy-input-action-label" className="col-start-1 row-start-1">
              {actionLabel}
            </span>
          </span>
        )}
      </CopyFeedback>
    </span>
  );
  const valueContent = (
    <span
      data-slot="copy-input-value"
      className={cn(
        'min-w-0 flex-1 select-none truncate text-left text-foreground',
        rowPadding,
        align === 'left' ? 'pl-1' : 'pl-0',
      )}
    >
      <mark className="bg-transparent text-foreground transition-colors duration-spring-fast ease-spring-fast group-hover:bg-focus-ring/20 group-hover:text-foreground motion-reduce:transition-none">
        {value}
      </mark>
    </span>
  );
  const button = (
    <Button
      id={buttonId}
      type="button"
      variant="plain"
      size={resolvedSize}
      truncateLabel={false}
      labelClass="flex! w-full items-center"
      data-slot="copy-input-button"
      data-size={resolvedSize}
      style={{ lineHeight: '1.25rem' }}
      className="group h-auto! w-full justify-start rounded-(--radius-medium) border-0 bg-transparent p-0 text-sm font-normal leading-5 transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none"
      disabled={disabled}
      aria-label={statusLabel}
      aria-labelledby={label ? `${buttonId} ${labelId}` : undefined}
      onPointerDown={() => {
        tooltipWasVisible.current = tooltipOpen;
      }}
      onClick={handleCopy}
    >
      {align === 'left' ? (
        <>
          {action}
          {valueContent}
        </>
      ) : (
        <>
          {valueContent}
          {action}
        </>
      )}
    </Button>
  );
  return (
    <div
      data-slot="copy-input-field"
      data-disabled={disabled || undefined}
      className={cn(
        'flex flex-col gap-0.5',
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onMouseEnter={() => {
        if (tooltipState === 'suppressed') setTooltipState('idle');
      }}
      onMouseLeave={() => {
        if (tooltipState === 'copied') setTooltipState('suppressed');
        setTooltipOpen(false);
      }}
      {...props}
    >
      {label && (
        <span
          id={labelId}
          data-slot="copy-input-label"
          className={cn('type-caption text-muted-foreground', align === 'left' ? 'pl-1' : 'pl-0')}
        >
          {label}
        </span>
      )}
      {variant === 'icon' ? (
        <Tooltip
          delayDuration={500}
          disableHoverableContent
          open={!disabled && resolvedTooltipOpen}
          onOpenChange={(open) => {
            if (tooltipState === 'idle') setTooltipOpen(open);
          }}
        >
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          {!disabled && (
            <TooltipContent sideOffset={2} showArrow={false}>
              {statusLabel}
            </TooltipContent>
          )}
        </Tooltip>
      ) : (
        button
      )}
    </div>
  );
}
