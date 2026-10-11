import { ToastCatalogPage } from './toast-catalog-page';
import { useLocation } from '@tanstack/react-router';
import { FunctionalExamples, hasFunctionalExample } from './functional-examples';
import { CatalogShell } from './catalog-shell';
import { CatalogIntroduction } from './catalog-introduction';
import { RecipesPage } from './recipes-page';
import { CatalogSystemPage } from './catalog-system-page';
import { CatalogScene } from './catalog-scene';
import { CatalogComponentPage, hasComponentPage } from './catalog-component-page';
import { getCatalogEntry } from './catalog';
import { getCatalogSystemSlug } from './catalog-navigation';
import { parseCatalogUrlSettings } from './catalog-preferences';

export function CatalogApp() {
  const location = useLocation();
  const slug = decodeURIComponent(
    location.pathname.replace(/^\/sandbox\/?/, '').replace(/\/$/, ''),
  );
  const settings = parseCatalogUrlSettings(new URLSearchParams(location.searchStr));
  const systemSlug = getCatalogSystemSlug(slug);
  const entry = getCatalogEntry(slug);
  const interactive =
    new URLSearchParams(location.searchStr).get('example') === 'interactive' &&
    hasFunctionalExample(slug);
  return (
    <CatalogShell>
      {interactive ? (
        <FunctionalExamples key={slug} slug={slug} />
      ) : !slug ? (
        <CatalogIntroduction />
      ) : slug === 'recipes' ? (
        <RecipesPage />
      ) : systemSlug ? (
        <CatalogSystemPage key={slug} slug={systemSlug} />
      ) : !settings.state && entry?.slug === 'toast' ? (
        <ToastCatalogPage entry={entry} />
      ) : !settings.state && entry && hasComponentPage(entry.slug) ? (
        <CatalogComponentPage key={entry.slug} entry={entry} />
      ) : (
        <CatalogScene
          key={slug}
          slug={slug}
          requestedState={settings.state}
          requestedWidth={settings.width}
          requestedFit={settings.fit}
        />
      )}
    </CatalogShell>
  );
}
