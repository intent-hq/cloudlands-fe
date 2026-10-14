import type { ReactNode } from 'react';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faArrowDown, faArrowRight, faXmark } from '$lib/icons/phosphor-icon-definitions';
import { Button, type ButtonProps } from '@/components/ui/button';
import { IntentMarkLoader } from '@/components/ui/indicators';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface DividerButtonProps extends Omit<ButtonProps, 'loading' | 'children' | 'onClick'> {
  onClick?: () => void;
  loading?: boolean;
  expanded?: boolean;
  showArrow?: boolean;
  arrowUp?: boolean;
  arrowRight?: boolean;
  icon?: IconDefinition;
  tooltipContents?: string;
  children?: ReactNode;
}

export function DividerButton({
  onClick,
  disabled = false,
  loading = false,
  expanded = false,
  showArrow = true,
  arrowUp = false,
  arrowRight = false,
  icon,
  tooltipContents = '',
  children,
  ...restProps
}: DividerButtonProps) {
  const buttonClass = cn(
    'relative z-20 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1.5 py-1.5 px-3 rounded-md border border-border hover:border-border bg-background -mb-px',
    'disabled:bg-sidebar disabled:cursor-default disabled:hover:text-muted-foreground/50 disabled:text-muted-foreground',
  );
  const button = (
    <Button
      variant="ghost"
      type="button"
      className={buttonClass}
      onClick={onClick}
      disabled={disabled}
      {...restProps}
    >
      {loading ? (
        <IntentMarkLoader size={12} />
      ) : (
        <>
          {arrowUp && showArrow && (
            <IconDefinitionIcon
              icon={faArrowDown}
              size="0.75em"
              className="text-ghost rotate-180"
            />
          )}
          {icon && <IconDefinitionIcon icon={icon} size="0.75em" className="text-ghost" />}
          {children}
          {!arrowUp && showArrow && (
            <IconDefinitionIcon
              icon={expanded ? faXmark : arrowRight ? faArrowRight : faArrowDown}
              size="0.75em"
              className="text-ghost"
            />
          )}
        </>
      )}
    </Button>
  );
  if (!tooltipContents) return button;
  return (
    <TooltipProvider delayDuration={200}>
      <TooltipRoot delayDuration={200} disableHoverableContent>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          sideOffset={4}
          showArrow={false}
          className="z-50 w-fit max-w-xs text-balance shadow-xs whitespace-pre-wrap bg-popover text-popover-foreground border border-border px-2 py-1 text-xs animate-in fade-in-0 zoom-in-95"
        >
          {tooltipContents}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}
