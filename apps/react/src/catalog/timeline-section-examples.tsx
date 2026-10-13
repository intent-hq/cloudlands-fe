// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TimelineSection } from '@/components/workspace/sidebar/timeline-section';

export function TimelineSectionExamples() {
  const [expanded, setExpanded] = useState(true);
  const [locked, setLocked] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  return (
    <section className="grid w-full max-w-lg gap-4" data-testid="timeline-section-demo">
      <header>
        <h1>Timeline section</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div data-testid="timeline-section-frame">
        <TimelineSection title="Plan" subtitle="Ready">
          <p className="type-caption text-muted-foreground">Review the workspace changes.</p>
        </TimelineSection>
        <TimelineSection
          title="Review"
          subtitle={reviewed ? 'Complete' : 'In progress'}
          active={!reviewed}
          collapsible
          expanded={expanded}
          onToggle={() => {
            if (!locked) setExpanded(!expanded);
          }}
          action={
            <Button
              variant="ghost"
              size="compact"
              aria-pressed={reviewed}
              onClick={() => setReviewed(!reviewed)}
            >
              Mark reviewed
            </Button>
          }
        >
          <Input aria-label="Review draft" placeholder="Draft a review note" />
        </TimelineSection>
      </div>
      <Button variant="outline" aria-pressed={locked} onClick={() => setLocked(!locked)}>
        Lock expansion
      </Button>
    </section>
  );
}
