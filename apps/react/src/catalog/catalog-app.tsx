import { useLocation } from '@tanstack/react-router';
import { CatalogShell } from './catalog-shell';
import { CatalogIntroduction } from './catalog-introduction';
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
  return (
    <CatalogShell>
      {!slug ? (
        <CatalogIntroduction />
      ) : systemSlug ? (
        <CatalogSystemPage key={slug} slug={systemSlug} />
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
