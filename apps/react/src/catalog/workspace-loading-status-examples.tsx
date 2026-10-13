// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { HomePullState } from '@/features/home/components/home-pull-state';
import { SidebarSkeleton } from '@/components/workspace/sidebar-skeleton';

const pullStates = ['open', 'merged', 'closed', 'draft', 'queued'];

export function HomePullStateExamples() {
  const [index, setIndex] = useState(0);
  const [compact, setCompact] = useState(false);
  const [shown, setShown] = useState(true);
  return (
    <section className="grid w-full max-w-lg gap-4" data-testid="home-pull-state-demo">
      <header>
        <h1>Pull request status</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setIndex((index + 1) % pullStates.length)}>
          Next status
        </Button>
        <Button variant="outline" aria-pressed={compact} onClick={() => setCompact(!compact)}>
          Compact
        </Button>
        <Button variant="outline" aria-pressed={shown} onClick={() => setShown(!shown)}>
          Show status
        </Button>
      </div>
      <div className="min-h-20" data-testid="home-pull-state-frame">
        {shown && <HomePullState state={pullStates[index]} compact={compact} />}
      </div>
    </section>
  );
}

export function SidebarSkeletonExamples() {
  const [shown, setShown] = useState(true);
  return (
    <section className="grid w-full max-w-sm gap-4" data-testid="sidebar-skeleton-demo">
      <header>
        <h1>Workspace loading</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Button variant="outline" aria-pressed={shown} onClick={() => setShown(!shown)}>
        Show loading
      </Button>
      <div className="h-[28rem]" data-testid="sidebar-skeleton-frame">
        {shown && <SidebarSkeleton />}
      </div>
      <Link to="/sandbox" className={buttonVariants({ variant: 'ghost' })}>
        Component sandbox
      </Link>
    </section>
  );
}
