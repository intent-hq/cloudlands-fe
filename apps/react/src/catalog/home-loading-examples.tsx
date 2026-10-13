// i18n-ignore (internal unreleased component preview controls)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HomeLoading } from '@/features/home/components/home-loading';

export function HomeLoadingExamples() {
  const [detail, setDetail] = useState(false);
  const [shown, setShown] = useState(true);
  return (
    <section className="grid w-full max-w-lg gap-4" data-testid="home-loading-demo">
      <header>
        <h1>Home loading</h1>
        <p className="type-caption text-muted-foreground">Internal React preview · unreleased</p>
      </header>
      <Button variant="outline" aria-pressed={detail} onClick={() => setDetail(!detail)}>
        Detail layout
      </Button>
      <div className="flex min-h-72" data-testid="home-loading-frame">
        {shown && <HomeLoading detail={detail} />}
      </div>
      <Button variant="outline" aria-pressed={shown} onClick={() => setShown(!shown)}>
        Show loading
      </Button>
    </section>
  );
}
