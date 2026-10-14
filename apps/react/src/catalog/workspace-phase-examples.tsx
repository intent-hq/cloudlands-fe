// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkspacePhaseIndicator } from '@/components/workspace/workspace-phase-indicator';
import type { WorkspacePhase } from '$lib/components/workspace/workspace-phase';

const phases: WorkspacePhase[] = ['planning', 'building', 'reviewing', 'shipped'];

export function WorkspacePhaseExamples() {
  const [phase, setPhase] = useState<WorkspacePhase>('planning');
  const [progress, setProgress] = useState(0.65);
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<WorkspacePhase[]>([]);
  return (
    <section className="grid min-w-0 w-full max-w-lg gap-4" data-testid="workspace-phase-demo">
      <header>
        <h2>Workspace phases</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Build progress"
        type="number"
        step="0.05"
        value={progress}
        onChange={(event) => setProgress(Number(event.target.value))}
      />
      <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
        Show phase
      </Button>
      <div className="flex flex-wrap gap-2" data-testid="workspace-phase-gallery">
        {phases.map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={phase === value}
            onClick={() => setPhase(value)}
          >
            <WorkspacePhaseIndicator phase={value} progress={progress} />
            {value}
          </Button>
        ))}
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, phase])}>
        Before phase
      </Button>
      <div
        className="flex min-w-0 items-center gap-3 bg-card p-3"
        data-testid="workspace-phase-selected"
      >
        {visible && <WorkspacePhaseIndicator phase={phase} progress={progress} />}
        <span>{phase}</span>
      </div>
      <Button variant="outline" onClick={() => setEvents((previous) => [...previous, phase])}>
        Open phase
      </Button>
      <output aria-label="Phase callbacks" className="min-w-0 break-words">
        {JSON.stringify(events)}
      </output>
    </section>
  );
}
