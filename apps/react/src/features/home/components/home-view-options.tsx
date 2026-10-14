import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faSliders } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import './home-controls.css';

export function HomeViewOptions({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="home-control-fill shrink-0 rounded-full"
          aria-label={m.home_view_options()}
          tooltip={m.home_view_options()}
        >
          <IconDefinitionIcon icon={faSliders} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-3">
          <span className="type-caption font-medium">{m.home_view_options()}</span>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
