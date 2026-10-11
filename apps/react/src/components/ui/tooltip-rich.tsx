import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import {
  CheckCircleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  TooltipTriggerWrapper,
  type TooltipTriggerWrapperProps,
} from '@/components/ui/tooltip-trigger-wrapper';
import { cn } from '@/lib/utils';
import { m } from '$shared/paraglide/messages.js';
import './tooltip.css';
import './tooltip-rich.css';

export interface TooltipRichProps {
  title?: string;
  description?: string;
  content?: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  alignOffset?: number;
  delayDuration?: number;
  disableHoverableContent?: boolean;
  disableCloseOnTriggerClick?: boolean;
  disabled?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClass?: string;
  contentContainerClass?: string;
  showArrow?: boolean;
  showClose?: boolean;
  /** Explicit close-button callback. Controlled callers also set open=false here. */
  onClose?: () => void;
  variant?: 'default' | 'info' | 'success' | 'warning' | 'error' | 'custom';
  maxWidth?: string;
  interactive?: boolean;
  disableAnimation?: boolean;
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  icon?: Icon;
  footer?: React.ReactNode;
  iconClass?: string;
  footerClass?: string;
  descriptionClass?: string;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
}

const variantConfig = {
  default: { surface: 'bg-popover text-popover-foreground', icon: null, iconColor: '' },
  info: {
    surface: 'bg-popover text-info border border-info/40',
    icon: InfoIcon,
    iconColor: 'text-info',
  },
  success: {
    surface: 'bg-popover text-success border border-success/40',
    icon: CheckCircleIcon,
    iconColor: 'text-success',
  },
  warning: {
    surface: 'bg-popover text-warning-ink border border-warning/40',
    icon: WarningIcon,
    iconColor: 'text-warning-ink',
  },
  error: {
    surface: 'bg-danger text-danger-background border border-danger/40',
    icon: WarningCircleIcon,
    iconColor: 'text-danger-background',
  },
  custom: { surface: '', icon: null, iconColor: '' },
};

type RichTriggerProps = TooltipTriggerWrapperProps & {
  disableCloseOnTriggerClick: boolean;
  onTriggerClick?: TooltipRichProps['onClick'];
};

export function RichTrigger({
  disabled,
  disableCloseOnTriggerClick,
  onTriggerClick,
  onPointerDown: _radixPointerDown,
  onPointerMove,
  onPointerLeave,
  onFocus,
  onBlur,
  onClick,
  ...props
}: RichTriggerProps) {
  const pointerDown = React.useRef(false);
  const pointerDocument = React.useRef<Document | null>(null);
  const releasePointer = React.useCallback(function releasePointer() {
    pointerDown.current = false;
    pointerDocument.current?.removeEventListener('pointerup', releasePointer);
    pointerDocument.current?.removeEventListener('pointercancel', releasePointer);
    pointerDocument.current = null;
  }, []);
  React.useEffect(() => releasePointer, [releasePointer]);

  return (
    <TooltipTriggerWrapper
      {...props}
      disabled={disabled}
      onPointerDown={(event) => {
        // Bits closes on click, whereas Radix also closes on pointer-down. Keep
        // native focus/default actions while suppressing only that Radix behavior.
        if (disabled) return;
        releasePointer();
        pointerDown.current = true;
        pointerDocument.current = event.currentTarget.ownerDocument;
        pointerDocument.current.addEventListener('pointerup', releasePointer, { once: true });
        pointerDocument.current.addEventListener('pointercancel', releasePointer, { once: true });
      }}
      onPointerMove={(event) => {
        if (!disabled) onPointerMove?.(event);
      }}
      onPointerLeave={(event) => {
        if (!disabled) onPointerLeave?.(event);
      }}
      onFocus={(event) => {
        if (!disabled && !pointerDown.current) onFocus?.(event);
      }}
      onBlur={(event) => {
        if (!disabled) onBlur?.(event);
      }}
      onClick={(event) => {
        onTriggerClick?.(event);
        if (!disabled && !disableCloseOnTriggerClick) onClick?.(event);
      }}
    />
  );
}

/** Source port of TooltipRich.svelte; slots are React nodes and icons are Phosphor components. */
export function TooltipRich({
  title = '',
  description = '',
  content,
  side = 'top',
  align = 'center',
  sideOffset = 8,
  alignOffset = 0,
  delayDuration = 200,
  disableHoverableContent = false,
  disableCloseOnTriggerClick = false,
  disabled = false,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  contentClass,
  contentContainerClass,
  showArrow = true,
  showClose = false,
  onClose,
  variant = 'default',
  maxWidth = '20rem',
  interactive = false,
  disableAnimation = false,
  children,
  trigger,
  icon,
  footer,
  iconClass,
  footerClass,
  descriptionClass,
  onClick,
}: TooltipRichProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const wasDisabled = React.useRef(false);
  const config = variantConfig[variant];
  const IconComponent = icon || config.icon;
  const delay = interactive ? 0 : delayDuration;
  const hoverDisabled = !interactive && disableHoverableContent;
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (disabled && next) return;
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [disabled, open, onOpenChange],
  );

  React.useEffect(() => {
    if (disabled && !wasDisabled.current && isOpen) handleOpenChange(false);
    wasDisabled.current = disabled;
  }, [disabled, isOpen, handleOpenChange]);

  return (
    <TooltipPrimitive.Provider delayDuration={delay}>
      <TooltipPrimitive.Root
        open={!disabled && isOpen}
        onOpenChange={handleOpenChange}
        delayDuration={delay}
        disableHoverableContent={hoverDisabled}
      >
        <TooltipPrimitive.Trigger asChild>
          <RichTrigger
            ref={triggerRef}
            disabled={disabled}
            tabIndex={disabled ? undefined : 0}
            className={cn('inline-flex', className)}
            data-tooltip-trigger=""
            data-delay-duration={delay}
            data-disabled={disabled ? '' : undefined}
            disableCloseOnTriggerClick={disableCloseOnTriggerClick}
            onTriggerClick={onClick}
          >
            {trigger ?? children}
          </RichTrigger>
        </TooltipPrimitive.Trigger>
        {!disabled && Boolean(title || description || content) && (
          <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
              role="tooltip"
              side={side}
              align={align}
              sideOffset={sideOffset}
              alignOffset={alignOffset}
              className={cn(
                'tooltip-rich overlay-surface z-(--layer-tooltip)',
                !disableAnimation && 'tooltip-motion',
                config.surface,
                contentClass,
              )}
              style={{ outline: 'none', pointerEvents: hoverDisabled ? 'none' : undefined }}
              data-tooltip-content=""
              data-overlay-surface=""
              onPointerDownOutside={(event) => {
                if (
                  disableCloseOnTriggerClick &&
                  triggerRef.current?.contains(event.target as Node)
                ) {
                  event.preventDefault();
                }
              }}
            >
              <div className="relative" style={{ maxWidth }}>
                {showClose && (
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    onClick={() => {
                      if (open === undefined) setInternalOpen(false);
                      onClose?.();
                    }}
                    className="absolute -right-1 -top-1 size-5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground motion-reduce:transition-none"
                    aria-label={m.ui_tooltipRich_close_ariaLabel()}
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </Button>
                )}
                <div className={cn('flex flex-col gap-1 px-3 py-2', contentContainerClass)}>
                  {(title || IconComponent) && (
                    <div className="flex items-start gap-2">
                      {IconComponent && (
                        <IconComponent
                          className={cn('mt-0.5 size-4 shrink-0', config.iconColor, iconClass)}
                          aria-hidden="true"
                        />
                      )}
                      {title && <h4 className="type-body font-medium">{title}</h4>}
                    </div>
                  )}
                  {description && (
                    <p className={cn('type-body opacity-90', descriptionClass)}>{description}</p>
                  )}
                  {content && <div className="type-caption">{content}</div>}
                </div>
                {footer && <div className={cn('px-3 py-2', footerClass)}>{footer}</div>}
              </div>
              {showArrow && (
                <TooltipPrimitive.Arrow asChild>
                  <div className="tooltip-rich-arrow z-50 bg-border" />
                </TooltipPrimitive.Arrow>
              )}
            </TooltipPrimitive.Content>
          </TooltipPrimitive.Portal>
        )}
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
