// Source: src/lib/components/patterns/settings/SettingsDisclosure.svelte.
import { useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';

export interface SettingsDisclosureProps {
  label: string;
  children?: ReactNode;
  flush?: boolean;
  muted?: boolean;
  className?: string;
  class?: string;
}
export function SettingsDisclosure({
  label,
  children,
  flush = false,
  muted = false,
  className,
  class: legacyClass,
}: SettingsDisclosureProps) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <Accordion
      type="multiple"
      value={value}
      onValueChange={setValue}
      className={cn('min-w-0', legacyClass, className)}
    >
      <AccordionItem value="content">
        <AccordionHeader>
          <AccordionTrigger
            className={cn(
              'type-body font-medium data-[state=open]:font-medium',
              flush && '-ml-2',
              muted &&
                'font-normal text-muted-foreground data-[state=open]:font-normal data-[state=open]:text-muted-foreground',
            )}
          >
            {label}
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionContent className={flush ? '-ml-2' : '-mx-2'}>
          <div hidden={!value.includes('content')}>{children}</div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
