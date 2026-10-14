import type { IconDefinition } from '$lib/icons/icon-definition';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';

export interface ProposalCardHeaderProps {
  icon: IconDefinition;
  title: string;
  summary?: string;
}

export function ProposalCardHeader({ icon, title, summary }: ProposalCardHeaderProps) {
  return (
    <header className="flex min-w-0 items-start gap-3" data-proposal-card-header="">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-large) border border-primary/20 bg-primary/10 text-primary"
        aria-hidden="true"
        data-proposal-header-icon=""
      >
        <IconDefinitionIcon icon={icon} className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="type-title font-semibold text-foreground">{title}</h3>
        {summary ? (
          <p className="type-body mt-1 leading-relaxed text-muted-foreground">{summary}</p>
        ) : null}
      </div>
    </header>
  );
}
