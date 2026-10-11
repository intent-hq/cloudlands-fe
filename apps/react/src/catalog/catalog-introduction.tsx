// Port of CatalogIntroduction.svelte; original developer catalog content.
import { catalogEntries } from './catalog';
import { catalogShowcaseEntries, catalogSystemEntries } from './catalog-navigation';
import { CatalogLink } from './catalog-link';
import './catalog-introduction.css';

export function CatalogIntroduction() {
  return (
    <article className="introduction" data-testid="catalog-introduction">
      <header>
        <p className="eyebrow">Showcase</p>
        <h1>Intent design system</h1>
        <p>
          Components, patterns, and interaction rules for building focused interfaces with a shared
          visual language.
        </p>
      </header>
      <section>
        <h2>Start exploring</h2>
        <div className="link-grid">
          {catalogSystemEntries.map((entry) => (
            <CatalogLink key={entry.slug} href={entry.href}>
              <strong>{entry.name}</strong>
              <span>System guidance and live specimens.</span>
            </CatalogLink>
          ))}
        </div>
      </section>
      <section>
        <h2>Showcase</h2>
        <div className="link-list">
          {catalogShowcaseEntries.slice(1).map((entry) => (
            <CatalogLink key={entry.slug} href={entry.href}>
              {entry.name}
              <span aria-hidden="true">→</span>
            </CatalogLink>
          ))}
        </div>
      </section>
      <section>
        <h2>{catalogEntries.length} components</h2>
        <div className="component-cloud">
          {catalogEntries.map((entry) => (
            <CatalogLink key={entry.slug} href={`/sandbox/${entry.slug}`}>
              {entry.name}
            </CatalogLink>
          ))}
        </div>
      </section>
    </article>
  );
}
