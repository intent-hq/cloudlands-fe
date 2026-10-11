// Port of CatalogComponentPage.svelte for the renderer families implemented here.
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { commonProps, type CatalogEntry } from './catalog';
import { getCatalogComponentName } from './catalog-export';
import { BasicCatalogPreview } from './basic-catalog-preview';
import { ContentCatalogPreview } from './content-catalog-preview';
import { NavigationCatalogPreview } from './navigation-catalog-preview';
import { PatternCatalogPreview } from './pattern-catalog-preview';
import { DialogCatalogPreview } from './dialog-catalog-preview';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import './catalog-component-page.css';

export const portedComponentPages = [
  'button',
  'badge',
  'checkbox',
  'switch',
  'toggle',
  'toggle-group',
  'input',
  'textarea',
  'label',
  'separator',
  'skeleton',
  'input-message',
  'tabs',
  'dialog',
  'screen',
  'form',
] as const;
export function hasComponentPage(slug: string) {
  return portedComponentPages.some((value) => value === slug);
}

function Fixture({ entry, fixture }: { entry: CatalogEntry; fixture: UiComponentFixture }) {
  const props = { componentId: entry.slug, fixture };
  return (
    <div
      className="fixture-preview"
      data-catalog-preview={entry.slug}
      data-catalog-fixture-id={fixture.id}
    >
      {['button', 'badge', 'checkbox', 'switch', 'toggle', 'toggle-group'].includes(entry.slug) ? (
        <BasicCatalogPreview {...props} />
      ) : ['screen', 'form'].includes(entry.slug) ? (
        <PatternCatalogPreview {...props} />
      ) : entry.slug === 'tabs' ? (
        <NavigationCatalogPreview {...props} />
      ) : entry.slug === 'dialog' ? (
        <DialogCatalogPreview {...props} />
      ) : (
        <ContentCatalogPreview {...props} />
      )}
    </div>
  );
}

export function CatalogComponentPage({ entry }: { entry: CatalogEntry }) {
  const [tab, setTab] = useState('preview');
  const componentName = getCatalogComponentName(entry);
  const installCommand = entry.publicImport
    ? `import { ${componentName} } from '${entry.publicImport.replace('$lib/components', '@/components')}';`
    : entry.source;
  // Only show source snippets that are already valid JSX. Do not teach Svelte syntax in React.
  const usage = entry.usage?.includes('<script') ? undefined : entry.usage;
  return (
    <article className="component-page" data-testid="catalog-component-page">
      <header className="page-header">
        <h1>{entry.name}</h1>
        <p>{entry.description}</p>
      </header>
      <section aria-labelledby="installation-title">
        <h2 id="installation-title">Installation</h2>
        <code className="install-command">{installCommand}</code>
      </section>
      <section aria-labelledby="playground-title">
        <h2 id="playground-title">Playground</h2>
        <Tabs value={tab} onValueChange={setTab} className="playground">
          <TabsList className="playground-tabs">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="code">{usage ? 'Usage' : 'Import'}</TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            {entry.fixtures[0] && <Fixture entry={entry} fixture={entry.fixtures[0]} />}
          </TabsContent>
          <TabsContent value="code">
            <pre>
              <code>{usage ?? installCommand}</code>
            </pre>
          </TabsContent>
        </Tabs>
      </section>
      {entry.fixtures.slice(1).map((fixture) => (
        <section key={fixture.id} data-catalog-fixture={fixture.id}>
          <h2>{fixture.title}</h2>
          <p className="section-description">
            Explore {fixture.states.join(', ')} states across {fixture.viewport ?? 'responsive'}{' '}
            layouts.
          </p>
          <div className="section-preview">
            <Fixture entry={entry} fixture={fixture} />
          </div>
        </section>
      ))}
      <section aria-labelledby="api-title">
        <h2 id="api-title">API</h2>
        {entry.props === commonProps && (
          <p className="section-description">
            Reference incomplete: only shared props are documented
          </p>
        )}
        <div className="table-scroll">
          <table aria-label={`${entry.name} API reference`}>
            <thead>
              <tr>
                <th>Prop</th>
                <th>Type</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {(entry.props ?? []).map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name === 'class' ? 'className' : prop.name}</code>
                  </td>
                  <td>
                    <code>{prop.type === 'Snippet' ? 'ReactNode' : prop.type}</code>
                  </td>
                  <td>
                    <code>{prop.defaultValue}</code>
                  </td>
                  <td>{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
