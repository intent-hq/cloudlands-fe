// Toast-specific branch of CatalogFixtureList.svelte, used by sandbox/toast/+page.svelte.
// i18n-ignore (reference catalog chrome)
import { toastMetadata } from '@/components/ui/toast';
import type { CatalogEntry } from './catalog';
import { getReactCatalogReference } from './catalog-react-reference';
import { ToastCatalogPreview } from './toast-catalog-preview';
import './toast-catalog-page.css';

export function ToastCatalogPage({ entry }: { entry: CatalogEntry }) {
  const reference = getReactCatalogReference(entry);
  return (
    <section className="toast-catalog-page catalog-detail w-full min-w-0 p-4 sm:p-6 lg:p-10">
      <header className="entry-header">
        <div className="min-w-0">
          <h1>{entry.name}</h1>
          <p className="entry-purpose">{entry.description}</p>
        </div>
        <details className="entry-inspector text-xs text-muted-foreground">
          <summary>Source</summary>
          <div className="inspector-popover">
            <p className="text-foreground">Canonical source</p>
            <code className="mt-1 block break-all">{entry.source}</code>
            <dl className="inspector-grid">
              <div>
                <dt>Category</dt>
                <dd className="mt-1 text-foreground">{entry.category}</dd>
              </div>
              <div>
                <dt>Removal gate</dt>
                <dd className="mt-1 text-foreground">{toastMetadata.removalGate}</dd>
              </div>
            </dl>
            <details>
              <summary>React usage</summary>
              <pre>{reference.usage}</pre>
              {reference.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </details>
          </div>
        </details>
      </header>
      <div className="fixture-grid">
        {entry.fixtures.map((fixture) => (
          <article key={fixture.id} className="fixture-card" data-catalog-fixture={fixture.id}>
            <div className="fixture-heading">
              <h2>{fixture.title}</h2>
            </div>
            <div
              className="fixture-preview min-h-20 rounded-md bg-background"
              data-catalog-preview="toast"
              data-catalog-fixture-id={fixture.id}
            >
              <ToastCatalogPreview fixture={fixture} />
            </div>
            <details className="fixture-inspector text-xs text-muted-foreground">
              <summary>Fixture details</summary>
              <dl className="inspector-grid">
                <div>
                  <dt>Viewport</dt>
                  <dd className="mt-1 text-foreground">{fixture.viewport ?? 'responsive'}</dd>
                </div>
                <div>
                  <dt>States</dt>
                  <dd className="mt-1 text-foreground">{fixture.states.join(', ')}</dd>
                </div>
                <div>
                  <dt>Themes</dt>
                  <dd className="mt-1 text-foreground">
                    {fixture.themes?.join(', ') ?? 'inherit'}
                  </dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
