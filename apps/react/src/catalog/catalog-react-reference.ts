import type { CatalogEntry, CatalogProp } from './catalog';

/** Documentation availability only; implementation is not a claim of accepted parity. */
export interface ReactCatalogReference {
  status: 'implemented' | 'pending';
  importStatement?: string;
  usage?: string;
  props: CatalogProp[];
  notes: string[];
}

type Reference = Omit<ReactCatalogReference, 'status'>;

function prop(name: string, type: string, description: string, defaultValue = '—'): CatalogProp {
  return { name, type, defaultValue, description };
}

const className = prop('className', 'string', 'Additional classes on the component surface.');
const children = prop('children', 'ReactNode', 'Rendered React content, not a Svelte snippet.');
const contentProps = [className, children];
const valueChange = prop(
  'onValueChange',
  '(value: string) => void',
  'Update the controlled value.',
);
const openChange = prop('onOpenChange', '(open: boolean) => void', 'Update controlled visibility.');
const inputProps = [
  prop(
    'value / defaultValue',
    'string',
    'Use value with onChange, or defaultValue for an uncontrolled field.',
  ),
  prop(
    'onChange',
    'ChangeEventHandler<HTMLInputElement>',
    'Read the text from event.currentTarget.value.',
  ),
  prop('ref', 'Ref<HTMLInputElement>', 'React ref to the native input.'),
  prop(
    'message / error',
    'string',
    'Helper or error message linked through aria-describedby; error takes precedence.',
  ),
  className,
];
const pickerProps = [
  prop(
    'value / defaultValue',
    'string | string[]',
    'Selected option value; multiple selection uses an array.',
  ),
  prop(
    'options / groups',
    'ComboboxOption[] / ComboboxGroup[]',
    'Stable option values with labels and optional descriptions or disabled state.',
  ),
  prop('ariaLabel', 'string', 'Required purpose-specific accessible name.'),
  prop(
    'onChange',
    '(value: string | string[], option?: ComboboxOption) => void',
    'Update selection; receives the option when available.',
  ),
  prop(
    'onCommit',
    '(value: string | string[], option: ComboboxOption) => void',
    'Accepted user activation, including reselection of the current single value.',
  ),
  prop(
    'onSearch',
    '(query: string) => options | groups | Promise<options | groups>',
    'Return local or remote search results; rejected searches show retry feedback.',
  ),
  prop(
    'onSearchError',
    '(error: unknown, query: string) => void',
    'Observe a failed search without converting it to an empty result.',
  ),
  prop(
    'inputRef',
    'Ref<HTMLInputElement>',
    'React ref to the search input; host overlays own focus and dismissal.',
  ),
  prop('headerAction / footer', 'ReactNode', 'Rendered header action and footer content.'),
  prop(
    'optionDescription / optionActions',
    '(option: ComboboxOption) => ReactNode',
    'Render props for option content and actions.',
  ),
  prop(
    'groupDescription / groupAction',
    '(group: ComboboxGroup) => ReactNode',
    'Render props for group content and actions.',
  ),
  prop('onQueryChange', '(query: string) => void', 'Observe search input changes.'),
  openChange,
  className,
];

function reference(
  importStatement: string,
  body: string,
  props: CatalogProp[],
  notes: string[] = [],
): Reference {
  return { importStatement, usage: `${importStatement}\n\n${body}`, props, notes };
}

// i18n-ignore (copyable developer documentation preserves reference example text; product callers localize labels)
const references: Record<string, Reference> = {
  toast: reference(
    "import { Toast, toast } from '@/components/ui/toast';",
    `import { Button } from '@/components/ui/button';

export function Example() {
  return <><Button onClick={() => toast.success('Workspace saved', { toasterId: 'example' })}>Save</Button><Toast toasterId="example" regionId="example-toasts" /></>;
}`,
    [
      prop('toasterId / regionId', 'string', 'Isolate a Sonner host and its DOM region.'),
      prop(
        'staticPosition',
        'boolean',
        'Render the real host inline for source catalog display.',
        'false',
      ),
      prop(
        'staticToastCount / onClearAll',
        'number / () => void',
        'Supply source static-stack count and cleanup.',
      ),
      prop(
        'toast.custom',
        '(render: (id: string | number) => ReactElement, options?) => string | number',
        'Native React Sonner custom render callback; unlike Svelte, no componentProps option.',
      ),
    ],
    [
      'Mount one live host for the application. These catalog hosts and static update previewState are display scaffolding; native updater acceptance is separate.',
    ],
  ),
  notify: reference(
    "import { notify } from '@/components/patterns/notify';",
    `import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';

export function Example() {
  return <><Button onClick={() => notify.undoable('Workspace archived', { undoLabel: 'Undo', onUndo: () => { console.info('Restore workspace'); } })}>Archive</Button><Toast /></>;
}`,
    [
      prop(
        'success / info / warning / error',
        '(message, options?) => NotifyId',
        'Apply source notification duration policy; errors may carry diagnostic details.',
      ),
      prop(
        'progress',
        '(message, options?) => ProgressHandle',
        'Returns stable id plus update, success, error and dismiss operations.',
      ),
      prop('key', 'string', 'Replace the notification with the same key.'),
      prop(
        'undoable',
        '(message, { undoLabel, onUndo, onExpire?, ...options }) => NotifyId',
        'Expiry belongs to the operation and continues after UI dismissal; Undo cancels it.',
      ),
      prop(
        'custom',
        '(Component, { componentProps?, ...options }) => NotifyId',
        'React component with an injected closeToast callback.',
      ),
      prop(
        'agentFailure / appError / update',
        '(props, options?) => NotifyId',
        'Lazy custom surfaces; update without previewState uses the real native adapter.',
      ),
      prop(
        'dismiss',
        '(id?: NotifyId | ProgressHandle) => void',
        'Dismiss one notification or all notifications.',
      ),
    ],
    [
      'The source notify catalog cells all display NotifyErrorToast with the state name. Use the interactive example for actual policies, timers and callbacks.',
    ],
  ),
  'github-link-card': reference(
    "import { GitHubLinkCard, type GitHubLinkCardProps } from '@/components/ui/github-link-card';",
    `export function Example(props: GitHubLinkCardProps) {
  return <GitHubLinkCard {...props} />;
}`,
    [
      prop('url', 'string', 'Original repository resource URL.'),
      prop(
        'preview',
        'GitHubLinkCardProps["preview"]',
        'Display state from the canonical link-preview owner: loading, ready or error.',
      ),
    ],
    [
      'Sixteen source display states are available. LinkTooltip singleton, cache, connection ownership and rate-limited hover/actions are not exercised by these static inputs.',
    ],
  ),
  'content-header': reference(
    "import { ContentHeader } from '@/features/layout/components/content-header';",
    `import { useState } from 'react';

export function Example() {
  const [title, setTitle] = useState('Preview implementation plan');
  return <ContentHeader title={title} editableTitle onTitleChange={setTitle} showClose={false} />;
}`,
    [
      prop('title / subtitle', 'string', 'Content heading and supporting text.'),
      prop(
        'editableTitle / onTitleChange',
        'boolean / (title: string) => void',
        'Commit a nonempty trimmed title; Escape cancels.',
      ),
      prop('breadcrumbs', 'BreadcrumbItem[]', 'Category labels with optional icons and callbacks.'),
      prop('canGoBack / canGoForward', 'boolean', 'Navigation availability.'),
      prop(
        'onNavigateBack / onNavigateForward / onClose',
        '() => void',
        'Panel navigation and dismissal callbacks.',
      ),
      prop('actions', 'ReactNode', 'Trailing controls.'),
      className,
    ],
    [
      'Editable-text scenes include this header and EditableName only. WorkspaceSidebarHeader and dense-context remain pending.',
    ],
  ),
  'panel-wrapper': reference(
    "import { PanelWrapper } from '@/components/ui/panel-wrapper';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [open, setOpen] = useState(true);
  return <><Button onClick={() => setOpen(true)}>Open panel</Button><PanelWrapper open={open} title="Details" showClose onClose={() => setOpen(false)}><p>Panel content</p></PanelWrapper></>;
}`,
    [
      prop(
        'open',
        'boolean',
        'Keep mounted and toggle open to retain the exit transition.',
        'true',
      ),
      prop(
        'title / editableTitle / onTitleChange',
        'ContentHeaderProps',
        'Source header behavior forwarded to ContentHeader.',
      ),
      prop('faIcon', 'Icon', 'Source title icon alias.'),
      prop('contentClass / headerClass', 'string', 'Classes for panel body and header.'),
      children,
      className,
    ],
  ),
  'agent-badge': reference(
    "import { AgentBadge } from '@/components/ui/indicators';",
    `export function Example({ unread }: { unread: number }) {
  return <AgentBadge count={unread} />;
}`,
    [
      prop(
        'count',
        'number',
        'Unread count; zero hides the badge. Changes use the source update animation.',
      ),
      className,
    ],
  ),
  'unsaved-indicator': reference(
    "import { UnsavedIndicator } from '@/components/ui/indicators';",
    `export function Example({ dirty }: { dirty: boolean }) {
  return <UnsavedIndicator visible={dirty} />;
}`,
    [
      prop('visible', 'boolean', 'Show the source unsaved dot with presence transitions.', 'false'),
      className,
    ],
    ['This boolean UI indicator differs from the status-based form UnsavedIndicator.'],
  ),

  accordion: reference(
    "import * as Accordion from '@/components/ui/accordion';",
    `export function Example() {
  return (
    <Accordion.Root defaultValue="details">
      <Accordion.Item value="details">
        <Accordion.Header><Accordion.Trigger>Details</Accordion.Trigger></Accordion.Header>
        <Accordion.Content>Accordion details</Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}`,
    [
      prop('Root.type', "'single' | 'multiple'", 'Multiple mode uses string arrays.', "'single'"),
      prop(
        'Root.value / defaultValue',
        'string | string[]',
        'Controlled or initial expanded items.',
      ),
      prop(
        'Root.onValueChange',
        '(value: string | string[]) => void',
        'Callback type follows the selected mode.',
      ),
      prop(
        'Root.collapsible / loop',
        'boolean',
        'Allow closing the single item and wrapping keyboard navigation.',
        'true',
      ),
      ...contentProps,
    ],
  ),
  badge: reference(
    "import { Badge } from '@/components/ui/badge';",
    `export function Example() {
  return <Badge variant="solid" color="green">Complete</Badge>;
}`,
    [
      prop(
        'variant',
        'BadgeVariant',
        'Solid or dot presentation; compatibility variants remain supported.',
        "'solid'",
      ),
      prop('color', 'BadgeColor', 'Status or category color; always name the status in text.'),
      prop('removable', 'boolean', 'Requires removeLabel and onRemove when true.', 'false'),
      prop(
        'onRemove',
        'MouseEventHandler<HTMLButtonElement>',
        'Called after the removal transition.',
      ),
      prop('ref', 'Ref<HTMLElement>', 'Ref to the span or link surface.'),
      ...contentProps,
    ],
  ),
  breadcrumb: reference(
    "import * as Breadcrumb from '@/components/ui/breadcrumb';",
    `export function Example() {
  return (
    <Breadcrumb.Root aria-label="Page path">
      <Breadcrumb.List>
        <Breadcrumb.Item><Breadcrumb.Link href="/sandbox">Catalog</Breadcrumb.Link></Breadcrumb.Item>
        <Breadcrumb.Separator />
        <Breadcrumb.Item><Breadcrumb.Page>Components</Breadcrumb.Page></Breadcrumb.Item>
      </Breadcrumb.List>
    </Breadcrumb.Root>
  );
}`,
    [
      prop('Root.aria-label', 'string', 'Accessible name of the navigation landmark.'),
      prop('Link.href', 'string', 'Ancestor destination.'),
      prop('Link.asChild', 'boolean', 'Compose a caller-supplied link element.', 'false'),
      ...contentProps,
    ],
  ),
  button: reference(
    "import { Button } from '@/components/ui/button';",
    `import { useState } from 'react';

export function Example() {
  const [saved, setSaved] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setSaved(true)}>Save</Button>
      <output className="block">{saved ? 'Saved' : 'Unsaved changes'}</output>
    </>
  );
}`,
    [
      prop(
        'variant',
        'ButtonVariant',
        'Primary, secondary, ghost, destructive, outline and compatibility treatments.',
        "'default'",
      ),
      prop('size', 'ButtonSize', 'Control and icon sizes; otherwise inherited from SizeProvider.'),
      prop(
        'loading / disabled',
        'boolean',
        'Prevent activation; loading also shows progress.',
        'false',
      ),
      prop('onClick', 'MouseEventHandler<HTMLButtonElement>', 'React click event for the action.'),
      prop('href', 'string', 'Render a link instead of a button.'),
      prop('ref', 'Ref<HTMLButtonElement | HTMLAnchorElement>', 'Ref to the rendered control.'),
      prop('leadingIcon / trailingIcon', 'ReactNode', 'Rendered icon slots.'),
      ...contentProps,
    ],
  ),
  'button-group': reference(
    "import { ButtonGroup } from '@/components/ui/button-group';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [action, setAction] = useState('');
  return (
    <>
      <ButtonGroup aria-label="Workspace actions">
        <Button onClick={() => setAction('Opened')}>Open</Button>
        <Button onClick={() => setAction('Archived')}>Archive</Button>
      </ButtonGroup>
      <output className="block">{action}</output>
    </>
  );
}`,
    [
      prop(
        'orientation',
        "'horizontal' | 'vertical'",
        'Direction of related action buttons.',
        "'horizontal'",
      ),
      prop('aria-label', 'string', 'Name the action group.'),
      prop('ref', 'Ref<HTMLDivElement>', 'Ref to the group surface.'),
      ...contentProps,
    ],
  ),
  card: reference(
    "import * as Card from '@/components/ui/card';",
    `export function Example() {
  return (
    <Card.Root>
      <Card.Header><Card.Title>Workspace</Card.Title></Card.Header>
      <Card.Content>Workspace details</Card.Content>
    </Card.Root>
  );
}`,
    [
      prop(
        'Group.orientation',
        "'card' | 'inline'",
        'Stack media or place it beside the content.',
        "'card'",
      ),
      prop('Group.columns', 'number', 'Number of equal-width columns.', '1'),
      prop('Group.border', "'none' | 'outlined'", 'Group border treatment.', "'none'"),
      prop(
        'Group.separated / divided / fluidHover',
        'boolean',
        'Separate cards, draw dividers, or move the shared hover highlight.',
        'false / true / true',
      ),
      prop('Group.selected', 'number', 'Persistently highlighted card index.', '-1'),
      prop(
        'Root.border',
        "'none' | 'outlined'",
        'Defaults to outlined when standalone; follows the group otherwise.',
      ),
      prop('Root.selected', 'boolean', 'Keep the card highlighted.', 'false'),
      prop('Root.media', 'ReactNode', 'Leading media content.'),
      ...contentProps,
    ],
  ),
  checkbox: reference(
    "import { Checkbox } from '@/components/ui/checkbox';",
    `import { useState } from 'react';
import { Label } from '@/components/ui/label';

export function Example() {
  const [checked, setChecked] = useState(false);
  return (
    <div>
      <Checkbox id="alerts" checked={checked} onCheckedChange={(next) => setChecked(next === true)} />
      <Label htmlFor="alerts">Enable alerts</Label>
    </div>
  );
}`,
    [
      prop(
        'checked / defaultChecked',
        "boolean | 'indeterminate'",
        'Controlled or initial check state.',
      ),
      prop(
        'onCheckedChange',
        "(checked: boolean | 'indeterminate') => void",
        'Update the checked state.',
      ),
      prop(
        'indeterminate / onIndeterminateChange',
        'boolean / (indeterminate: boolean) => void',
        'Separate mixed-state control.',
      ),
      prop(
        'readOnly / disabled / invalid',
        'boolean',
        'Control interaction and validation state.',
        'false',
      ),
      prop(
        'ariaLabel / ariaLabelledby / ariaDescribedby',
        'string',
        'Accessible naming and descriptions; native aria attributes also work.',
      ),
      prop('ref', 'Ref<HTMLButtonElement>', 'Ref to the checkbox control.'),
      className,
    ],
  ),
  'checkbox-group': reference(
    "import * as CheckboxGroup from '@/components/ui/checkbox-group';",
    `import { useState } from 'react';

export function Example() {
  const [value, setValue] = useState(['alerts']);
  return (
    <CheckboxGroup.Root value={value} onValueChange={setValue} aria-label="Notifications">
      <CheckboxGroup.Item value="alerts" title="Alerts" />
      <CheckboxGroup.Item value="summaries" title="Summaries" />
    </CheckboxGroup.Root>
  );
}`,
    [
      prop('Root.value / defaultValue', 'string[]', 'Selected option values.'),
      prop('Root.onValueChange', '(value: string[]) => void', 'Update the controlled selection.'),
      prop('Root.layout', "'inline' | 'stacked'", 'Choice arrangement.', "'stacked'"),
      prop('Item.title / description', 'string', 'Visible choice label and supporting text.'),
      prop(
        'Item.marker',
        '(state: { selected: boolean; index: number }) => ReactNode',
        'Custom marker render prop.',
      ),
      ...contentProps,
    ],
  ),
  'radio-group': reference(
    "import * as RadioGroup from '@/components/ui/radio-group';",
    `import { useState } from 'react';

export function Example() {
  const [value, setValue] = useState('standard');
  return (
    <RadioGroup.Root value={value} onValueChange={setValue} aria-label="Delivery speed">
      <RadioGroup.Item value="standard" title="Standard" />
      <RadioGroup.Item value="fast" title="Fast" />
    </RadioGroup.Root>
  );
}`,
    [
      prop('Root.value / defaultValue', 'string', 'Selected option value.'),
      prop('Root.onValueChange', '(value: string) => void', 'Update the controlled selection.'),
      prop('Root.readOnly', 'boolean', 'Retain focus access without changing selection.', 'false'),
      prop('Item.title / description', 'string', 'Visible choice label and supporting text.'),
      prop(
        'Item.marker',
        '(state: { selected: boolean; index: number }) => ReactNode',
        'Custom marker render prop.',
      ),
      ...contentProps,
    ],
  ),
  dialog: reference(
    "import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';",
    `export function Example() {
  return (
    <Dialog>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Workspace details</DialogTitle>
          <DialogDescription>Review the workspace information.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}`,
    [
      prop('Dialog.open / defaultOpen', 'boolean', 'Controlled or initial visibility.'),
      prop('Dialog.onOpenChange', '(open: boolean) => void', 'Update controlled visibility.'),
      prop(
        'DialogContent.size',
        "'sm' | 'default' | 'lg' | 'wide' | 'editor'",
        'Dialog size.',
        "'default'",
      ),
      prop(
        'DialogContent.onOpenAutoFocus / onCloseAutoFocus',
        '(event: Event) => void',
        'Native cancelable focus lifecycle events.',
      ),
      prop('DialogContent.ref', 'Ref<HTMLDivElement>', 'Ref to the dialog content.'),
      prop(
        'DialogContent.children',
        'ReactNode',
        'Include a DialogTitle and an optional DialogDescription.',
      ),
    ],
  ),
  sheet: reference(
    "import * as Sheet from '@/components/ui/sheet';",
    `export function Example() {
  return (
    <Sheet.Root>
      <Sheet.Trigger>Open sheet</Sheet.Trigger>
      <Sheet.Content>
        <Sheet.Header>
          <Sheet.Title>Workspace details</Sheet.Title>
          <Sheet.Description>Review the workspace information.</Sheet.Description>
        </Sheet.Header>
      </Sheet.Content>
    </Sheet.Root>
  );
}`,
    [
      prop('Root.open / defaultOpen', 'boolean', 'Controlled or initial visibility.'),
      prop('Root.onOpenChange', '(open: boolean) => void', 'Update controlled visibility.'),
      prop('Content.side', "'top' | 'right' | 'bottom' | 'left'", 'Viewport edge.', "'right'"),
      prop(
        'Content.onOpenAutoFocus / onCloseAutoFocus',
        '(event: Event) => void',
        'Native cancelable focus lifecycle events.',
      ),
      prop('Content.ref', 'Ref<HTMLDivElement>', 'Ref to the sheet content.'),
      ...contentProps,
    ],
  ),
  menu: reference(
    "import * as Menu from '@/components/ui/menu';",
    `import { useState } from 'react';

export function Example() {
  const [selected, setSelected] = useState('');
  return (
    <>
      <Menu.Root>
        <Menu.Trigger>Open menu</Menu.Trigger>
        <Menu.Content>
          <Menu.Group>
            <Menu.Label>Commands</Menu.Label>
            <Menu.Item onSelect={() => setSelected('Run command')}>Run command</Menu.Item>
          </Menu.Group>
        </Menu.Content>
      </Menu.Root>
      <output className="block">{selected}</output>
    </>
  );
}`,
    [
      prop('Root.open / defaultOpen', 'boolean', 'Controlled or initial menu visibility.'),
      prop('Root.onOpenChange', '(open: boolean) => void', 'Update controlled visibility.'),
      prop(
        'Item.onSelect',
        '(event: Event) => void',
        'Native selection event, fired for pointer and keyboard activation.',
      ),
      prop(
        'Trigger.asChild',
        'boolean',
        'Compose a trigger element that forwards its props and ref.',
        'false',
      ),
      prop('Content.ref', 'Ref<HTMLDivElement>', 'Ref to the menu surface.'),
      ...contentProps,
    ],
  ),
  select: reference(
    "import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select';",
    `import { useState } from 'react';

const items = [{ value: 'apple', label: 'Apple' }, { value: 'banana', label: 'Banana' }];

export function Example() {
  const [value, setValue] = useState('apple');
  return (
    <Select value={value} onValueChange={setValue} items={items}>
      <SelectTrigger aria-label="Fruit"><SelectValue placeholder="Choose fruit" /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} label={item.label}>{item.label}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}`,
    [
      prop('value / defaultValue', 'string', 'Selected option value.'),
      valueChange,
      openChange,
      prop(
        'items',
        '{ value: string; label: string; disabled?: boolean }[]',
        'Labels used by SelectValue.',
      ),
      prop('SelectTrigger.ref', 'Ref<HTMLButtonElement>', 'Ref to the trigger control.'),
      prop('SelectContent.portal', 'boolean', 'Render the menu in a portal.', 'false'),
      prop(
        'children',
        'ReactNode',
        'Compose named SelectTrigger, SelectContent and SelectItem exports.',
      ),
    ],
  ),
  tabs: reference(
    "import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';",
    `export function Example() {
  return (
    <Tabs defaultValue="overview">
      <TabsList aria-label="Workspace tabs">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview content</TabsContent>
      <TabsContent value="activity">Activity content</TabsContent>
    </Tabs>
  );
}`,
    [
      prop('value / defaultValue', 'string', 'Controlled or initial active tab.'),
      valueChange,
      prop('variant', "'default' | 'subtle' | 'underline'", 'Tab treatment.', "'default'"),
      prop(
        'activationMode',
        "'automatic' | 'manual'",
        'Whether focus activates a tab.',
        "'automatic'",
      ),
      prop(
        'orientation',
        "'horizontal' | 'vertical'",
        'Keyboard navigation direction.',
        "'horizontal'",
      ),
      ...contentProps,
    ],
  ),
  'toggle-group': reference(
    "import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';",
    `export function Example() {
  return (
    <ToggleGroup type="single" defaultValue="left" aria-label="Alignment">
      <ToggleGroupItem value="left" aria-label="Align left">Left</ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">Right</ToggleGroupItem>
    </ToggleGroup>
  );
}`,
    [
      prop(
        'type',
        "'single' | 'multiple'",
        'Required selection mode; determines scalar or array values.',
      ),
      prop('value / defaultValue', 'string | string[]', 'Controlled or initial selection.'),
      prop(
        'onValueChange',
        '(value: string | string[]) => void',
        'Callback type follows the selection mode.',
      ),
      prop('ref', 'Ref<HTMLDivElement>', 'Ref to the group.'),
      ...contentProps,
    ],
  ),
  toggle: reference(
    "import { Toggle } from '@/components/ui/toggle';",
    `import { useState } from 'react';

export function Example() {
  const [pressed, setPressed] = useState(false);
  return <Toggle pressed={pressed} onPressedChange={setPressed} aria-label="Bold">Bold</Toggle>;
}`,
    [
      prop('pressed / defaultPressed', 'boolean', 'Controlled or initial pressed state.'),
      prop(
        'onPressedChange / onChange',
        '(pressed: boolean) => void',
        'Boolean callbacks, not DOM change events; prefer one callback.',
      ),
      prop('ref', 'Ref<HTMLButtonElement>', 'Ref to the toggle button.'),
      ...contentProps,
    ],
  ),
  switch: reference(
    "import { Switch } from '@/components/ui/switch';",
    `import { useState } from 'react';
import { Label } from '@/components/ui/label';

export function Example() {
  const [checked, setChecked] = useState(true);
  return (
    <div>
      <Switch id="notifications" checked={checked} onCheckedChange={setChecked} />
      <Label htmlFor="notifications">Notifications</Label>
    </div>
  );
}`,
    [
      prop('checked / defaultChecked', 'boolean', 'Controlled or initial switch state.'),
      prop('onCheckedChange', '(checked: boolean) => void', 'Update the controlled state.'),
      prop('size', "'sm' | 'md' | 'lg'", 'Control size.', "'md'"),
      prop('ref', 'Ref<HTMLButtonElement>', 'Ref to the switch control.'),
      className,
    ],
  ),
  input: reference(
    "import { Input } from '@/components/ui/input';",
    `import { useState } from 'react';
import { Label } from '@/components/ui/label';

export function Example() {
  const [value, setValue] = useState('My workspace');
  return (
    <div>
      <Label htmlFor="workspace-name">Workspace name</Label>
      <Input id="workspace-name" value={value} onChange={(event) => setValue(event.currentTarget.value)} message="Choose a descriptive name." />
    </div>
  );
}`,
    inputProps,
  ),
  textarea: reference(
    "import { Textarea } from '@/components/ui/textarea';",
    `import { useState } from 'react';
import { Label } from '@/components/ui/label';

export function Example() {
  const [value, setValue] = useState('');
  return (
    <div>
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" value={value} onChange={(event) => setValue(event.currentTarget.value)} autoResize placeholder="Describe the workspace" />
    </div>
  );
}`,
    [
      prop('value / defaultValue', 'string', 'Controlled or initial text.'),
      prop(
        'onChange',
        'ChangeEventHandler<HTMLTextAreaElement>',
        'Read event.currentTarget.value.',
      ),
      prop('ref', 'Ref<HTMLTextAreaElement>', 'Ref to the native textarea.'),
      prop(
        'autoResize / doesExpandToFit',
        'boolean',
        'Grow with the content between minHeight and maxHeight.',
        'false',
      ),
      prop('minHeight / maxHeight', 'number', 'Auto-growth limits in pixels.', '80 / 400'),
      prop('message / error', 'string', 'Associated helper or validation feedback.'),
      className,
    ],
  ),
  label: reference(
    "import { Label } from '@/components/ui/label';",
    `import { Input } from '@/components/ui/input';

export function Example() {
  return <div><Label htmlFor="name">Name</Label><Input id="name" /></div>;
}`,
    [
      prop('htmlFor', 'string', 'ID of the associated control; React spelling replaces for.'),
      prop('invalid', 'boolean', 'Show invalid field state.', 'false'),
      prop('ref', 'Ref<HTMLLabelElement>', 'Ref to the label.'),
      ...contentProps,
    ],
  ),
  'input-message': reference(
    "import { InputMessage } from '@/components/ui/input-message';",
    `import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function Example() {
  return (
    <div>
      <Label htmlFor="required-name">Name</Label>
      <Input id="required-name" aria-invalid aria-describedby="name-error" />
      <InputMessage id="name-error" tone="error">Enter a name.</InputMessage>
    </div>
  );
}`,
    [
      prop(
        'tone',
        "'helper' | 'error'",
        'Helper announces politely; error uses an alert.',
        "'helper'",
      ),
      prop('id', 'string', 'Link to the input through aria-describedby.'),
      ...contentProps,
    ],
  ),
  'input-group': reference(
    "import { InputGroup, InputGroupInput, InputGroupButton } from '@/components/ui/input-group';",
    `import { useState } from 'react';

export function Example() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  return (
    <>
      <InputGroup trailing={<InputGroupButton onClick={() => setSubmitted(query)}>Search</InputGroupButton>}>
        <InputGroupInput aria-label="Search workspaces" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      </InputGroup>
      <output className="block">{submitted}</output>
    </>
  );
}`,
    [
      prop('leading / trailing', 'ReactNode', 'Content around the input surface.'),
      prop('disabled / invalid', 'boolean', 'Group interaction and validation state.', 'false'),
      prop('message / error', 'string', 'Associated feedback for controls inside the group.'),
      prop('ref', 'Ref<HTMLDivElement>', 'Ref to the group; the input accepts its own native ref.'),
      ...contentProps,
    ],
  ),
  'copy-input': reference(
    "import { CopyInput } from '@/components/ui/copy-input';",
    `import { useState } from 'react';

export function Example() {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <CopyInput value="https://example.com/workspace" label="Workspace URL" onCopy={() => setCopied(true)} />
      <output className="block">{copied ? 'Copied workspace URL' : ''}</output>
    </>
  );
}`,
    [
      prop('value', 'string', 'Text displayed and copied to the clipboard.'),
      prop('label', 'string', 'Visible/accessible copy description.'),
      prop(
        'onCopy',
        '() => void',
        'Called after a successful clipboard write; not a clipboard event handler.',
      ),
      prop('variant', "'icon' | 'button'", 'Copy action presentation.', "'icon'"),
      prop('align', "'right' | 'left'", 'Action alignment.', "'right'"),
      className,
    ],
  ),
  'file-input': reference(
    "import { FileInput } from '@/components/ui/file-input';",
    `import { useState } from 'react';

export function Example() {
  const [files, setFiles] = useState<FileList>();
  return (
    <>
      <FileInput id="attachments" label="Choose files" multiple files={files} onFilesChange={setFiles} />
      <ul>{Array.from(files ?? []).map((file, index) => <li key={index}>{file.name}</li>)}</ul>
    </>
  );
}`,
    [
      prop('id', 'string', 'Required ID for the native file input.'),
      prop('files', 'FileList', 'Selected native files.'),
      prop(
        'onFilesChange',
        '(files: FileList | undefined) => void',
        'Called for selection and form reset.',
      ),
      prop(
        'ref',
        'Ref<FileInputHandle>',
        'Imperative handle with openPicker(); not an input DOM ref.',
      ),
      prop(
        'hiddenHost',
        'boolean',
        'Keep only the native picker host for external trigger compositions.',
        'false',
      ),
      prop('accept / multiple', 'string / boolean', 'Native file selection restrictions.'),
      className,
    ],
  ),
  slider: reference(
    "import { Slider } from '@/components/ui/slider';",
    `import { useState } from 'react';

export function Example() {
  const [value, setValue] = useState(50);
  return <Slider aria-label="Volume" min={0} max={100} value={value} onValueChange={setValue} showValue />;
}`,
    [
      prop(
        'value / defaultValue',
        'number',
        'Scalar value, not the array used by stock shadcn sliders.',
      ),
      prop(
        'onValueChange',
        '(value: number) => void',
        'Update the value during keyboard, pointer and readout editing.',
      ),
      prop(
        'onInput / onChange',
        'React input/change event handlers',
        'Native-range React events; numeric value is event.currentTarget.valueAsNumber.',
      ),
      prop('ref', 'Ref<HTMLInputElement>', 'Ref to the native range input.'),
      prop('steps', 'number[]', 'Optional non-uniform snap points.'),
      prop(
        'valuePosition',
        "'left' | 'right' | 'top' | 'bottom' | 'tooltip'",
        'Position of the formatted readout.',
        "'right'",
      ),
      className,
    ],
  ),
  separator: reference(
    "import { Separator } from '@/components/ui/separator';",
    `export function Example() {
  return <div><p>Workspace details</p><Separator /><p>Activity</p></div>;
}`,
    [
      prop(
        'orientation',
        "'horizontal' | 'vertical'",
        'Direction of the separator.',
        "'horizontal'",
      ),
      prop(
        'decorative',
        'boolean',
        'Hide decoration from the accessibility tree; false exposes separator semantics.',
        'true',
      ),
      className,
    ],
  ),
  skeleton: reference(
    "import { Skeleton } from '@/components/ui/skeleton';",
    `export function Example() {
  return (
    <div aria-busy="true" aria-label="Loading workspace">
      <Skeleton className="h-4 w-48" aria-hidden="true" />
      <Skeleton className="mt-2 h-4 w-32" aria-hidden="true" />
    </div>
  );
}`,
    [
      className,
      prop('ref', 'Ref<HTMLDivElement>', 'Ref to the placeholder surface.'),
      prop(
        'aria-hidden',
        'boolean',
        'Hide decorative placeholders; label the containing loading region.',
      ),
    ],
  ),
  kbd: reference(
    "import { Kbd, KbdGroup } from '@/components/ui/kbd';",
    `export function Example() {
  return <p>Open navigation <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup></p>;
}`,
    [
      prop('children', 'ReactNode', 'Shortcut display only; callers own keyboard handlers.'),
      className,
    ],
  ),
  'scroll-area': reference(
    "import { ScrollArea } from '@/components/ui/scroll-area';",
    `export function Example() {
  return (
    <ScrollArea orientation="vertical" className="h-36">
      {Array.from({ length: 18 }, (_, index) => <p key={index}>Documentation row {index + 1}</p>)}
    </ScrollArea>
  );
}`,
    [
      prop(
        'orientation',
        "'vertical' | 'horizontal' | 'both'",
        'Enabled scroll axes.',
        "'vertical'",
      ),
      prop(
        'viewportRef',
        'Ref<HTMLDivElement>',
        'Ref to the scrolling viewport, distinct from the root ref.',
      ),
      prop(
        'viewportProps',
        'ComponentProps<typeof ScrollAreaPrimitive.Viewport>',
        'Viewport event handlers and accessibility attributes.',
      ),
      prop('fadeEdges', 'boolean', 'Indicate content beyond the viewport.', 'true'),
      ...contentProps,
    ],
  ),
  table: reference(
    "import * as Table from '@/components/ui/table';",
    `export function Example() {
  return (
    <Table.Root>
      <Table.Caption>Workspaces</Table.Caption>
      <Table.Header><Table.Row><Table.Head>Name</Table.Head></Table.Row></Table.Header>
      <Table.Body><Table.Row><Table.Cell>My workspace</Table.Cell></Table.Row></Table.Body>
    </Table.Root>
  );
}`,
    [
      prop('Root.ref', 'Ref<HTMLTableElement>', 'Ref to the native table.'),
      prop(
        'Head.scope',
        "'col' | 'row' | 'colgroup' | 'rowgroup'",
        'Associate headers with data cells.',
      ),
      ...contentProps,
    ],
  ),
  tooltip: reference(
    "import * as Tooltip from '@/components/ui/tooltip';",
    `export function Example() {
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger>Keyboard help</Tooltip.Trigger>
        <Tooltip.Content>Press Command K to open navigation.</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}`,
    [
      prop(
        'Root / TooltipRoot',
        'component',
        'Primitive visibility root. Tooltip is the separate content wrapper.',
      ),
      prop(
        'Root.onOpenChange',
        '(open: boolean) => void',
        'Update controlled primitive visibility.',
      ),
      prop(
        'Tooltip.content / children / trigger',
        'ReactNode',
        'Wrapper content and trigger slots; use the primitive family for composition.',
      ),
      prop(
        'Tooltip.onClick',
        'MouseEventHandler<HTMLSpanElement>',
        'React click event on the wrapper trigger.',
      ),
      prop(
        'Content.portalTarget',
        'Element | string | null',
        'Optional target for the content portal.',
      ),
      prop(
        'Trigger.ref',
        'Ref<HTMLButtonElement>',
        'Ref to the primitive trigger; composed asChild elements must forward it.',
      ),
      ...contentProps,
    ],
  ),
  'principal-avatar': reference(
    "import { PrincipalAvatar } from '@/components/ui/principal-avatar';",
    `type Member = { avatarUrl?: string | null; displayName?: string | null; login?: string | null };

export function Example({ member }: { member: Member }) {
  return <PrincipalAvatar avatarUrl={member.avatarUrl} label={member.displayName ?? member.login ?? ''} size={24} />;
}`,
    [
      prop(
        'avatarUrl',
        'string | null',
        'Image URL; missing or failed images render initials.',
        'null',
      ),
      prop(
        'label',
        'string',
        'Required source text for initials; the avatar is decorative beside a visible name.',
      ),
      prop('size', 'number', 'Square size in pixels.', '24'),
      prop(
        'fill',
        'boolean',
        'Fill the containing surface instead of using a fixed size.',
        'false',
      ),
      className,
    ],
  ),
  'loading-indicator': reference(
    "import { IntentMarkLoader, AgentBadge, UnsavedIndicator } from '@/components/ui/indicators';",
    `export function Example() {
  return (
    <div>
      <output className="block"><IntentMarkLoader size={24} aria-hidden="true" /> Loading workspace</output>
      <AgentBadge count={3} />
      <UnsavedIndicator visible />
    </div>
  );
}`,
    [
      prop('variant', 'IntentMarkVariant', 'Intent mark motion variant.', "'bloom'"),
      prop('size', 'number', 'SVG size in pixels.', '24'),
      prop('playing', 'boolean', 'Start or pause the mark animation.', 'true'),
      prop('AgentBadge.count', 'number', 'Unread count; zero hides the badge.', '0'),
      prop('UnsavedIndicator.visible', 'boolean', 'Show the unsaved mark.', 'false'),
      className,
    ],
    [
      'The indicators UnsavedIndicator takes visible. The separate form UnsavedIndicator takes status and label.',
    ],
  ),
  list: reference(
    "import * as List from '@/components/ui/list';",
    `export function Example() {
  return <List.ListContainer><List.ListItem title="Overview" /></List.ListContainer>;
}`,
    [
      prop('ListContainer.interactive', 'boolean', 'Enable proximity highlighting.', 'false'),
      prop('ListItem.title / subtitle', 'string', 'Row content.'),
      prop('ListItem.onClick', 'MouseEventHandler<HTMLButtonElement>', 'React activation event.'),
      prop(
        'ListItem.onRightClick',
        'MouseEventHandler<HTMLButtonElement>',
        'React context-menu event.',
      ),
      prop(
        'ListItem.actions',
        '{ icon: Icon; label: string; onClick: MouseEventHandler<HTMLButtonElement> }[]',
        'Independently operable row actions.',
      ),
      prop('ListItem.iconSnippet', 'ReactNode', 'Custom rendered icon slot.'),
      ...contentProps,
    ],
  ),
  combobox: reference(
    "import { Combobox } from '@/components/ui/combobox';",
    `import { useState } from 'react';

const options = [
  { value: 'alpha', label: 'Alpha', description: 'Primary workspace' },
  { value: 'beta', label: 'Beta', description: 'Design workspace' },
  { value: 'archived', label: 'Archived', disabled: true },
];

export function Example() {
  const [value, setValue] = useState<string | string[]>('alpha');
  const [accepted, setAccepted] = useState('');
  return (
    <>
      <Combobox ariaLabel="Workspace" value={value} options={options} onChange={setValue}
        onCommit={(_, option) => setAccepted(option.label)} />
      <output className="block">{accepted ? 'Opened ' + accepted : ''}</output>
    </>
  );
}`,
    pickerProps,
  ),
  'searchable-select': reference(
    "import { SearchableSelect } from '@/components/ui/searchable-select';",
    `import { useState } from 'react';

const options = [{ value: 'apple', label: 'Apple' }, { value: 'banana', label: 'Banana' }];

export function Example() {
  const [value, setValue] = useState('apple');
  return <SearchableSelect ariaLabel="Fruit" options={options} value={value} onChange={setValue} />;
}`,
    [
      prop('value / defaultValue', 'string', 'Single selected option value.'),
      prop('onChange', '(value: string) => void', 'Update the selected value.'),
      prop(
        'onSearch',
        '(query: string) => ComboboxOption[] | Promise<ComboboxOption[]>',
        'Optional asynchronous search.',
      ),
      prop('inputRef', 'Ref<HTMLInputElement>', 'Search input ref.'),
      prop(
        'ariaLabel',
        'string',
        'Name the selection purpose; otherwise falls back to placeholder.',
      ),
      className,
    ],
    ['Compatibility wrapper: prefer Combobox for new selection flows.'],
  ),
  'grouped-combobox': reference(
    "import { GroupedCombobox } from '@/components/ui/grouped-combobox';",
    `import { useState } from 'react';

const groups = [
  { key: 'recent', label: 'Recent', options: [{ value: 'alpha', label: 'Alpha' }] },
  { key: 'all', label: 'Other workspaces', options: [{ value: 'beta', label: 'Beta' }] },
];

export function Example() {
  const [value, setValue] = useState('alpha');
  return <GroupedCombobox ariaLabel="Workspace" groups={groups} value={value} onChange={setValue} defaultCollapsed={false} />;
}`,
    [
      prop('value / defaultValue', 'string', 'Single selected option value.'),
      prop('groups', 'OptionGroup[]', 'Groups with stable keys and option values.'),
      prop(
        'onChange',
        '(value: string, option?: GroupedOption, event?: MouseEvent) => void',
        'Selection callback; the optional native event may be absent.',
      ),
      prop(
        'defaultCollapsed',
        'boolean',
        'Initial state for groups without an explicit collapsed value.',
        'true',
      ),
      prop('groupAction', '(group: ComboboxGroup) => ReactNode', 'Render a group action.'),
      prop('inputRef', 'Ref<HTMLInputElement>', 'Search input ref.'),
      openChange,
      className,
    ],
    ['Compatibility wrapper: prefer Combobox groups for new selection flows.'],
  ),
  dropdown: reference(
    "import { Dropdown } from '@/components/ui/dropdown';",
    `import { useState } from 'react';

const options = [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }];

export function Example() {
  const [value, setValue] = useState<string | string[]>('alpha');
  return <Dropdown options={options} value={value} onChange={setValue} placeholder="Choose workspace" searchable />;
}`,
    [
      prop(
        'value / defaultValue',
        'string | string[]',
        'Selected value or values in multiple mode.',
      ),
      prop(
        'onChange',
        '(value: string | string[], event?: MouseEvent) => void',
        'Selection callback with an optional native event.',
      ),
      prop(
        'trigger',
        '(state: { open: boolean; value: string | string[] | undefined }) => ReactNode',
        'Custom trigger render prop.',
      ),
      prop(
        'item / groupHeader',
        '(state: DropdownItemProps | DropdownGroupProps) => ReactNode',
        'Each slot receives its own item or group context.',
      ),
      prop('header / footer / empty', 'ReactNode', 'Rendered content slots.'),
      prop(
        'ref',
        'Ref<DropdownHandle>',
        'openAndFocusSearch(), focusTrigger(), dismissAndFocusTrigger().',
      ),
      prop('onSearchValueChange', '(search: string) => void', 'Update controlled search text.'),
      openChange,
      className,
    ],
    ['Compatibility wrapper: prefer Combobox for new selection flows.'],
  ),
  sidebar: reference(
    "import * as Sidebar from '@/components/ui/sidebar';",
    `export function Example() {
  return (
    <Sidebar.Provider defaultOpen persist={false}>
      <Sidebar.Root>
        <Sidebar.Content>
          <Sidebar.Group>
            <Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
            <Sidebar.GroupContent>
              <Sidebar.Menu>
                <Sidebar.MenuItem><Sidebar.MenuButton label="Overview" /></Sidebar.MenuItem>
              </Sidebar.Menu>
            </Sidebar.GroupContent>
          </Sidebar.Group>
        </Sidebar.Content>
      </Sidebar.Root>
      <Sidebar.Inset><Sidebar.Trigger />Workspace content</Sidebar.Inset>
    </Sidebar.Provider>
  );
}`,
    [
      prop(
        'Provider.open / defaultOpen',
        'boolean',
        'Controlled or initial desktop expansion. Use defaultOpen for a locally toggled example.',
        'defaultOpen: true',
      ),
      prop('Provider.onOpenChange', '(open: boolean) => void', 'Update controlled expansion.'),
      prop(
        'Provider.persist / onPersistOpen',
        'boolean / (open: boolean) => void',
        'Opt into the caller-owned persistence callback; the provider does not create a canonical preference.',
        'persist: true',
      ),
      prop('Root.side', "'left' | 'right'", 'Navigation edge.', "'left'"),
      prop(
        'Root.variant',
        "'sidebar' | 'floating' | 'inset'",
        'Surface relationship to content.',
        "'sidebar'",
      ),
      prop(
        'Root.collapsible',
        "'offcanvas' | 'icon' | 'none'",
        'Collapsed presentation.',
        "'offcanvas'",
      ),
      prop(
        'MenuButton.icon / tooltipContent',
        'ReactNode',
        'Rendered icon and collapsed-tooltip slots.',
      ),
      prop(
        'MenuButton.onClick',
        'MouseEventHandler<HTMLButtonElement>',
        'React activation handler.',
      ),
      ...contentProps,
    ],
  ),
  'proximity-highlight': reference(
    "import { ProximityHighlight, createProximityHover, type ProximityHover } from '@/lib/interaction';",
    `import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const container = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ProximityHover>();
  useLayoutEffect(() => {
    if (!container.current) return;
    const instance = createProximityHover(container.current);
    container.current.querySelectorAll('button').forEach((row, index) => instance.registerItem(index, row));
    instance.setActiveIndex(0);
    setHover(instance);
    return () => instance.destroy();
  }, []);
  return (
    <div ref={container} className="relative grid gap-1">
      {hover && <ProximityHighlight store={hover} selectedIndexes={[1, 2]} />}
      {['Nearest row', 'Selected row', 'Merged selection'].map((label, index) => (
        <Button key={label} variant="plain" className="relative" onFocus={() => hover?.setActiveIndex(index)}>{label}</Button>
      ))}
    </div>
  );
}`,
    [
      prop(
        'store',
        'ProximityHover',
        'Create from the containing DOM node, register items, and destroy on effect cleanup.',
      ),
      prop(
        'selectedIndexes',
        'ReadonlySet<number> | readonly number[]',
        'Persistently selected item indices.',
      ),
      prop('hoverClass / selectedClass', 'string', 'Optional highlight surface classes.'),
      className,
    ],
    [
      'The React public boundary is @/lib/interaction, not a components/ui/proximity-highlight module.',
    ],
  ),
  form: reference(
    "import { Form, FormField, FormActions, useForm } from '@/components/patterns/form';",
    `import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function Example() {
  const [saved, setSaved] = useState('');
  const form = useForm({ initial: { name: '' }, validate: ({ name }) => name.trim() ? {} : { name: 'Enter a name.' } });
  return (
    <>
      <Form busy={form.submitting} onSubmit={async () => { await form.submit(({ name }) => setSaved(name)); }}>
        <FormField label="Workspace name" required error={form.errors.name}
          control={(props) => <Input {...props} value={form.values.name} onChange={(event) => form.setField('name', event.currentTarget.value)} />} />
        <FormActions secondary={<Button onClick={form.reset}>Reset</Button>}
          primary={<Button type="submit" variant="primary" loading={form.submitting}>Save</Button>} />
      </Form>
      <output className="block">{saved ? 'Saved ' + saved : ''}</output>
    </>
  );
}`,
    [
      prop(
        'useForm',
        '(options: CreateFormOptions<T>) => form',
        'React hook replacing createForm; call at component initialization.',
      ),
      prop(
        'Form.onSubmit',
        '(event: FormEvent<HTMLFormElement>) => void | Promise<void>',
        'Submission respects native validation and busy state.',
      ),
      prop(
        'FormField.control',
        '(props: FormControlProps) => ReactNode',
        'Spread the provided ID, name, required, disabled and aria attributes on the control.',
      ),
      prop(
        'FormActions.primary / secondary / destructive',
        'ReactNode',
        'Action content slots; primary is required.',
      ),
      prop(
        'AutoSaveField.children',
        '(control: AutoSaveControl<T>) => ReactNode',
        'Use value/update, focus/blur and key handlers from the supplied control.',
      ),
      prop('AutoSaveField.ref', 'Ref<AutoSaveFieldHandle>', 'Imperative flush() handle.'),
      className,
    ],
    ['Import useForm from the React form module; createForm is a source-only export.'],
  ),
  collection: reference(
    "import { ListRow, ListView } from '@/components/patterns/collection';",
    `import { useState } from 'react';

const items = [{ id: 'one', name: 'First item' }, { id: 'two', name: 'Second item' }];

export function Example() {
  const [active, setActive] = useState('');
  return (
    <>
      <ListView items={items} getKey={(item) => item.id} getText={(item) => item.name}
        ariaLabel="Workspaces" onActivate={(item) => setActive(item.name)}
        row={({ item }) => <ListRow title={item.name} />} />
      <output className="block">{active}</output>
    </>
  );
}`,
    [
      prop(
        'ListView.items / getKey',
        'readonly T[] / (item: T, index: number) => ListKey',
        'Stable row identities.',
      ),
      prop(
        'ListView.row',
        '(context: ListRowContext<T>) => ReactNode',
        'Render a row using the supplied item, index and selection state.',
      ),
      prop(
        'ListView.onActivate',
        '(item: T, index: number) => void',
        'Keyboard and pointer activation.',
      ),
      prop(
        'ListView.selectedKeys / onSelectedKeysChange',
        'ListKey[] / (keys: ListKey[]) => void',
        'Controlled selection.',
      ),
      prop('ListView.virtualize', "boolean | 'auto'", 'Virtualized rendering mode.', "'auto'"),
      prop(
        'ListRow.title / leading / description / meta / trailing',
        'ReactNode',
        'Row content slots.',
      ),
      prop(
        'SectionedList.header / children',
        '(section: T, index: number) => ReactNode',
        'Section render props.',
      ),
      prop(
        'RowActions.overflowTriggerRef',
        'Ref<HTMLButtonElement | HTMLAnchorElement>',
        'Ref to the overflow trigger.',
      ),
      className,
    ],
  ),
  'action-menu': reference(
    "import { ActionBar, defineActions } from '@/components/patterns/action-menu';",
    `import { useState } from 'react';

const actions = defineActions([{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', destructive: true }]);

export function Example() {
  const [selected, setSelected] = useState('');
  return (
    <>
      <ActionBar actions={actions} visibleCount={1} overflowLabel="More actions" onAction={(id) => setSelected(id)} />
      <output className="block">{selected}</output>
    </>
  );
}`,
    [
      prop(
        'actions',
        'readonly ActionDefinition[]',
        'One definition drives inline, overflow and context actions.',
      ),
      prop(
        'onAction',
        '(id: string, event: Event) => void',
        'Native command event for pointer and keyboard activation.',
      ),
      prop(
        'ActionBar.visibleCount / overflowLabel',
        'number / string',
        'Inline action budget and required accessible overflow label.',
      ),
      prop(
        'ActionBar.overflowTriggerRef',
        'Ref<HTMLButtonElement | HTMLAnchorElement>',
        'Overflow control ref.',
      ),
      prop(
        'ActionMenu.trigger',
        '(state: { props: ComponentProps<typeof Menu.Trigger>; open: boolean }) => ReactElement',
        'Render a trigger and forward all supplied props/ref.',
      ),
      prop(
        'ActionMenu.contextMenu',
        '{ x: number; y: number; returnFocus?: HTMLElement | null }',
        'Pointer or keyboard context anchor instead of a trigger.',
      ),
      className,
    ],
  ),
  confirm: reference(
    "import { ConfirmHost, prompt } from '@/components/patterns/confirm';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [name, setName] = useState('');
  async function askName() {
    const value = await prompt({ title: 'Name', field: { label: 'Name', required: true } });
    if (value !== null) setName(value);
  }
  return (
    <>
      <ConfirmHost />
      <Button onClick={() => void askName()}>Choose name</Button>
      <output className="block">{name}</output>
    </>
  );
}`,
    [
      prop(
        'ConfirmHost',
        'component',
        'Mount once at the app root; isolated examples mount their own host.',
      ),
      prop(
        'confirm / prompt / alert',
        'async functions',
        'Resolve to boolean, string | null, or void respectively.',
      ),
      prop(
        'FormDialog.open / onOpenChange',
        'boolean / (open: boolean) => void',
        'Controlled dialog visibility.',
      ),
      prop(
        'FormDialog.onSubmit',
        '() => void | Promise<void>',
        'Submit callback; errors remain visible in the dialog.',
      ),
      prop('FormDialog.children / footer', 'ReactNode', 'Form and optional action slots.'),
      prop('ContentDialog.contentRef', 'Ref<HTMLDivElement>', 'Ref to the content surface.'),
      prop(
        'initialFocus',
        'HTMLElement | RefObject<HTMLElement | null> | null',
        'Initial focus target for FormDialog or ContentDialog.',
      ),
      prop(
        'DestructiveConfirm.onConfirm',
        '() => void | Promise<void>',
        'Confirm the destructive action.',
      ),
    ],
  ),
  screen: reference(
    "import { TakeoverScreen } from '@/components/patterns/screen';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/patterns/form';

export function Example() {
  const [account, setAccount] = useState('');
  const [connected, setConnected] = useState(false);
  return (
    <TakeoverScreen title={<h1>Connect account</h1>}
      primary={<Button disabled={!account.trim()} onClick={() => setConnected(true)}>Continue</Button>}>
      {connected ? <output className="block">Account connected</output> : (
        <FormField label="Account" control={(props) => <Input {...props} value={account} onChange={(event) => setAccount(event.currentTarget.value)} />} />
      )}
    </TakeoverScreen>
  );
}`,
    [
      prop(
        'TakeoverScreen.title / primary',
        'ReactNode',
        'Required title and primary action slots.',
      ),
      prop(
        'TakeoverScreen.children',
        'ReactNode',
        'Body content; the component owns height transitions.',
      ),
      prop('ScreenHeader.title / description / actions', 'ReactNode', 'Header content slots.'),
      prop('ScreenFooter.primary / secondary / destructive', 'ReactNode', 'Footer action slots.'),
      prop(
        'EmptyState.onAction / ErrorState.onRetry',
        '() => void',
        'Optional action or retry callback.',
      ),
      prop('LoadingState.label', 'string', 'Required accessible loading description.'),
      className,
    ],
  ),
  settings: reference(
    "import { defineSettings, SettingsForm } from '@/components/patterns/settings';",
    `import { useState } from 'react';

export function Example() {
  // Local demonstration state; production settings read selectors and dispatch to their owner.
  const [notifications, setNotifications] = useState(true);
  const schema = defineSettings({ sections: [{ id: 'general', title: 'General', entries: [
    { kind: 'switch', id: 'notifications', label: 'Notifications', description: 'Show workspace updates.',
      get: () => notifications, set: setNotifications },
  ] }] });
  return <SettingsForm schema={schema} compact={false} />;
}`,
    [
      prop(
        'SettingsForm.schema',
        'SettingsSchema',
        'Typed sections and entries from defineSettings.',
      ),
      prop(
        'entry.get / entry.set',
        '() => T / (value: T) => void | Promise<void>',
        'Read the current setting and route changes to its owner; avoid source Svelte stores.',
      ),
      prop(
        'SettingsForm.custom',
        'Record<string, (context: SettingsControlContext) => ReactNode>',
        'Custom entry render props with field accessibility context.',
      ),
      prop(
        'SettingsForm.descriptions',
        'Record<string, ReactNode | (() => ReactNode)>',
        'Optional rich descriptions.',
      ),
      prop(
        'SettingsForm.compact',
        'boolean',
        'Use false for settings page controls; standalone forms default to compact.',
        'true',
      ),
      prop('SettingsForm.searchQuery', 'string', 'Filter the schema by text.', "''"),
    ],
  ),
  'settings-field-row': reference(
    "import { SettingsFieldRow } from '@/components/ui/settings-field-row';",
    `import { useState } from 'react';
import { Switch } from '@/components/ui/switch';

export function Example() {
  const [checked, setChecked] = useState(true);
  return (
    <SettingsFieldRow id="alerts-setting" label="Alerts" description="Show workspace updates."
      control={({ labelId, descriptionId, disabled }) => (
        <Switch checked={checked} onCheckedChange={setChecked} ariaLabelledby={labelId} ariaDescribedby={descriptionId} disabled={disabled} />
      )} />
  );
}`,
    [
      prop('id / label', 'string', 'Required row identity and visible label.'),
      prop('htmlFor', 'string', 'ID of an externally named native control.'),
      prop(
        'control',
        '(context: SettingsFieldContext) => ReactNode',
        'Render the control using labelId, descriptionId, errorId, disabled and busy.',
      ),
      prop('descriptionContent', 'ReactNode | (() => ReactNode)', 'Optional rich description.'),
      prop('leading / children', 'ReactNode', 'Optional leading content and row body.'),
      className,
    ],
    ['For new product settings, prefer a SettingsForm schema entry over manual row composition.'],
  ),
  'settings-section': reference(
    "import { SettingsSection } from '@/components/ui/settings-section';",
    `import { SettingsForm, defineSettings } from '@/components/patterns/settings';
import { useState } from 'react';

export function Example() {
  const [name, setName] = useState('My workspace');
  const schema = defineSettings({ sections: [{ id: 'workspace-fields', title: 'Workspace', entries: [
    { kind: 'input', id: 'name', label: 'Name', get: () => name, set: setName },
  ] }] });
  return <SettingsSection title="Workspace" description="Manage workspace preferences."><SettingsForm schema={schema} embedded /></SettingsSection>;
}`,
    [
      prop('title / description', 'string', 'Section heading and supporting text.'),
      prop('busy / error', 'boolean / string', 'Section progress or error state.'),
      prop('actions', 'ReactNode', 'Header action slot.'),
      ...contentProps,
    ],
    ['SettingsForm normally owns section composition on product settings pages.'],
  ),
  'settings-page-shell': reference(
    "import { SettingsPageShell } from '@/components/ui/settings-page-shell';",
    `import { SettingsForm, defineSettings } from '@/components/patterns/settings';
import { useState } from 'react';

export function Example() {
  const [name, setName] = useState('My workspace');
  const schema = defineSettings({ sections: [{ id: 'general', title: 'General', entries: [
    { kind: 'input', id: 'name', label: 'Name', get: () => name, set: setName },
  ] }] });
  return <SettingsPageShell title="Settings" description="Manage workspace preferences." backHref="/sandbox"><SettingsForm schema={schema} compact={false} /></SettingsPageShell>;
}`,
    [
      prop('title / description', 'string', 'Page heading and supporting text.'),
      prop('navigation / footer / children', 'ReactNode', 'Page composition slots.'),
      prop(
        'onNavigationValueChange',
        '(value: string) => void',
        'Update the controlled navigationValue.',
      ),
      prop(
        'backHref / onBack',
        'string / MouseEventHandler<HTMLButtonElement>',
        'Navigate back or handle the back action.',
      ),
      className,
    ],
  ),
  'ask-user-questions': reference(
    "import { AskUserQuestions, type AskUserAnswer, type AskUserQuestion } from '@/components/ui/ask-user-questions';",
    `import { useState } from 'react';

const questions: AskUserQuestion[] = [
  { id: 'delivery', title: 'How should updates arrive?', options: [
    { id: 'alerts', title: 'Alerts', description: 'Receive each update.' },
    { id: 'summary', title: 'Summary', description: 'Receive a daily summary.' },
  ], allowOther: true },
  { id: 'notes', title: 'Anything else?', freeText: true, freeTextMultiline: true, skippable: true },
];

export function Example() {
  const [answers, setAnswers] = useState<Record<string, AskUserAnswer>>({});
  const [complete, setComplete] = useState(false);
  return (
    <>
      <AskUserQuestions questions={questions} answers={answers} onAnswersChange={setAnswers}
        onComplete={(result) => { setAnswers(result); setComplete(true); }} />
      {complete && <pre aria-label="Submitted answers">{JSON.stringify(answers, null, 2)}</pre>}
    </>
  );
}`,
    [
      prop('questions', 'AskUserQuestion[]', 'Stable IDs, option choices or free-text questions.'),
      prop(
        'answers / onAnswersChange',
        'Record<string, AskUserAnswer> / (answers) => void',
        'Controlled answers; defaultAnswers supports uncontrolled use.',
      ),
      prop(
        'currentIndex / onCurrentIndexChange',
        'number / (index: number, answers: Record<string, AskUserAnswer>) => void',
        'Controlled step; callback includes answers from the same interaction.',
      ),
      prop(
        'onComplete',
        '(answers: Record<string, AskUserAnswer>) => void',
        'Final collected answers.',
      ),
      prop('headerActions / footerActions', 'ReactNode', 'Rendered action slots.'),
      prop(
        'otherAttachments',
        '(questionId: string) => ReactNode',
        'Attachment presentation owned by the caller.',
      ),
      prop(
        'onOtherPaste',
        '(event: ClipboardEvent<HTMLTextAreaElement>, questionId: string) => void',
        'React clipboard event for the free-text answer.',
      ),
      className,
    ],
  ),
  'message-composer': reference(
    "import { MessageComposer } from '@/components/ui/message-composer';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [value, setValue] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  return (
    <>
      <MessageComposer value={value} onValueChange={setValue} files={files} onFilesChange={setFiles}
        placeholder="Write a message" suggestions={['Summarize the workspace', 'Review the changes']}
        leftSlot={({ openFilePicker }) => <Button onClick={() => openFilePicker()}>Attach</Button>}
        onSend={(text, attachments) => {
          setSent((previous) => [...previous, [text, ...attachments.map((file) => file.name)].join(' · ')]);
          setValue('');
          setFiles([]);
        }} />
      <ul aria-label="Sent messages">{sent.map((text, index) => <li key={index}>{text}</li>)}</ul>
    </>
  );
}`,
    [
      prop('value / onValueChange', 'string / (value: string) => void', 'Controlled draft text.'),
      prop('files / onFilesChange', 'File[] / (files: File[]) => void', 'Controlled attachments.'),
      prop(
        'onSend',
        '(value: string, files: File[], meta?: { queuedId?: string }) => void',
        'Accepted send or queued-message send.',
      ),
      prop(
        'leftSlot / rightSlot',
        '(context: MessageComposerSlotContext) => ReactNode',
        'Render actions using openFilePicker and the current files.',
      ),
      prop(
        'queue / onQueueChange',
        'QueuedMessage[] / (queue: QueuedMessage[]) => void',
        'Controlled queue while streaming.',
      ),
      prop(
        'status / onStop',
        "'idle' | 'streaming' / () => void",
        'Streaming state and stop action.',
        "'idle'",
      ),
      prop(
        'textareaProps',
        "MessageComposerProps['textareaProps']",
        'Pass allowed textarea attributes, including accessible labels; draft, key, disabled and ref ownership stays inside the composer.',
      ),
      className,
    ],
  ),
  portal: reference(
    "import { Portal } from '@/components/ui/portal';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  return (
    <>
      <Button onClick={() => setVisible((value) => !value)}>Toggle portal content</Button>
      <div ref={setTarget} aria-label="Portal destination" />
      {target && visible && <Portal target={target}><output className="block">Rendered in the portal destination</output></Portal>}
    </>
  );
}`,
    [
      prop('target', 'string | HTMLElement', 'Target selector or element.', "'body'"),
      prop(
        'zIndex',
        'number | string',
        'Portal stacking value; usually leave the component default.',
        '10',
      ),
      children,
    ],
  ),
  'relative-time': reference(
    "import { RelativeTime } from '@/components/ui/relative-time';",
    `export function Example({ updatedAt }: { updatedAt: string }) {
  return <p>Updated <RelativeTime date={updatedAt} /></p>;
}`,
    [
      prop(
        'date',
        'Date | string | number',
        'Required instant to format; the component refreshes relative text over time.',
      ),
      prop('compact', 'boolean', 'Compact relative text.', 'false'),
      prop('title', 'string', 'Optional full-date tooltip override.'),
      className,
    ],
  ),
  'animated-number': reference(
    "import { AnimatedNumber } from '@/components/ui/animated-number';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [value, setValue] = useState(10);
  return <div><AnimatedNumber value={value} /><Button onClick={() => setValue((number) => number + 10)}>Add ten</Button></div>;
}`,
    [
      prop('value', 'number', 'Target number; motion responds to updates.'),
      prop(
        'format',
        '(value: number, secondaryValue?: number) => string',
        'Optional formatter; default uses the shared locale formatter.',
      ),
      prop('tier', 'SpringTierName', 'Shared motion preset.', "'slow'"),
      prop(
        'accessible / pulse',
        'boolean',
        'Announce the value and optionally pulse on updates.',
        'true',
      ),
      className,
    ],
  ),
  'editable-name': reference(
    "import { EditableName } from '@/components/ui/editable-name';",
    `import { useState } from 'react';

export function Example() {
  const [name, setName] = useState('My workspace');
  return <EditableName value={name} onSave={setName} />;
}`,
    [
      prop('value', 'string', 'Current name.'),
      prop('onSave', '(newValue: string) => void', 'Commit the edited name to its owner.'),
      prop('disabled', 'boolean', 'Prevent editing.', 'false'),
      prop('maxWidth', 'number', 'Maximum name width in pixels.', '200'),
      className,
    ],
  ),
  'github-avatar': reference(
    "import { GitHubAvatar } from '@/components/ui/github-avatar';",
    `export function Example({ login, avatarUrl }: { login: string; avatarUrl?: string | null }) {
  return <div><GitHubAvatar identity={login} avatarUrl={avatarUrl} /><span>{login}</span></div>;
}`,
    [
      prop(
        'identity',
        'string',
        'GitHub identity used to construct an avatar URL when none is supplied.',
      ),
      prop(
        'avatarUrl',
        'string | null',
        'Optional URL overriding the identity-based GitHub image.',
      ),
      prop('fallback', 'ReactNode', 'Custom fallback when there is no usable image.'),
      prop('size', 'number', 'Avatar size in pixels.', '16'),
      className,
    ],
  ),
  'hover-card': reference(
    "import { HoverCard } from '@/components/ui/hover-card';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [anchor, setAnchor] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <>
      <Button ref={setAnchor} aria-describedby={hovered || focused ? 'workspace-details' : undefined}
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>Workspace details</Button>
      <HoverCard id="workspace-details" anchor="--workspace-trigger" anchorElement={anchor} position="bottom"
        open={hovered || focused}><p>Workspace activity and shared settings.</p></HoverCard>
    </>
  );
}`,
    [
      prop('anchor', 'string', 'CSS anchor name; required even when anchorElement is supplied.'),
      prop('anchorElement', 'HTMLElement | null', 'Explicit trigger element for positioning.'),
      prop(
        'open',
        'boolean',
        'Caller owns hover/focus/dismissal; keep mounted for exit motion.',
        'true',
      ),
      prop(
        'position',
        "'right' | 'bottom' | 'bottom-right' | 'bottom-left' | 'top'",
        'Placement preference.',
        "'right'",
      ),
      prop(
        'onMouseEnter / onMouseLeave / onFocus / onBlur',
        'React mouse/focus event handlers',
        'Optional interaction policy on the card surface.',
      ),
      ...contentProps,
    ],
  ),
  'virtual-list': reference(
    "import { VirtualList } from '@/components/ui/virtual-list';",
    `const items = Array.from({ length: 1000 }, (_, index) => ({ id: index, name: 'Row ' + (index + 1) }));

export function Example() {
  return (
    <VirtualList items={items} getKey={(item) => item.id} itemHeight={50} containerHeight={400}>
      {({ item }) => <div className="flex h-full items-center">{item.name}</div>}
    </VirtualList>
  );
}`,
    [
      prop('items', 'readonly T[]', 'Rows to virtualize.'),
      prop('getKey', '(item: T, index: number) => Key', 'Stable row identity.'),
      prop(
        'children',
        '(row: { item: T; index: number }) => ReactNode',
        'Row render prop, not plain children.',
      ),
      prop(
        'itemHeight / containerHeight',
        'number',
        'Fixed row and viewport heights in pixels.',
        '50 / 400',
      ),
      prop('overscan', 'number', 'Extra rows around the visible range.', '3'),
    ],
  ),
  'tooltip-rich': reference(
    "import { TooltipRich } from '@/components/ui/tooltip-rich';",
    `import { Button } from '@/components/ui/button';

export function Example() {
  return (
    <TooltipRich title="Workspace access" description="Collaborators can view shared notes." variant="info">
      <Button>Access details</Button>
    </TooltipRich>
  );
}`,
    [
      prop('title / description', 'string', 'Structured tooltip content.'),
      prop(
        'content / footer / children / trigger',
        'ReactNode',
        'Custom content, footer and trigger slots.',
      ),
      prop('icon', 'Icon', 'Phosphor React icon component, not a rendered node.'),
      openChange,
      prop(
        'onClose',
        '() => void',
        'Close-button callback; controlled callers also set open to false.',
      ),
      prop(
        'onClick',
        'MouseEventHandler<HTMLSpanElement>',
        'React click event on the wrapper trigger.',
      ),
      prop('interactive', 'boolean', 'Enable interaction with tooltip content.', 'false'),
      className,
    ],
  ),
  'sidebar-context-menu': reference(
    "import { SidebarContextMenu, SidebarOverflowMenu, getSidebarContextPosition, type SidebarContextPosition } from '@/components/ui/sidebar-context-menu';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [position, setPosition] = useState<SidebarContextPosition | null>(null);
  const [selected, setSelected] = useState('');
  const items = [{ id: 'rename', label: 'Rename', onClick: () => setSelected('Rename') }];
  return (
    <>
      <Button onContextMenu={(event) => {
        event.preventDefault();
        setPosition(getSidebarContextPosition(event));
      }} onKeyDown={(event) => {
        const next = getSidebarContextPosition(event);
        if (next) { event.preventDefault(); setPosition(next); }
      }}>Workspace</Button>
      <SidebarOverflowMenu items={items} ariaLabel="Workspace actions" />
      {position && <SidebarContextMenu {...position} items={items} onClickOutside={() => setPosition(null)} />}
      <output className="block">{selected}</output>
    </>
  );
}`,
    [
      prop(
        'items',
        'SidebarMenuEntry[]',
        'Commands, checked choices, labels, separators and submenus.',
      ),
      prop('items[].onClick', '() => void', 'Command callback; not a DOM event handler.'),
      prop(
        'SidebarContextMenu.x / y / returnFocus',
        'number / number / HTMLElement | null',
        'Anchor coordinates and focus-restoration target.',
      ),
      prop(
        'SidebarContextMenu.onClickOutside',
        '() => void',
        'Dismiss the caller-owned context menu.',
      ),
      prop(
        'SidebarOverflowMenu.onOpenChange',
        '(open: boolean) => void',
        'Control overflow-menu visibility.',
      ),
      prop(
        'getSidebarContextPosition',
        '(event: MouseEvent | KeyboardEvent | React mouse/key event) => position | null',
        'Derive pointer and keyboard context anchors.',
      ),
    ],
  ),
  'panel-find-bar': reference(
    "import { PanelFindBar } from '@/components/ui/panel-find-bar';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

const rows = ['Workspace overview', 'Workspace activity', 'Settings'];

export function Example() {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);
  const matches = query ? rows.filter((row) => row.toLowerCase().includes(query.toLowerCase())) : [];
  function move(direction: number) {
    if (matches.length) setIndex((current) => (current + direction + matches.length) % matches.length);
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>Find</Button>
      {open && <PanelFindBar layout="inline" query={query} currentMatchIndex={index} totalMatches={matches.length}
        onQueryChange={(value) => { setQuery(value); setIndex(0); }}
        onPrevious={() => move(-1)} onNext={() => move(1)} onClose={() => setOpen(false)} />}
      <output className="block">{matches[index] ?? ''}</output>
    </>
  );
}`,
    [
      prop(
        'query / onQueryChange',
        'string / (query: string, event: FormEvent<HTMLInputElement>) => void',
        'Controlled query; matching remains caller-owned.',
      ),
      prop(
        'currentMatchIndex / totalMatches',
        'number',
        'Zero-based active result index and total result count.',
      ),
      prop(
        'onPrevious / onNext',
        '(query: string, event: React.MouseEvent | React.KeyboardEvent) => void',
        'Navigate results.',
      ),
      prop(
        'onClose',
        '(event: React.MouseEvent | React.KeyboardEvent) => void',
        'Dismiss the find bar.',
      ),
      prop(
        'onKeydown',
        'KeyboardEventHandler<HTMLInputElement>',
        'Retains this exact source-compatible spelling; event is a React keyboard event.',
      ),
      prop('inputRef', 'Ref<HTMLInputElement>', 'Native input ref.'),
      prop('ref', 'Ref<PanelFindBarHandle>', 'Imperative focus(), blur() and select() handle.'),
      className,
    ],
  ),
  'smart-corner-tabs': reference(
    "import { SmartCornerTabs } from '@/components/ui/smart-corner-tabs';",
    `import { useState } from 'react';

const tabs = [{ id: 'overview', label: 'Overview' }, { id: 'activity', label: 'Activity' }];

export function Example() {
  const [activeTabId, setActiveTabId] = useState('overview');
  return (
    <SmartCornerTabs tabs={tabs} activeTabId={activeTabId} onTabChange={setActiveTabId} ariaLabel="Workspace views">
      {(tab) => <p>{tab.id === 'overview' ? 'Workspace overview' : 'Recent activity'}</p>}
    </SmartCornerTabs>
  );
}`,
    [
      prop('tabs', 'SmartCornerTab[]', 'IDs, labels and optional disabled states.'),
      prop(
        'activeTabId / onTabChange',
        'string / (tabId: string) => void',
        'Controlled active tab.',
      ),
      prop('children', '(tab: SmartCornerTab) => ReactNode', 'Render the active tab panel.'),
      prop('panelId / ariaLabel', 'string', 'Panel identity and accessible tab-list name.'),
      className,
    ],
  ),
  'searchable-combobox': reference(
    "import { SearchableCombobox } from '@/components/ui/searchable-combobox';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example() {
  const [value, setValue] = useState('alpha');
  const [options, setOptions] = useState([{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }]);
  return (
    <SearchableCombobox ariaLabel="Workspace" value={value} onChange={setValue} options={options}
      onRename={(option, name) => setOptions((items) => items.map((item) => item.value === option.value ? { ...item, label: name } : item))}
      itemActions={({ startRename }) => <Button onClick={(event) => { event.stopPropagation(); startRename(); }}>Rename</Button>} />
  );
}`,
    [
      prop(
        'value / onChange',
        'string / (value: string, option?: Option, event?: MouseEvent) => void',
        'Controlled selection; optional native event may be absent.',
      ),
      prop(
        'itemActions',
        '(context: ItemActionContext) => ReactNode',
        'Option actions with startRename, cancelRename and commitRename.',
      ),
      prop(
        'onRename',
        '(option: Option, newName: string) => void',
        'Commit a renamed option to its owner.',
      ),
      prop('inputRef', 'Ref<HTMLInputElement>', 'Search input ref.'),
      openChange,
      className,
    ],
    [
      'Compatibility wrapper: prefer Combobox for new selection flows. onDelete alone does not render a delete action; supply it through itemActions.',
    ],
  ),
  'media-lightbox': reference(
    "import { MediaLightbox } from '@/components/ui/media-lightbox';",
    `import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function Example({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  return (
    <>
      <Button ref={setOpener} onClick={() => setOpen(true)}>Open image</Button>
      <MediaLightbox open={open} onOpenChange={setOpen} ariaLabel="Image preview" closeLabel="Close image preview"
        openerElement={opener} caption={alt}>
        <img src={src} alt={alt} />
      </MediaLightbox>
    </>
  );
}`,
    [
      prop(
        'open / onOpenChange',
        'boolean / (open: boolean) => void',
        'Controlled visibility; dismissal also closes the local view.',
      ),
      prop('ariaLabel / closeLabel', 'string', 'Required dialog and close-button names.'),
      prop('openerElement', 'HTMLElement | null', 'Connected element to restore focus to.'),
      prop(
        'onKeydown / onCopy',
        '(event: KeyboardEvent) => void / (event: ClipboardEvent) => void',
        'Native DOM events, not React synthetic events; onKeydown retains its source spelling.',
      ),
      prop('actions / children', 'ReactNode', 'Toolbar actions and media content.'),
      prop('onClose', '() => void', 'Dismissal notification.'),
    ],
  ),
  'zoom-pan-viewport': reference(
    "import { ZoomPanViewport, type ZoomPanViewportHandle } from '@/components/ui/zoom-pan-viewport';",
    `import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { MediaLightbox } from '@/components/ui/media-lightbox';

export function Example({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const viewport = useRef<ZoomPanViewportHandle>(null);
  return (
    <>
      <Button ref={setOpener} onClick={() => setOpen(true)}>Open zoomable image</Button>
      <MediaLightbox open={open} onOpenChange={setOpen} ariaLabel="Image preview" closeLabel="Close image preview"
        openerElement={opener} onKeydown={(event) => { viewport.current?.handleKeydown(event); }}>
        <ZoomPanViewport ref={viewport}><img src={src} alt={alt} /></ZoomPanViewport>
      </MediaLightbox>
    </>
  );
}`,
    [
      prop(
        'ref',
        'Ref<ZoomPanViewportHandle>',
        'handleKeydown(nativeEvent) returns whether a zoom shortcut was consumed.',
      ),
      prop('minZoom / maxZoom', 'number', 'Scale limits.', '0.25 / 8'),
      prop('onScaleChange', '(scale: number) => void', 'Observe the committed scale.'),
      children,
    ],
  ),
  'shimmer-overlay': reference(
    "import { ShimmerOverlay } from '@/components/ui/shimmer-overlay';",
    `export function Example() {
  return (
    <>
      <ShimmerOverlay>Preparing workspace</ShimmerOverlay>
      <div className="relative" aria-busy="true"><p>Loading preview</p><ShimmerOverlay /></div>
    </>
  );
}`,
    [
      prop(
        'children',
        'ReactNode',
        'Text shimmer when supplied; omitting children renders an overlay in a positioned parent.',
      ),
      prop(
        'duration',
        'number',
        'Animation duration in seconds; reduced motion is handled by the component.',
        '8',
      ),
      className,
    ],
  ),
};

export function getReactCatalogReference(entry: CatalogEntry): ReactCatalogReference {
  const slug = entry.slug === 'spinner' ? 'loading-indicator' : entry.slug;
  const found = references[slug];
  if (!found) {
    return {
      status: 'pending',
      props: [],
      notes: [
        'React usage documentation is pending for this family. No React import or example is advertised.',
      ],
    };
  }
  return {
    status: 'implemented',
    ...found,
    notes: [
      ...found.notes,
      ...(!entry.usage
        ? [
            'The source metadata does not provide a usage snippet. This React example follows the implemented component API and reference fixture purpose.',
          ]
        : []),
    ],
  };
}
