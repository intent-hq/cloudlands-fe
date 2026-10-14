// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import type { PanelLayoutNode } from '../../../../src/store/renderer/slices/panel-layout/panel-layout-types';
import { ContentSkeleton } from '@/components/workspace/content-skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const nestedLayout: PanelLayoutNode = {
  type: 'split',
  direction: 'horizontal',
  sizes: [40, 60],
  children: [
    { type: 'panel', panelId: 'left' },
    {
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [
        { type: 'panel', panelId: 'top' },
        { type: 'panel', panelId: 'bottom' },
      ],
    },
  ],
};

export function ContentSkeletonExamples() {
  const [count, setCount] = useState('1');
  const [layout, setLayout] = useState<PanelLayoutNode>();
  const [visible, setVisible] = useState(true);
  return (
    <section className="grid min-w-0 w-full max-w-3xl gap-4" data-testid="content-skeleton-demo">
      <header>
        <h2>Workspace content loading</h2>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Input
        aria-label="Loading panel count"
        value={count}
        onChange={(event) => setCount(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setLayout(undefined)}>
          Use panel count
        </Button>
        <Button variant="outline" onClick={() => setLayout(nestedLayout)}>
          Nested layout
        </Button>
        <Button variant="outline" onClick={() => setLayout({ type: 'panel', panelId: 'single' })}>
          Single panel
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            setLayout({ type: 'split', direction: 'horizontal', children: [], sizes: [] })
          }
        >
          Empty layout
        </Button>
        <Button variant="outline" aria-pressed={visible} onClick={() => setVisible(!visible)}>
          Show loading
        </Button>
      </div>
      <Button variant="outline">Before loading</Button>
      <div className="h-80 min-w-0" data-testid="content-skeleton-frame">
        {visible && <ContentSkeleton panelCount={Number(count)} layoutRoot={layout} />}
      </div>
      <Button variant="outline">After loading</Button>
    </section>
  );
}
