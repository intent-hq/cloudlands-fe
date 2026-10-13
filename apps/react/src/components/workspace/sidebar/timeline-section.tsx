import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faChevronDown, faChevronRight } from '$lib/icons/phosphor-icon-definitions';

export interface TimelineSectionProps {
  title: string;
  subtitle?: string;
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  active?: boolean;
  activeColor?: string;
  action?: ReactNode;
  children?: ReactNode;
}

export function TimelineSection({
  title,
  subtitle,
  collapsible = false,
  expanded = true,
  onToggle,
  active = false,
  activeColor = 'bg-primary',
  action,
  children,
}: TimelineSectionProps) {
  const heading = (
    <>
      {title}
      {!collapsible && subtitle ? ' ' : null}
      {subtitle && (
        <span className="inline-block ml-0.5 font-normal text-muted-foreground">/ {subtitle}</span>
      )}
    </>
  );

  return (
    <div className="relative pl-4 pb-2">
      <div
        className={`absolute left-[3px] top-[9px] size-1.5 rounded-full bg-border ${active ? activeColor : 'bg-border'}`}
      />
      <div className="flex items-center justify-between mb-1">
        <Header size={5} className="shrink-0 whitespace-nowrap">
          {collapsible ? (
            <Button
              variant="plain"
              size="compact"
              className="h-auto justify-start gap-1 text-[length:inherit] font-medium"
              aria-expanded={expanded}
              onClick={onToggle}
              onKeyDown={(event) => event.stopPropagation()}
              trailingIcon={
                <IconDefinitionIcon
                  icon={expanded ? faChevronDown : faChevronRight}
                  className="size-2.5 text-muted-foreground"
                />
              }
            >
              {heading}
            </Button>
          ) : (
            heading
          )}
        </Header>
        {action}
      </div>
      {children !== undefined && (!collapsible || expanded) && (
        <div className="w-full pl-2">{children}</div>
      )}
    </div>
  );
}
