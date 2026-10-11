// Port of renderers/BasicCatalogPreview.svelte. Original developer fixture data.
import { useId, useState } from 'react';
import { PlusIcon, TrashIcon, type Icon } from '@phosphor-icons/react';
import { Badge, badgeColors, type BadgeColor } from '@/components/ui/badge';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { buttonMetadata } from '$lib/components/ui/button/button.meta';
import { ArrowIcon } from './preview-discovery';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';

// The reference's Font Awesome aliases resolve to these Phosphor components.
function FixtureIcon({ icon: IconComponent }: { icon: Icon }) {
  return <IconComponent size="0.75em" weight="regular" aria-hidden="true" />;
}

export function BasicCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const uid = useId();
  const [checkboxChecked, setCheckboxChecked] = useState(false);
  const [switchChecked, setSwitchChecked] = useState(false);
  const [togglePressed, setTogglePressed] = useState(false);
  const [groupValue, setGroupValue] = useState('list');
  const [buttonClicks, setButtonClicks] = useState(0);
  const [buttonAction, setButtonAction] = useState('Choose an action');
  const [longButtonAction, setLongButtonAction] = useState('Choose the long-label action');
  function recordButtonAction(action: string) {
    setButtonClicks((value) => value + 1);
    setButtonAction(action);
  }
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-3"
      data-catalog-renderer-fixture={fixture.id}
    >
      {componentId === 'badge' ? (
        <>
          {fixture.id === 'semantic-states' ? (
            <div
              className="grid min-w-0 gap-4"
              data-catalog-rendered-state="neutral information success warning danger solid dot leading-icon removable keyboard-focus long-label light dark compact"
            >
              <p className="type-caption text-muted-foreground">
                Use a short text label to name the state; colour reinforces its meaning.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="gray">Neutral: Draft</Badge>
                <Badge color="blue">Information: In progress</Badge>
                <Badge color="green">Success: Complete</Badge>
                <Badge color="amber">Warning: Needs attention</Badge>
                <Badge color="red">Danger: Failed</Badge>
              </div>
              <section className="grid gap-2">
                <h3 className="type-caption font-medium">The same meanings with dots</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="dot" color="gray">
                    Draft
                  </Badge>
                  <Badge variant="dot" color="blue">
                    In progress
                  </Badge>
                  <Badge variant="dot" color="green">
                    Complete
                  </Badge>
                  <Badge variant="dot" color="amber">
                    Needs attention
                  </Badge>
                  <Badge variant="dot" color="red">
                    Failed
                  </Badge>
                </div>
              </section>
              <section className="grid gap-2">
                <h3 className="type-caption font-medium">Compact labels and optional actions</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="compact">Draft</Badge>
                  <Badge leadingIcon={<FixtureIcon icon={PlusIcon} />}>Draft</Badge>
                  <Badge removable removeLabel="Remove draft label" onRemove={() => undefined}>
                    Draft
                  </Badge>
                  <Badge variant="dot" href="#badge-preview">
                    View draft
                  </Badge>
                </div>
              </section>
              <Badge variant="dot" className="max-w-full truncate">
                A deliberately long badge label for truncation review
              </Badge>
            </div>
          ) : fixture.id === 'categorical-colours' ? (
            <section className="grid min-w-0 gap-2" data-catalog-rendered-state="colors">
              <p className="type-caption text-muted-foreground">
                Categorisation only: use these 17 colours to distinguish named categories, never to
                invent extra status meanings.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.keys(badgeColors).map((color) => (
                  <div key={color} className="flex flex-wrap gap-2">
                    <Badge color={color as BadgeColor}>{color}</Badge>
                    <Badge variant="dot" color={color as BadgeColor}>
                      {color}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <section
              className="grid gap-2"
              data-catalog-rendered-state="default secondary outline destructive success-ring-dot info-ring-dot"
            >
              <p className="type-caption text-muted-foreground">
                Existing callers remain supported. For new code, use solid or dot with an explicit
                status colour.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="success" dot>
                  Success
                </Badge>
                <Badge variant="info" dot>
                  Info
                </Badge>
              </div>
            </section>
          )}
        </>
      ) : componentId === 'button' ? (
        <>
          {fixture.id === 'interaction-states' ? (
            <div
              className="grid min-w-0 gap-4"
              data-catalog-rendered-state="emphasis-ladder size-ladder guidance primary secondary outline ghost destructive active focus disabled loading loading-variants icon-only icon-weight action-feedback"
            >
              <div className="grid gap-1">
                <p className="type-caption font-medium">Preferred emphasis ladder</p>
                <p className="type-caption text-muted-foreground">
                  Choose the lowest emphasis that communicates the action. Use one primary action
                  per region.
                </p>
                <ol
                  className="mt-1 flex flex-wrap items-center gap-2"
                  aria-label="Button emphasis ladder"
                >
                  <li>
                    <Button
                      variant="primary"
                      leadingIcon={<ArrowIcon className="size-4" />}
                      onClick={() => recordButtonAction('Primary action completed')}
                    >
                      1. Primary
                    </Button>
                  </li>
                  <li>
                    <Button
                      variant="secondary"
                      onClick={() => recordButtonAction('Secondary action completed')}
                    >
                      2. Secondary
                    </Button>
                  </li>
                  <li>
                    <Button
                      variant="ghost"
                      onClick={() => recordButtonAction('Ghost action completed')}
                    >
                      3. Ghost
                    </Button>
                  </li>
                  <li>
                    <Button
                      variant="destructive"
                      onClick={() => recordButtonAction('Delete requested')}
                    >
                      <FixtureIcon icon={TrashIcon} />
                      4. Destructive
                    </Button>
                  </li>
                </ol>
                <p className="type-caption text-muted-foreground">
                  Use outline when a neutral action needs a visible boundary without a filled
                  surface.
                </p>
              </div>
              <div className="grid gap-1">
                <p className="type-caption font-medium">Preferred size ladder</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm">Small</Button>
                  <Button>Medium</Button>
                  <Button size="lg">Large</Button>
                  <Button size="icon-sm" iconOnly aria-label="Small icon button">
                    <FixtureIcon icon={PlusIcon} />
                  </Button>
                  <Button size="icon" iconOnly aria-label="Medium icon button">
                    <FixtureIcon icon={PlusIcon} />
                  </Button>
                  <Button size="icon-lg" iconOnly aria-label="Large icon button">
                    <FixtureIcon icon={PlusIcon} />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" active>
                  Active
                </Button>
                <Button disabled>Disabled action</Button>
                <Button loading>Loading action</Button>
                <Button variant="outline" loading>
                  Outline loading
                </Button>
                <Button variant="ghost" loading>
                  Ghost loading
                </Button>
                <Button size="sm" loading>
                  Small loading
                </Button>
                <Button size="icon" iconOnly aria-label="Icon loading" loading>
                  <FixtureIcon icon={PlusIcon} />
                </Button>
                <Button
                  size="icon"
                  aria-label="Add item"
                  onClick={() => recordButtonAction('Item added')}
                >
                  <FixtureIcon icon={PlusIcon} />
                </Button>
              </div>
              <output
                className="type-caption min-w-full text-muted-foreground"
                aria-label="Button action status"
                aria-live="polite"
              >
                {buttonAction}
              </output>
              <output className="sr-only" aria-label="Button click count">
                {buttonClicks}
              </output>
            </div>
          ) : fixture.id === 'compatibility-aliases' ? (
            <div className="grid gap-2" data-catalog-rendered-state="default compact">
              <p className="type-caption text-muted-foreground">
                Migration reference only; use the supported choices above for new controls.
              </p>
              {(buttonMetadata.apiGuidance?.compatibilityAliases ?? []).map((alias) => (
                <div
                  key={`${alias.prop}:${alias.alias}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  {alias.alias.startsWith('icon-') ? (
                    <Button
                      size={alias.alias as ButtonSize}
                      iconOnly
                      aria-label={`${alias.prop} ${alias.alias}`}
                    >
                      <FixtureIcon icon={PlusIcon} />
                    </Button>
                  ) : (
                    <Button
                      variant={
                        alias.prop === 'variant' ? (alias.alias as ButtonVariant) : 'secondary'
                      }
                      size={alias.prop === 'size' ? (alias.alias as ButtonSize) : 'default'}
                      aria-label={`${alias.prop} ${alias.alias}`}
                    >
                      {alias.alias}
                    </Button>
                  )}
                  <span className="type-caption text-muted-foreground">
                    Deprecated — use {alias.prop}="{alias.replacement}".
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="grid gap-2"
              data-catalog-rendered-state="long-label light dark reduced-motion action-feedback"
            >
              <Button
                className="w-full min-w-0 max-w-full"
                variant="outline"
                onClick={() => setLongButtonAction('Long-label action completed')}
              >
                A long button label that remains readable in compact layouts
              </Button>
              <output
                className="type-caption text-muted-foreground"
                aria-label="Long button action status"
                aria-live="polite"
              >
                {longButtonAction}
              </output>
            </div>
          )}
        </>
      ) : componentId === 'checkbox' ? (
        <div
          className="grid gap-3"
          data-catalog-rendered-state="unchecked checked mixed disabled required-invalid"
        >
          <label htmlFor={`${uid}-0`} className="flex items-center gap-2">
            <Checkbox
              id={`${uid}-0`}
              checked={checkboxChecked}
              onCheckedChange={(value) => setCheckboxChecked(value === true)}
              aria-label="Catalog checkbox"
            />
            Interactive
          </label>
          <label htmlFor={`${uid}-1`} className="flex items-center gap-2">
            <Checkbox defaultChecked aria-label="Checked checkbox" id={`${uid}-1`} />
            Checked
          </label>
          <label htmlFor={`${uid}-2`} className="flex items-center gap-2">
            <Checkbox indeterminate aria-label="Mixed checkbox" id={`${uid}-2`} />
            Mixed
          </label>
          <label htmlFor={`${uid}-3`} className="flex items-center gap-2">
            <Checkbox disabled aria-label="Disabled checkbox" id={`${uid}-3`} />
            Disabled
          </label>
          <div>
            <Checkbox required aria-label="Required checkbox" aria-describedby="checkbox-error" />
            <p id="checkbox-error" className="type-caption text-danger">
              Selection required
            </p>
          </div>
        </div>
      ) : componentId === 'switch' ? (
        <div className="grid gap-3" data-catalog-rendered-state="off on disabled required-invalid">
          <label htmlFor={`${uid}-4`} className="flex items-center gap-2">
            <Switch
              checked={switchChecked}
              onCheckedChange={setSwitchChecked}
              aria-label="Catalog switch"
              id={`${uid}-4`}
            />
            Interactive
          </label>
          <label htmlFor={`${uid}-5`} className="flex items-center gap-2">
            <Switch defaultChecked aria-label="Enabled switch" id={`${uid}-5`} />
            On
          </label>
          <label htmlFor={`${uid}-6`} className="flex items-center gap-2">
            <Switch disabled aria-label="Disabled switch" id={`${uid}-6`} />
            Disabled
          </label>
          <div>
            <Switch required aria-label="Required switch" aria-describedby="switch-error" />
            <p id="switch-error" className="type-caption text-danger">
              Setting required
            </p>
          </div>
        </div>
      ) : componentId === 'toggle' ? (
        <div
          className="flex flex-wrap gap-2"
          data-catalog-rendered-state="off on disabled focus-visible"
        >
          <Toggle pressed={togglePressed} onPressedChange={setTogglePressed} aria-label="Bold">
            Bold
          </Toggle>
          <Toggle defaultPressed aria-label="Pinned">
            Pinned
          </Toggle>
          <Toggle disabled aria-label="Disabled toggle">
            Disabled
          </Toggle>
        </div>
      ) : componentId === 'toggle-group' ? (
        <div data-catalog-rendered-state="single multiple selected unselected disabled keyboard-focus">
          <ToggleGroup
            type="single"
            value={groupValue}
            onValueChange={setGroupValue}
            aria-label="Display mode"
          >
            <ToggleGroupItem value="list" aria-label="List view">
              List
            </ToggleGroupItem>
            <ToggleGroupItem value="tree" aria-label="Tree view">
              Tree
            </ToggleGroupItem>
            <ToggleGroupItem value="grid" aria-label="Grid view" disabled>
              Grid
            </ToggleGroupItem>
          </ToggleGroup>
          <output className="sr-only" aria-label="Display mode value">
            {groupValue}
          </output>
        </div>
      ) : null}
    </div>
  );
}
