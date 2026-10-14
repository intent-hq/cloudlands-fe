// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { ProposalCardHeader } from '@/components/chat/proposals/proposal-card-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ProposalCardHeaderExamples() {
  const [title, setTitle] = useState('Review the proposed workspace configuration');
  const [summary, setSummary] = useState(
    'Confirm the changes to the selected workspace before applying them. Each setting remains available for review.',
  );
  const [showSummary, setShowSummary] = useState(true);
  return (
    <section className="grid w-full max-w-lg gap-4" data-testid="proposal-header-demo">
      <header>
        <h1>Proposal header</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div data-testid="proposal-header-frame">
        <ProposalCardHeader
          icon={{ iconName: 'bolt' }}
          title={title}
          summary={showSummary ? summary : undefined}
        />
      </div>
      <Input
        aria-label="Proposal title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Input
        aria-label="Proposal summary"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />
      <Button
        variant="outline"
        aria-pressed={showSummary}
        onClick={() => setShowSummary(!showSummary)}
      >
        Show summary
      </Button>
    </section>
  );
}
