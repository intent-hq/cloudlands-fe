// Port of CatalogComponentPage.svelte for the renderer families implemented here.
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { CatalogEntry } from './catalog';
import { getCatalogComponentName } from './catalog-export';
import { getReactCatalogReference } from './catalog-react-reference';
import { BasicCatalogPreview } from './basic-catalog-preview';
import { ContentCatalogPreview } from './content-catalog-preview';
import { NavigationCatalogPreview } from './navigation-catalog-preview';
import { PatternCatalogPreview } from './pattern-catalog-preview';
import { AvatarCatalogPreview } from './avatar-catalog-preview';
import { IndicatorCatalogPreview } from './indicator-catalog-preview';
import { ProximityCatalogPreview } from './proximity-catalog-preview';
import { DropdownCatalogPreview } from './dropdown-catalog-preview';
import { SheetCatalogPreview } from './sheet-catalog-preview';
import { SettingsCatalogPreview } from './settings-catalog-preview';
import { FieldCatalogPreview } from './field-catalog-preview';
import { NavigationHelpCatalogPreview } from './navigation-help-catalog-preview';
import { StructuralCatalogPreview } from './structural-catalog-preview';
import { MenuCatalogPreview } from './menu-catalog-preview';
import { SelectCatalogPreview } from './select-catalog-preview';
import { CatalogLink } from './catalog-link';
import { DialogCatalogPreview } from './dialog-catalog-preview';
import { QuestionsCatalogPreview } from './questions-catalog-preview';
import { ComposerCatalogPreview } from './composer-catalog-preview';
import { PickerCatalogPreview } from './picker-catalog-preview';
import { ListCatalogPreview, SidebarCatalogPreview } from './sidebar-catalog-preview';
import { AdditionalCatalogPreview } from './additional-catalog-previews';
import { additionalCatalogEntries } from './additional-catalog-entries';
import { hasFunctionalExample } from './functional-examples';
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
  'select',
  'menu',
  'collection',
  'action-menu',
  'confirm',
  'accordion',
  'card',
  'breadcrumb',
  'table',
  'button-group',
  'radio-group',
  'checkbox-group',
  'kbd',
  'scroll-area',
  'tooltip',
  'copy-input',
  'input-group',
  'sheet',
  'slider',
  'file-input',
  'settings-field-row',
  'settings-section',
  'settings-page-shell',
  'proximity-highlight',
  'dropdown',
  'settings',
  'principal-avatar',
  'loading-indicator',
  'ask-user-questions',
  'message-composer',
  'combobox',
  'searchable-select',
  'grouped-combobox',
  'sidebar',
  'list',
  ...additionalCatalogEntries.map((entry) => entry.slug),
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
      {entry.slug === 'ask-user-questions' ? (
        <QuestionsCatalogPreview fixture={fixture} />
      ) : entry.slug === 'message-composer' ? (
        <ComposerCatalogPreview fixture={fixture} />
      ) : ['combobox', 'searchable-select', 'grouped-combobox'].includes(entry.slug) ? (
        <PickerCatalogPreview {...props} />
      ) : entry.slug === 'sidebar' ? (
        <SidebarCatalogPreview fixture={fixture} />
      ) : entry.slug === 'list' ? (
        <ListCatalogPreview fixture={fixture} />
      ) : additionalCatalogEntries.some((entry) => entry.slug === props.componentId) ? (
        <AdditionalCatalogPreview {...props} />
      ) : entry.slug === 'principal-avatar' ? (
        <AvatarCatalogPreview fixture={fixture} />
      ) : entry.slug === 'loading-indicator' ? (
        <IndicatorCatalogPreview fixture={fixture} />
      ) : entry.slug === 'proximity-highlight' ? (
        <ProximityCatalogPreview fixture={fixture} />
      ) : entry.slug === 'dropdown' ? (
        <DropdownCatalogPreview fixture={fixture} />
      ) : entry.slug === 'sheet' ? (
        <SheetCatalogPreview fixture={fixture} />
      ) : [
          'slider',
          'file-input',
          'settings-field-row',
          'settings-section',
          'settings-page-shell',
        ].includes(entry.slug) ? (
        <SettingsCatalogPreview {...props} />
      ) : ['copy-input', 'input-group'].includes(entry.slug) ? (
        <FieldCatalogPreview {...props} />
      ) : ['kbd', 'scroll-area', 'tooltip'].includes(entry.slug) ? (
        <NavigationHelpCatalogPreview {...props} />
      ) : [
          'accordion',
          'card',
          'breadcrumb',
          'table',
          'button-group',
          'radio-group',
          'checkbox-group',
        ].includes(entry.slug) ? (
        <StructuralCatalogPreview {...props} />
      ) : entry.slug === 'menu' ? (
        <MenuCatalogPreview fixture={fixture} />
      ) : entry.slug === 'select' ? (
        <SelectCatalogPreview fixture={fixture} />
      ) : ['button', 'badge', 'checkbox', 'switch', 'toggle', 'toggle-group'].includes(
          entry.slug,
        ) ? (
        <BasicCatalogPreview {...props} />
      ) : ['screen', 'form', 'collection', 'action-menu', 'confirm', 'settings'].includes(
          entry.slug,
        ) ? (
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
  const reference = getReactCatalogReference(entry);
  const installCommand = reference.importStatement;
  const usage = reference.usage;
  const pendingReference = `The React reference for ${componentName} is pending.`;
  return (
    <article className="component-page" data-testid="catalog-component-page">
      <header className="page-header">
        <h1>{entry.name}</h1>
        <p>{entry.description}</p>
      </header>
      <section aria-labelledby="installation-title">
        <h2 id="installation-title">Installation</h2>
        {reference.status === 'implemented' && installCommand ? (
          <code className="install-command">{installCommand}</code>
        ) : (
          <p className="section-description">{pendingReference}</p>
        )}
        {reference.notes.map((note) => (
          <p key={note} className="section-description">
            {note}
          </p>
        ))}
      </section>
      <section aria-labelledby="playground-title">
        <h2 id="playground-title">Playground</h2>
        <Tabs value={tab} onValueChange={setTab} className="playground">
          <TabsList className="playground-tabs">
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="code">
              {usage ? 'Usage' : installCommand ? 'Import' : 'Reference'}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preview">
            {entry.fixtures[0] && <Fixture entry={entry} fixture={entry.fixtures[0]} />}
          </TabsContent>
          <TabsContent value="code">
            <pre>
              <code>{usage ?? installCommand ?? pendingReference}</code>
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
      {hasFunctionalExample(entry.slug) && (
        <section>
          <h2>Interactive example</h2>
          <CatalogLink href={`/sandbox/${entry.slug}?example=interactive`}>
            Open interactive example
          </CatalogLink>
        </section>
      )}
      <section aria-labelledby="api-title">
        <h2 id="api-title">API</h2>
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
              {reference.props.map((prop) => (
                <tr key={prop.name}>
                  <td>
                    <code>{prop.name}</code>
                  </td>
                  <td>
                    <code>{prop.type}</code>
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
