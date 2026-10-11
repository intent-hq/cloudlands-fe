// Port of CatalogScene.svelte's named-state path. Unported/unknown states fail explicitly.
import { useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { m } from '$shared/paraglide/messages.js';
import { waitForCaptureStability } from '../../../../src/lib/component-catalog/capture-stability';
import { CatalogLink } from './catalog-link';
import { getPreview, setActivePreview } from './preview-discovery';
import './catalog-scene.css';

export function CatalogScene({
  slug,
  requestedState,
  requestedWidth,
  requestedFit,
}: {
  slug: string;
  requestedState?: string;
  requestedWidth?: number;
  requestedFit?: 'component';
}) {
  const location = useLocation();
  const root = useRef<HTMLElement>(null);
  const [stability, setStability] = useState<{
    key: string;
    error?: string;
    reduced: boolean;
    generation: number;
  } | null>(null);
  const preview = getPreview(slug);
  const stateName = requestedState ?? preview?.defaultState ?? '';
  const width = requestedWidth ?? 720;
  const states = Object.entries(preview?.states ?? {});
  const scenes = stateName === 'all' ? states : states.filter(([name]) => name === stateName);
  const error = !preview
    ? `No executable preview is available for “${slug}”.`
    : !scenes.length
      ? `Unknown state “${stateName}”.`
      : undefined;
  const key = `${slug}:${stateName}:${width}:${location.searchStr}`;
  const ready = !error && stability?.key === key && !stability.error;
  const status = error ? 'error' : ready ? 'ready' : 'loading';
  const stableError = stability?.key === key ? stability.error : undefined;
  const generation = useRef(0);

  useLayoutEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    setActivePreview(null);
    if (!error && root.current) {
      void waitForCaptureStability(root.current, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setStability({ key, generation: generation.current, reduced: result.reducedMotion });
          setActivePreview({
            slug,
            state: stateName,
            width,
            status: 'ready',
            ...(requestedFit ? { fit: requestedFit } : {}),
          });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setStability({
              key,
              generation: generation.current,
              reduced: false,
              error: `Preview capture preparation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            });
        });
    }
    return () => {
      controller.abort();
      setActivePreview(null);
    };
  }, [key, slug, stateName, width, error, requestedFit]);

  function previewUrl(nextState: string, nextWidth = width) {
    const params = new URLSearchParams(location.searchStr);
    params.set('state', nextState);
    params.set('width', String(nextWidth));
    return `${location.pathname}?${params}`;
  }
  return (
    <section
      ref={root}
      className={`catalog-scene mx-auto grid max-w-full gap-4 p-4 sm:p-6 lg:p-10${requestedFit === 'component' ? ' component-fit' : ''}`}
      data-testid="catalog-scene"
      data-preview-slug={slug}
      data-preview-state={stateName}
      data-preview-width={width}
      data-preview-status={status}
      data-preview-ready={String(ready)}
      data-preview-stability={error || stableError ? 'error' : ready ? 'stable' : 'waiting'}
      data-preview-stable={String(ready)}
      data-preview-capture-motion={stability?.reduced ? 'reduced' : 'full'}
      data-preview-generation={stability?.key === key ? stability.generation : 0}
      data-preview-stability-generation={ready ? 1 : 0}
      data-preview-fit={requestedFit}
    >
      {requestedFit !== 'component' && (
        <header className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Named preview</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">{preview?.title ?? slug}</h1>
          {states.length > 0 && (
            <>
              <nav className="mt-3 flex flex-wrap gap-2" aria-label="Preview states">
                <CatalogLink
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-primary-ink hover:bg-muted"
                  aria-current={stateName === 'all' ? 'page' : undefined}
                  href={previewUrl('all')}
                >
                  {m.sandbox_catalogScene_allStates_label()}
                </CatalogLink>
                {states.map(([name]) => (
                  <CatalogLink
                    key={name}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium text-primary-ink hover:bg-muted"
                    aria-current={stateName === name ? 'page' : undefined}
                    href={previewUrl(name)}
                  >
                    {name}
                  </CatalogLink>
                ))}
              </nav>
              <nav className="mt-2 flex flex-wrap gap-2" aria-label="Preview widths">
                {[320, 420, 960].map((preset) => (
                  <CatalogLink
                    key={preset}
                    className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    aria-current={preset === width ? 'page' : undefined}
                    href={previewUrl(stateName, preset)}
                  >
                    {preset}px
                  </CatalogLink>
                ))}
              </nav>
            </>
          )}
        </header>
      )}
      {error || stableError ? (
        <div className="rounded-lg border border-danger bg-card p-4" role="alert">
          <p className="font-medium">{error ?? stableError}</p>
          {states.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Available states: {states.map(([name]) => name).join(', ')}
            </p>
          )}
        </div>
      ) : (
        preview && (
          <div
            className="preview-scene-list grid gap-8"
            data-preview-scene-list={stateName === 'all' ? 'all' : undefined}
          >
            {scenes.map(([name, props]) => (
              <article
                key={name}
                className="preview-article grid gap-3"
                data-preview-rendered-state={name}
              >
                {stateName === 'all' && requestedFit !== 'component' && (
                  <h2 className="text-lg font-medium">
                    {m.sandbox_catalogScene_stateHeading_title({ state: name })}
                  </h2>
                )}
                <div className="preview-frame max-w-full overflow-auto rounded-lg border border-border bg-background p-6">
                  <div
                    className="preview-focus mx-auto max-w-full p-6"
                    style={{ width: `${width}px` }}
                    data-testid="catalog-scene-focus"
                  >
                    {props}
                    <div data-catalog-portal-target="scene" />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )
      )}
    </section>
  );
}
