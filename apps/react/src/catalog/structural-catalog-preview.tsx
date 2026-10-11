// Source branches: BasicCatalogPreview, ChoiceGroupCatalogPreview, ContentFieldCatalogPreview,
// NavigationPrimitivesCatalogPreview, NavigationHelpCatalogPreview (all .svelte).
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { FolderOpenIcon } from '@phosphor-icons/react';
import * as Accordion from '@/components/ui/accordion';
import * as Breadcrumb from '@/components/ui/breadcrumb';
import * as Card from '@/components/ui/card';
import * as Table from '@/components/ui/table';
import * as RadioGroup from '@/components/ui/radio-group';
import * as CheckboxGroup from '@/components/ui/checkbox-group';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

const longText =
  'A deliberately long piece of editorial content that remains readable without overflowing a compact catalog viewport.';
function CardPreview() {
  return (
    <div className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4">
      <div data-catalog-rendered-state="group fluid-hover">
        <Card.Group columns={2}>
          {['Projects', 'Notes', 'Files', 'Activity'].map((title) => (
            <Card.Root key={title} media={<FolderOpenIcon className="size-5" />}>
              <Card.Header>
                <Card.Title>{title}</Card.Title>
                <Card.Description>
                  Keep related work together, with room for the details that matter.
                </Card.Description>
              </Card.Header>
            </Card.Root>
          ))}
        </Card.Group>
      </div>
      <div data-catalog-rendered-state="inline outlined">
        <Card.Group orientation="inline" border="outlined">
          {['Recent work', 'Shared resources'].map((title) => (
            <Card.Root key={title} media={<FolderOpenIcon className="size-5" />}>
              <Card.Header>
                <Card.Title>{title}</Card.Title>
                <Card.Description>A compact row for a focused collection.</Card.Description>
              </Card.Header>
            </Card.Root>
          ))}
        </Card.Group>
      </div>
      <div data-catalog-rendered-state="separated selected">
        <Card.Group columns={2} border="outlined" separated>
          <Card.Root selected>
            <Card.Header>
              <Card.Title>Current project</Card.Title>
              <Card.Description>Your selected workspace stays visible.</Card.Description>
            </Card.Header>
          </Card.Root>
          <Card.Root>
            <Card.Header>
              <Card.Title>Next project</Card.Title>
              <Card.Description>Pick up another thread when ready.</Card.Description>
            </Card.Header>
          </Card.Root>
        </Card.Group>
      </div>
      <div data-catalog-rendered-state="default header light dark compact zoom-200 reduced-motion">
        <Card.Root aria-label="Catalog editorial card">
          <Card.Header>
            <Card.Title>Workspace summary</Card.Title>
          </Card.Header>
          <Card.Content>Canonical raised content surface.</Card.Content>
        </Card.Root>
      </div>
      <div data-catalog-rendered-state="long-content">
        <Card.Root>
          <Card.Content>{longText}</Card.Content>
        </Card.Root>
      </div>
      <div data-catalog-rendered-state="flush-content">
        <Card.Root>
          <Card.Content flush>
            <div className={Card.CARD_CONTENT_INSET_CLASS}>
              Flush nested content keeps the card inset.
            </div>
          </Card.Content>
        </Card.Root>
      </div>
      <div data-catalog-rendered-state="empty inert">
        <Card.Root aria-label="Empty inert card" inert>
          <Card.Content />
        </Card.Root>
      </div>
      <div data-catalog-rendered-state="interactive pressed">
        <Card.Root interactive data-state="pressed">
          <Card.Content>Pressed interactive surface</Card.Content>
        </Card.Root>
      </div>
    </div>
  );
}
function ChoiceGroupPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [radio, setRadio] = useState('standard');
  const [checkbox, setCheckbox] = useState(['alerts', 'summaries']);
  const oneLineRadio = fixture.id === 'radio-group-one-line-row';
  const oneLineCheckbox = fixture.id === 'checkbox-group-selected-row';
  return (
    <div className="min-w-72" data-catalog-rendered-state={fixture.states.join(' ')}>
      {componentId === 'radio-group' ? (
        <RadioGroup.Root
          value={radio}
          onValueChange={setRadio}
          aria-label={oneLineRadio ? 'One-line delivery speed' : 'Delivery speed'}
        >
          <RadioGroup.Item
            value="standard"
            title="Standard"
            description={oneLineRadio ? undefined : 'Balanced delivery'}
          />
          <RadioGroup.Item
            value="fast"
            title="Fast"
            description={oneLineRadio ? undefined : 'Prioritize this delivery'}
          />
          <RadioGroup.Item
            value="later"
            title="Later"
            description={oneLineRadio ? undefined : 'Schedule for later'}
          />
        </RadioGroup.Root>
      ) : (
        <CheckboxGroup.Root
          value={checkbox}
          onValueChange={setCheckbox}
          aria-label={oneLineCheckbox ? 'One-line notifications' : 'Notifications'}
        >
          <CheckboxGroup.Item
            value="alerts"
            title="Alerts"
            description={oneLineCheckbox ? undefined : 'Important changes'}
          />
          <CheckboxGroup.Item
            value="summaries"
            title="Summaries"
            description={oneLineCheckbox ? undefined : 'Periodic updates'}
          />
          <CheckboxGroup.Item
            value="tips"
            title="Tips"
            description={oneLineCheckbox ? undefined : 'Product guidance'}
          />
        </CheckboxGroup.Root>
      )}
    </div>
  );
}
export function StructuralCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [section, setSection] = useState('details');
  return (
    <div data-catalog-renderer-fixture={fixture.id}>
      {componentId === 'card' && <CardPreview />}
      {['radio-group', 'checkbox-group'].includes(componentId) && (
        <ChoiceGroupPreview componentId={componentId} fixture={fixture} />
      )}
      {componentId === 'accordion' && (
        <div data-catalog-rendered-state="single multiple open closed disabled keyboard-navigation reduced-motion">
          <Accordion.Root value={section} onValueChange={setSection}>
            <Accordion.Item value="details">
              <Accordion.Header>
                <Accordion.Trigger>Details</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className={section === 'details' ? undefined : 'hidden'}>
                Accordion details
              </Accordion.Content>
            </Accordion.Item>
            <Accordion.Item value="history">
              <Accordion.Header>
                <Accordion.Trigger>History</Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className={section === 'history' ? undefined : 'hidden'}>
                Accordion history
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        </div>
      )}
      {componentId === 'button-group' && (
        <div
          className="grid gap-4"
          data-catalog-rendered-state="horizontal vertical active keyboard-focus disabled compact dark"
        >
          <div className="grid gap-1">
            <p className="type-caption text-muted-foreground">One-shot actions</p>
            <ButtonGroup aria-label="Document actions">
              <Button variant="outline">Copy</Button>
              <Button variant="outline">Duplicate</Button>
              <Button variant="outline" disabled>
                Delete
              </Button>
            </ButtonGroup>
          </div>
          <div className="grid gap-1">
            <p className="type-caption text-muted-foreground">
              Transient active state — Share menu open
            </p>
            <ButtonGroup aria-label="Document actions with share menu open">
              <Button variant="outline">Copy</Button>
              <Button variant="outline" active aria-expanded>
                Share
              </Button>
              <Button variant="outline" disabled>
                Delete
              </Button>
            </ButtonGroup>
          </div>
        </div>
      )}
      {componentId === 'breadcrumb' && (
        <div className="grid w-full min-w-0 grid-cols-1 gap-4 overflow-hidden">
          <div
            className="w-full min-w-0 overflow-hidden"
            data-catalog-rendered-state="navigation current-page ellipsis long-content keyboard-focus overlay-hover compact zoom-200 no-overflow light dark reduced-motion"
          >
            <Breadcrumb.Root aria-label="Catalog path">
              <Breadcrumb.List>
                <Breadcrumb.Item>
                  <Breadcrumb.Link href="/sandbox">Catalog</Breadcrumb.Link>
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
                <Breadcrumb.Item>
                  <Breadcrumb.Ellipsis />
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
                <Breadcrumb.Item>
                  <Breadcrumb.Link href="/sandbox/navigation">
                    Navigation primitives
                  </Breadcrumb.Link>
                </Breadcrumb.Item>
                <Breadcrumb.Separator />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>
                    A deliberately long current page label for compact layouts
                  </Breadcrumb.Page>
                </Breadcrumb.Item>
              </Breadcrumb.List>
            </Breadcrumb.Root>
          </div>
        </div>
      )}
      {componentId === 'table' && (
        <div className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden">
          <div data-catalog-rendered-state="default hover selected compact zoom-200 light dark reduced-motion">
            <Table.Root aria-label="Workspace usage">
              <Table.Header>
                <Table.Row>
                  <Table.Head>Workspace</Table.Head>
                  <Table.Head>Tokens</Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>Alpha</Table.Cell>
                  <Table.Cell>42</Table.Cell>
                </Table.Row>
                <Table.Row data-state="selected">
                  <Table.Cell>Beta</Table.Cell>
                  <Table.Cell>84</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </div>
          <div data-catalog-rendered-state="long-content">
            <Table.Root>
              <Table.Body>
                <Table.Row>
                  <Table.Cell>{longText}</Table.Cell>
                </Table.Row>
              </Table.Body>
            </Table.Root>
          </div>
        </div>
      )}
    </div>
  );
}
