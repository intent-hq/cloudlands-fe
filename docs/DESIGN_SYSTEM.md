# Design System

Use this guide before changing product styling or theme behavior. The canonical token source is
[`src/lib/styles/tokens.css`](../src/lib/styles/tokens.css); do not create another product-facing
token vocabulary in a component, feature stylesheet, or theme adapter.

## I need to…

Start with a pattern, not a primitive. The generated
[cheatsheet](DESIGN_SYSTEM_CHEATSHEET.md) has the complete public API summary, and
[`/sandbox/recipes`](../src/routes/sandbox/recipes/+page.svelte) renders copyable full compositions.

### …notify the user

Import `notify` from `$lib/components/patterns/notify`; inspect [the notify source](../src/lib/components/patterns/notify) and preview at `/sandbox/notify`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { notify } from '$lib/components/patterns/notify';
</script>
<Button onclick={() => notify.success('Saved')}>Save</Button>
<!-- Mount the app's existing toast host once, not per caller. -->
```

### …ask a blocking question

Import `prompt` and `ConfirmHost` from `$lib/components/patterns/confirm`; inspect
[the confirm source](../src/lib/components/patterns/confirm) and preview at `/sandbox/confirm`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { ConfirmHost, prompt } from '$lib/components/patterns/confirm';
  const askName = () => prompt({ title: 'Name', field: { required: true } });
</script>
<ConfirmHost />
```

### …add a setting

Import `defineSettings` and `SettingsForm` from `$lib/components/patterns/settings`; inspect
[the settings source](../src/lib/components/patterns/settings) and preview at `/sandbox/settings`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { defineSettings, SettingsForm } from '$lib/components/patterns/settings';
  const schema = defineSettings({ sections: [{ id: 'general', title: 'General', entries }] });
</script>
<SettingsForm {schema} />
```

### …list things

Import `ListView` and `ListRow` from `$lib/components/patterns/collection`; inspect
[the collection source](../src/lib/components/patterns/collection) and preview at `/sandbox/collection`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  const items = [{ id: 'one', name: 'First item' }];
</script>
<ListView {items} getKey={(item) => item.id}>{#snippet row({ item })}<ListRow>{#snippet title()}{item.name}{/snippet}</ListRow>{/snippet}</ListView>
```

### …build a screen or takeover

Import `TakeoverScreen` from `$lib/components/patterns/screen`; inspect
[the screen source](../src/lib/components/patterns/screen) and preview at `/sandbox/screen`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { TakeoverScreen } from '$lib/components/patterns/screen';
</script>
{#snippet title()}<h1>Connect account</h1>{/snippet}{#snippet primary()}<Button>Continue</Button>{/snippet}
<TakeoverScreen {title} {primary}><AccountStep /></TakeoverScreen>
```

### …add row or overflow actions

Import `ActionBar` and `defineActions` from `$lib/components/patterns/action-menu`; inspect
[the action-menu source](../src/lib/components/patterns/action-menu) and preview at `/sandbox/action-menu`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { ActionBar, defineActions } from '$lib/components/patterns/action-menu';
  const actions = defineActions([{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' }]);
</script>
<ActionBar {actions} visibleCount={1} onAction={runAction} />
```

Use `ActionMenu` from the same public subpath for a complete menu. `actions` is a
readonly `ActionDefinition[]`; `ariaLabel` names the menu, `trigger` renders its trigger,
and `onAction(id, event)` dispatches the selected leaf. For pointer-anchored invocation,
pass `contextMenu: { x, y, returnFocus }` instead of a trigger. Build the action model
once for both invocation paths; do not maintain separate right-click and overflow trees.

### …choose a value or search options

Use `Select` for a short, closed set of values and `Combobox` from
`$lib/components/ui/combobox` for searchable, grouped, remote, or multiple choices.
Give the trigger a purpose-specific accessible name; the selected value and search
placeholder are not substitutes for that name. `Combobox` requires `ariaLabel` and also
accepts `ariaLabelledby` and `ariaDescribedby` for field integration.

`onsearch(query)` may return options or groups synchronously or asynchronously. Supply
localized `emptyText`, `errorText`, and `retryText` where the default is insufficient;
`onsearcherror(error, query)` reports a rejected request without turning it into an empty
result. Status messages and retry controls live outside the option collection. Closing,
clearing, or selecting invalidates pending searches; selected labels survive filtering.
Single selection closes, multiple selection stays open. Preserve each option's stable
`value` and optional metadata, rather than looking up a selected option in filtered results.
`onchange(value, option?)` reports value changes; `oncommit(value, option)` reports accepted
user activation, including explicit reselection of the current single value. Reselection
does not clear that value. Use `oncommit` instead of a second `onchange` handler when a
domain action must run once for both changed and unchanged acceptance.
For a compact Popover-hosted picker, use `staticPosition` and `bind:inputRef` so the Popover's
open-focus handler can focus the shared search input. Binding the reference does not change
the default focus behavior. `staticPosition` changes layout only; the host still owns
dismissal. Coordinate `onopenchange(false)` or the existing shared Escape layer with the
host so one Escape closes the picker and returns focus without dismissing its parent.
Keep group actions outside selectable options; use
`ComboboxGroup.collapsed` to hide options without discarding their selected identities.

### …show empty, loading, or error state

Import `EmptyState`, `LoadingState`, and `ErrorState` from `$lib/components/patterns/screen`; inspect
[the screen source](../src/lib/components/patterns/screen) and preview at `/sandbox/screen`.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { EmptyState, ErrorState, LoadingState } from '$lib/components/patterns/screen';
</script>
{#if status === 'loading'}<LoadingState recipe="list" />
{:else if error}<ErrorState message={error} />{:else}<EmptyState {title} />{/if}
```

### …animate something

Import shared transitions from `$lib/motion`; inspect the live motion examples in
[`/sandbox`](../src/routes/sandbox/+page.svelte).

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { crispOut, springIn } from '$lib/motion';
</script>
{#if open}<section in:springIn={{ tier: 'moderate' }} out:crispOut={{ tier: 'fast' }}>Content</section>{/if}
<!-- Use duration-spring-* only for class transitions. -->
```

## Never

- Never transform labels to all capitals; use sentence case without extra letter spacing. `intent/no-uppercase` rejects Tailwind `uppercase` classes and CSS `text-transform: uppercase` in renderer components and stylesheets. Preserve meaningful acronyms and initials.

- Never use raw `text-xs`, `text-sm`, `text-base`, or `text-lg` in settings surfaces; use `type-caption` for compact controls, navigation and short metadata, `type-body` for messages, documents, explanatory copy and expanded form content, and `type-title` / `type-display` for section / page headings. Pair `font-medium!` with a `type-*` role on the same element. `intent/no-raw-typography` enforces this in settings components, routes and patterns.

- Never add raw `<button>`, `<input>`, `<select>`, or `<textarea>` controls; use their UI primitives.
- Never render an icon-only `Button` (icon child only, or `iconOnly`) without an icon size (`size="icon"`, `icon-compact`, `icon-sm`, `icon-lg`); `intent/icon-only-button-size` enforces this.
- Never hand-roll a command-menu shell or row; use canonical `Menu.Content` and semantic
  `Menu.Item`, `Menu.CheckboxItem`, or `Menu.RadioItem`. Internal adapters must apply the
  shared `menuOverlay()` and `menuItem()` recipes; decorative checks do not provide semantics.
- Never import `svelte-sonner` directly; route transient feedback through `notify`.
- Never call `window.alert`, `window.confirm`, or `window.prompt`; use the Confirm pattern.
- Never import `svelte/motion` or `svelte/transition` outside `$lib/motion`.
- Never use arbitrary or Tailwind-scale duration/easing utilities (`duration-300`, `ease-out`), or arbitrary background/text-color utilities; use semantic tokens.
- Never mount `Dialog.Root` directly in a feature; use `FormDialog` or the Confirm service.
- Never hand-compose settings row layout from primitives; use `SettingsFieldRow` for bespoke controls, or define a schema and render `SettingsForm` for a settings section.

## Default surface choices

Use exactly three default choices when composing a page:

| Choice            | When to use                                                                          | Semantic background |
| ----------------- | ------------------------------------------------------------------------------------ | ------------------- |
| Canvas            | The page background and ordinary content; group related controls with spacing first. | `bg-background`     |
| Contained section | A distinct group that needs one enclosing boundary, such as a panel or card.         | `bg-card`           |
| Floating overlay  | Temporary content above the page, such as a menu, popover or tooltip.                | `bg-popover`        |

Use one enclosing boundary per group. Do not wrap an already contained section in another
bordered or shadowed surface just to group it. Internal surface levels 1–8 and their helpers
remain available for compatibility; they are not additional default composition choices.

## Choose a semantic role

| Intent                 | Approved token or utility                                  | Example                  | Do not use                     |
| ---------------------- | ---------------------------------------------------------- | ------------------------ | ------------------------------ |
| Canvas                 | `--background`, `bg-background`, `text-foreground`         | Main content             | `bg-white`, `dark:bg-gray-900` |
| Contained section      | `--card`, `bg-card`, `text-card-foreground`                | Panel or card            | Raw neutral palette            |
| Floating overlay       | `--popover`, `bg-popover`, `text-popover-foreground`       | Menu or tooltip          | Adapter variables              |
| Primary action         | `--primary`, `bg-primary`, `text-primary-foreground`       | Default button           | Brand or source-theme colors   |
| Secondary action       | `--secondary`, `bg-secondary`, `text-secondary-foreground` | Secondary button         | Raw neutral palette            |
| Hover preview          | `--hover`, `bg-hover`                                      | Hovered or nearest row   | Hard-coded alpha colors        |
| Pressed UI             | `--active`, `bg-active`                                    | Pointer-down control     | Hard-coded alpha colors        |
| Selected UI            | `--selected`, `bg-selected`                                | Selected row or tab      | Reusing hover colors           |
| Emphasized UI          | `--accent`, `bg-accent`, `text-accent-foreground`          | Solid active surface     | Physical palette colors        |
| Low-emphasis UI        | `--muted`, `bg-muted`, `text-muted-foreground`             | Supporting text          | `text-gray-*`                  |
| Danger state           | `--danger`, `--danger-background`, `text-danger`           | Delete/error             | `red-*`                        |
| Informational state    | `--info`, `text-info`                                      | Saving/help state        | `blue-*`                       |
| Success state          | `--success`, `text-success`                                | Saved/complete state     | `green-*`                      |
| Warning state          | `--warning`, `text-warning`                                | Unsaved/caution state    | `amber-*`, `yellow-*`          |
| Decorative boundary    | `--border`, `--sidebar-border`                             | Card/list hairline       | Using it as control focus      |
| Control boundary/focus | `--input`, `--ring`                                        | Input hover/focus border | Outer input focus rings        |
| Keyboard focus         | `--focus-ring` (alias of `--ring`)                         | Non-input control ring   | Fixed gray/blue colors         |
| Foreground overlay     | `--overlay`                                                | Scrim/overlay alpha base | Theme-specific branches        |
| Navigation chrome      | `--sidebar*`, `bg-sidebar`                                 | Sidebar only             | VS Code panel variables        |
| Inert texture          | `--surface-hatch`                                          | Empty/board region       | Component-owned stripe colors  |

Use a role's `*-foreground` partner when text is rendered on a solid semantic background. Alpha
variants such as `bg-success/20` may use `text-success` when the surrounding theme surface remains
the effective background.

## Non-color scales

- Typography: use only five visual roles: `.type-caption`, `.type-body`, `.type-title`,
  `.type-display`, and `.type-code`. Use medium weight on the same role for emphasis instead of
  inventing another size. Label, body-strong, and display-large tokens are compatibility aliases,
  not additional styles. Caption is the compact-UI role for controls, navigation and short metadata;
  body is the reading role for messages, documents, explanatory copy and expanded form content.
  Use sentence case; avoid uppercase section labels, tracking changes, and bold as decoration.
  Do not change typography on hover by default; reserve motion for state and spatial relationships.
  The bundled Inter variable Latin weight face keeps the existing Inter/system fallback stack.
  Preserve the separate JetBrains Mono/system monospace boundary.

| Use                                                                        | Value (size / line height) | Weight                                    |
| -------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| Compact controls, navigation, short metadata (`type-caption`)              | 13px / 18px                | 400; 500 for selection or label emphasis  |
| Messages, documents, explanatory copy, expanded form content (`type-body`) | 15px / 22px                | 400; 500 for emphasis                     |
| Section title (`type-title`)                                               | 17px / 24px                | 500                                       |
| Page title (`type-display`)                                                | 22px / 28px                | 500                                       |
| Code (`type-code`)                                                         | 13px / 20px                | 400; monospace only where content is code |

Badge is a narrow microtext exception: `badge.variants.ts` retains `text-[12px]` for default
and `text-[11px]` for compact badges, both medium weight, to preserve the existing dense status
chip proportions. These are not new general typography roles; do not copy them into controls or
navigation. `scripts/design-token-allowlist.json` caps this file at those two arbitrary utilities.

- Spacing: `--space-{1..7}` follows a 4/8/12/16/24/32/48px rhythm. Use
  `--content-measure-{reading,form,wide}` for editorial copy, settings, and broad workspaces.
- Controls: compact/small/medium/large resolve to 28/28/32/36px. Compact is a density alias, not a
  smaller public control size.
- Shape and elevation: `--radius-{small,medium,large}` all resolve to 8px. `--elevation-raised` is a quiet
  one-pixel lift; `--elevation-overlay` is reserved for floating overlays.
- Motion: use `--spring-{fast,moderate,slow}` (80/160/240ms) with the matching
  `--spring-*-ease`, or Tailwind `duration-spring-*` and `ease-spring-*`. Exits use the shorter
  `--spring-*-exit` / `duration-spring-*-exit` tweens. Existing `--motion-*` and `--ease-*` names
  remain compatibility aliases; preserve reduced-motion behavior.
- Layers: `--layer-{base,sticky,chrome,popover,modal,toast,tooltip,drag-overlay}`.
- Texture: `--surface-hatch` is the only shared diagonal recipe. It derives from background, muted,
  and border roles, so it resolves in light, dark, preset, and imported themes without branching.

Prefer the existing Tailwind utility mapped to a token. Use `var(--token)` in component CSS only
when no mapped utility expresses the property.

### Input focus treatment

Caret-bearing text entries (`Input`, `Textarea`) and editor surfaces (TipTap, `AutoSaveTextarea`)
show no visible focus treatment: the caret indicates focus. The `noFocusStyle` compatibility prop
is limited to those editable surfaces. Composite and trigger elements (file pickers, copy actions,
comboboxes, dropdowns, expandable search buttons, and tab headers) retain one keyboard-only
`:focus-visible` indicator using `--focus-ring`, on the focusable element or its owning composite.

The default light foundation uses a warm editorial canvas, white raised and overlay surfaces,
forest foregrounds, sage selections, green actions/success, and violet information/focus. Dark mode
keeps the same ordering with a deep forest canvas and progressively lifted card/popover surfaces.
These family descriptions are design intent, not permission to add physical palette utilities.

## Component ownership and metadata

Use this decision tree before adding or moving a component:

1. If it provides one host- and domain-independent interaction or semantic element, it is a
   **primitive** under `src/lib/components/ui/<component>/`.
2. If it composes primitives into reusable presentation without Redux, AppClient, Electron/Tauri,
   services, or feature state, it is a **pattern** under `src/lib/components/ui/`.
3. If it knows workspaces, agents, providers, diffs, panels, app state, or host APIs, it is a
   **product component** owned by the relevant feature. Do not place it in the primitive namespace.
4. Keep a **deprecated wrapper** only while named callers migrate to its recorded replacement.
   Mark an item as a **deletion candidate** only after both static and dynamic imports reach zero.

The authoritative inventory and runtime schema are
`scripts/ui-component-inventory.ts` and `src/lib/components/ui/component-metadata.ts`. Every public
UI module records its category, owner, exported names, production callers, replacement,
characterization test, measurable removal gate, dynamic imports, and catalog fixture metadata.
The audit discovers local barrels, direct component imports, legacy deep imports, callers, and
dynamic imports from source; do not maintain a second prose inventory.

### Option and list rows

Choose the row family by purpose; do not impose one height on every row.

| Family          | Height rule                                                                                                                                                                           | Title, icon, and action alignment                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Navigation rows | Compact 28px or regular 32px, using the navigation row tokens in `app.css`; use `type-caption`.                                                                                       | Keep the title, leading icon, and trailing action on the same primary line.                                               |
| Content rows    | Content-driven and potentially multiline. `collection/ListRow` keeps 36px compact / 48px regular minimum heights, with room to grow; its title and short metadata use `type-caption`. | Keep title and inline metadata on a shared text baseline; center icon and action slots against the content block.         |
| Setting rows    | Content-driven label/control/description tiers, using `SettingsFieldRow`; expanded form content uses `type-body`.                                                                     | Align the label and control on the primary tier, with the description below; keep icons and actions aligned to that tier. |

The shared baseline rule is to align titles, icons, and actions within the primary row or tier;
secondary copy must not introduce an independent title or action offset. Multiline content may
grow the row instead of clipping it to a navigation height.

### Compact command menus

Use `Menu.CommandItem` for conventional right-click/dropdown action rows that pair a leading icon
with an optional trailing keyboard shortcut. Keep labels short and verb-led, group related commands
with `Menu.Separator`, and use canonical `Menu.Root`, `Menu.Trigger`, and `Menu.Content` rather than
the deprecated dropdown compatibility wrapper in new callers.

For an unavailable command, `Menu.CommandItem` accepts a localized `disabledReason`.
Providing it disables activation and renders explanatory text linked by `aria-describedby`;
an existing description reference is preserved. Do not rely on color alone to explain why
a command is unavailable.

The public `menuOverlay()` recipe from `$lib/components/ui/menu` supplies the same shell
for adapters that cannot use `Menu.Content`; `menuItem()` supplies row anatomy. Prefer
the semantic components in feature code. Recipes provide styling, not keyboard, focus,
checked-state, or dismissal behavior.

`Menu.Indicator` owns the trailing glyph, slot, and decorative `aria-hidden` contract for
menus and value pickers. Its `state` is `checked`, `mixed`, `submenu`, or `empty`; keep the
empty state rendered to reserve the same trailing space. It accepts optional `data-slot`,
`class`, and span attributes. It is decoration only: the host still owns `aria-checked`
or `aria-selected`. Do not recreate check/minus/chevron glyphs in feature rows.

#### One action model, two invocation paths

The [ActionMenu renderer](../src/lib/components/patterns/action-menu/ActionMenu.svelte)
owns both trigger- and pointer-anchored menus. Its action kinds are `action`, `checkbox`,
`radio-group` (with `radio` children), `submenu`, `section`, and `label`. Use a checkbox for an
independent setting and a radio group for one choice among alternatives. Commands close
by default; checkbox and radio choices remain open unless `closeOnSelect` requests otherwise.
`when` controls visibility; `disabled` and localized `disabledReason` retain unavailable
commands without invoking them. Stable IDs and optional `commandId` distinguish action
identity from translated labels. Keep IDs unique and never duplicate a command in one scope.

Use `kind: 'label'` for passive metadata, not a disabled command. It renders as `Menu.Label`
and is excluded from ActionBar inline buttons. The sidebar compatibility model accepts
`{ type: 'label', label, id? }` for the same non-actionable content.

Existing `SidebarContextMenu` and `SidebarOverflowMenu` adapters translate the same
`SidebarMenuEntry[]` into that renderer. Checked compatibility entries become checkbox
items; a submenu with `selection: 'single'` becomes an exclusive radio group. Use
`getSidebarContextPosition(event)` from `$lib/components/ui/sidebar-context-menu/types` for
both `contextmenu` and keyboard events: it recognizes Shift+F10 and the context-menu key
and records the invoking element. Pass that `returnFocus` through to the context adapter.
Do not call `stopImmediatePropagation()` or replace the shared keyboard handling locally.

Both paths must have the same labels, order, grouping, shortcuts, checked state, disabled
reasons, destructive placement, submenus, and handlers. Only the anchor differs. Keep
appearance controls separate from tab and panel operations; “Move tab” and “Move panel”
are distinct capabilities, not duplicate commands. Dropdowns and submenus must retain at
least an 8px viewport gutter, including when their trigger sits at an edge. Menu labels
and descriptions are left-aligned; trailing shortcuts and indicators keep their own slots.
When any visible row has a leading icon, reserve that icon column across the entire popup,
including group headings and rows separated by dividers. Descriptions align with their labels.
Each submenu decides independently; entirely iconless popups do not reserve an icon column.
Align leading icons and trailing shortcuts with the first line of the label, not the vertical
center of a multiline label or description. Keep this contract in shared row anatomy so
composed panel menus and action-model menus behave the same way.
Destructive leading icons inherit the label's destructive color, including hover and focus.
Submenus prefer the right side and align their first row with the parent row; viewport
collisions may flip or shift them, while preserving the viewport gutter.
Menus must fit the viewport, scroll internally, support keyboard/typeahead navigation, and
return focus without stealing it from a dialog or destination opened by a command.
Verify parity with the same domain model
under both invocations, including viewport edges and reduced motion.

#### Deliberate non-menu boundaries

Rich forms and status panels use `Popover` or a dialog, not a `role="menu"` shell. Search
suggestions and value pickers retain listbox semantics, including `aria-selected`; do not
turn them into command menus to reuse styling. New callers must use public canonical
subpaths rather than the `dropdown`, `dropdown-menu`, `searchable-select`,
`searchable-combobox`, or `grouped-combobox` compatibility layers.

The native application menus in `src/main/index.ts` and window entries in
`src/main/window-menu-entries.ts` remain Electron-native to preserve OS menu roles,
accelerators, and native window routing. The spatial hardware selector at
`src/features/hardware-console/prompt-picker/RadialPromptPickerOverlay.svelte` remains a
radial interaction rather than a linear command list. These exact paths do not justify
new feature-owned menu systems; keyboard and assistive-technology behavior still need
their own tests. Native behavior requires Electron verification, not browser-only evidence.

| Family                                           | Verification/migration owner |
| ------------------------------------------------ | ---------------------------- |
| Button, ButtonGroup, Badge, Skeleton, feedback   | `007-B1`                     |
| Input, Textarea, Label, Checkbox, Switch, Toggle | `007-B2`                     |
| Dialog and Sheet overlays                        | `007-B4`                     |
| Menu and command overlays                        | `007-B5`                     |
| Select, Combobox, and compatibility dropdowns    | `007-B6`                     |
| Tabs and product panel-tab behavior              | `007-B7`                     |
| Product components currently in `ui/`            | `007-B8`                     |
| Remaining stable primitives and patterns         | `design-system`              |

### Canonical folder template

| File                                  | Purpose                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `<component>/<component>.svelte`      | Implementation; the single source of component behavior         |
| `<component>/index.ts`                | Public subpath module; no internal-file bypasses in new callers |
| `<component>/<component>.meta.ts`     | Schema-validated ownership and catalog metadata                 |
| `<component>/<component>.test.ts`     | Behavioral and accessibility characterization                   |
| `<component>/<component>.fixtures.ts` | Static, host-independent catalog fixtures                       |
| `<component>/<component>.variants.ts` | Optional single-source variant recipe                           |

Fixture records require an ID, title, and non-empty state list. They may also declare light, dark,
system, or high-contrast themes; compact, desktop, or both viewports; and reduced-motion coverage.
Deprecated and deletion records must name a replacement or explicit deletion plan, a
characterization test, and a measurable removal gate. Schema failures identify the metadata field
to repair.

### Dependency direction

- Primitives may depend on Svelte, Bits UI, relative implementation files, and dependency-light
  `$lib/utils`; they may not import `$features/`, `$store/`, Electron, AppClient, or services.
- Patterns may compose public UI primitives and dependency-light utilities. They may not import a
  feature `main/` subtree or Electron.
- Product components may use feature state and public primitives, but renderer code may not import a
  feature `main/` subtree or Electron directly.
- Boundary failures must name the canonical repair import, normally
  `$lib/components/ui/<component>` for primitive composition or
  `$features/<owner>/components/<component>` for product behavior.

Run the deterministic component inventories from the repository root:

```bash
pnpm exec tsx scripts/ui-component-audit.ts inventory
pnpm exec tsx scripts/ui-component-audit.ts dynamic
pnpm exec tsx scripts/ui-component-audit.ts boundaries
pnpm exec tsx scripts/ui-component-audit.ts raw-elements
pnpm exec tsx scripts/ui-component-audit.ts json
pnpm exec tsx scripts/ui-component-audit.ts check
pnpm vitest run scripts/ui-component-audit.test.ts
```

`inventory` is sorted and includes classification, owner, exports, caller count, replacement,
characterization test, and removal gate. `dynamic` is the deletion-candidate proof. `raw-elements`
reports unique files and occurrences of raw `button`, `input`, `select`, and `textarea` hosts per
top-level source directory. `check` must pass before any Plan 007 migration lane starts.

The ceilings and narrowly scoped exceptions live in
`scripts/ui-component-raw-element-allowlist.json`. Lower the matching directory ceiling whenever a
migration removes a raw-element file; never raise a ceiling to accommodate new raw markup. Each
exception must name one exact file and element plus an owner and durable reason. Hidden native file
picker hosts and third-party contenteditable or editor hosts are valid examples; ordinary product
controls are not. Missing files, stale element exceptions, and counts above a ceiling fail `check`,
which is also part of `pnpm run lint`.

### Design-system ESLint guidance

The `intent/*` design-system rules run at error severity. Every error names the supported replacement
and its `/sandbox/<slug>` catalog page. `eslint-rules/baselines/<rule>/<source path>.json` records
only scoped exceptions, one entry file per exempted source file with an owner and reason (and a
`count` cap where the rule ratchets per file); delete the entry file as its caller migrates, and never
add a new one. The baseline test fails when a rule finds a file outside that checked-in set, and CI
compares the tree with the PR base revision to reject baseline additions while allowing removals.

| Rule                                     | Replace with                                         |
| ---------------------------------------- | ---------------------------------------------------- |
| `intent/no-raw-controls`                 | `Button`, `Input`, `Select`, or `Textarea`           |
| `intent/no-raw-menu-surface`             | `Menu.Content` / the internal `menuOverlay()` recipe |
| `intent/no-raw-menu-row`                 | Semantic Menu rows / the shared `menuItem()` recipe  |
| `intent/no-direct-toast`                 | `notify` from the Notify pattern                     |
| `intent/no-native-dialogs`               | `confirm()` from the Confirm pattern                 |
| `intent/no-adhoc-transitions`            | shared motion tiers from `$lib/motion`               |
| `intent/no-arbitrary-motion-or-color`    | semantic color and spring motion tokens              |
| `intent/no-dialog-root-outside-patterns` | `FormDialog` (or the imperative Confirm service)     |
| `intent/no-uppercase`                    | sentence-case labels without extra letter spacing    |
| `intent/no-legacy-spinner`               | `IntentMarkLoader` from the indicators module        |
| `intent/settings-use-schema`             | `defineSettings` rendered through `SettingsForm`     |

`no-raw-controls` shares the narrow exception policy in
`scripts/ui-component-raw-element-allowlist.json`; do not create a second lint-only exception.
Direct `svelte-sonner` imports remain valid only inside the Notify pattern and toast primitives, and
direct `svelte/transition` or `svelte/motion` imports remain valid only inside `$lib/motion`.

Menu rules resolve imports and local recipe wrappers rather than matching function names
in source text. Aliased imports are valid; comments, string literals, lookalike imports,
and shadowed names are not exemptions. Raw commands inside a canonical menu still need
menu semantics, and radio/checkbox roles must expose `aria-checked`. The UI inventory check
also rejects new static or dynamic legacy callers absent from the owning metadata ledger;
removing another caller does not make room for a new compatibility import.

The exact selectable host in `patterns/collection/ListView.svelte` remains a collection
row whose presentation is supplied by `CollectionRow`, not a compact menu option. The
row rule's exception applies only to that host's `list-view-item` option role; it does
not permit command-menu roles there or copied raw options in feature components.

Run `pnpm vitest run eslint-rules` when changing a rule or its baseline, then run the full
`pnpm run lint` gate.

## Theme boundary

- Light, dark, and system modes assign the same semantic contract; components do not branch on a
  theme to select physical colors.
- Imported VS Code themes are adapters. They must totalize the approved roles and preserve readable
  foreground/background contrast; source keys never become new product-facing variables. Text pairs
  remain at least 4.5:1, while input-boundary and keyboard-focus roles remain at least 3:1 against application surfaces.
  Decorative border sources are preserved as supplied and are not promoted to control boundaries.
- Terminal ANSI colors, syntax highlighting, provider/brand identity, diff semantics, and
  visualization series are explicit boundaries. Keep those colors local to their adapter or
  product component rather than promoting them into the semantic contract.
- Compatibility aliases are migration-only. Their owners and allowed files live in
  `scripts/design-token-allowlist.json`; new product code must not consume them.

## Motion and interaction

Motion communicates state and spatial continuity; it is not decoration. Use the semantic
interaction fills and shared spring tiers instead of component-owned colors, timings, or easing
curves. **Never hand-write a duration.** Use the CSS variables, matching Tailwind utilities, or the
typed helpers from `$lib/motion` so reduced-motion behavior and later tuning stay centralized.

| Tier     | Enter/settle | Crisp exit | Use for                                                    |
| -------- | ------------ | ---------- | ---------------------------------------------------------- |
| Fast     | 80ms         | 60ms       | Hover, press, focus, icon, and font-weight feedback        |
| Moderate | 160ms        | 120ms      | Menus, selection geometry, and compact disclosures         |
| Slow     | 240ms        | 160ms      | Large panels and deliberate takeover or layout transitions |

Use `--spring-{fast,moderate,slow}` with the matching `--spring-*-ease`, or
`duration-spring-*` with `ease-spring-*`. Svelte motion uses `spring.fast`, `spring.moderate`, or
`spring.slow`; exits use the tier's `exit` tween or `crispOut`. Reduced motion must settle directly
without an intermediate spring and CSS consumers must include `motion-reduce:transition-none` (or
the equivalent animation rule).

Import Svelte compatibility helpers from `$lib/motion`, never from `svelte/transition` or
`svelte/motion`. `fade`, `fly`, `slide`, `scale`, `blur`, and `draw` accept a motion `tier`; spatial
helpers additionally accept only semantic `distance` and `axis` options. They resolve spring intros,
paired crisp outros, and reduced-motion instant settling internally, so duration, easing, and delay
are deliberately not part of their API. Use the tier-bound `Spring`, `springValue`, or `tweenedValue`
for continuously retargeted values.

### Interaction rules

- **Hover is preview.** `--hover` shows the pointed row or the nearest eligible row under proximity
  hover. Keyboard roving focus drives that same preview layer. Hover must not imply selection.
- **Press collapses.** Pointer-down uses `--active` and removes the raised edge or moves it to an
  inset edge. Preserve the control's footprint; do not add layout movement to simulate depth.
- **Selection persists.** `--selected` survives pointer departure. Adjacent selected rows merge into
  one continuous background; split the background only where the selected index set has a gap.
- **Exits are crisp.** Enter and retarget motion use the chosen spring tier. Dismissal uses its
  shorter paired exit rather than replaying the spring in reverse.

### Resize affordances

Sidebar and inter-panel dividers share `.app-resize-handle` from
`src/lib/styles/resize-handles.css`. Keep the hit target transparent and the indicator hidden
at rest. Hover, keyboard focus, press, and active drag reveal one neutral line using the
shared muted-foreground treatment; leaving or blurring hides it again unless a drag is active.
Do not add a Button hover surface, a persistent grip, or component-local color overrides.

Use `data-resize-axis="x"` or `"y"` for the full-span line. The short-indicator option changes
only its length, never its idle visibility. Preserve the forgiving hit area and scrollbar
click-through clipping independently of the indicator. Keep keyboard resizing focusable,
set `data-resizing` throughout pointer drag, and retain the shared reduced-motion behavior.
The workspace canvas has no outer-right resize target; resizing belongs to its panel gutters.

### Size ladder and ratchets

The public control ladder is compact 28px, default 32px, and large 36px. Use `SizeProvider` to set
compact density for a subtree, let an explicit component `size` prop win, and do not invent another
height for a local surface. Compact is a density choice, not permission to reduce the interaction
target below the supported ladder.

New product controls compose the canonical primitives; do not introduce raw `button`, `input`,
`select`, or `textarea` hosts. The raw-element audit is a shrinking ratchet: remove an exception or
lower a ceiling when a migration lands, and never raise a ceiling to accommodate new markup.
After an intentional fixture or catalog-contract change, update catalog snapshots with `NODE_OPTIONS=--max-old-space-size=4096 pnpm vitest run src/lib/component-catalog/catalog-contract.test.ts --maxWorkers=1 -u` and review the generated diff before staging it.

## Verification and audits

Run the deterministic inventories from the repository root:

```bash
node scripts/design-token-audit.mjs approved
node scripts/design-token-audit.mjs aliases
node scripts/design-token-audit.mjs raw
node scripts/design-token-audit.mjs undefined
node scripts/design-token-audit.mjs check
```

`check` must pass before review. If a physical palette value is truly required by a brand, diff, or
adapter boundary, record a narrowly scoped entry with an owner, reason, replacement, and removal
condition. Do not raise a ratchet or add an exception to avoid a semantic migration.

For token or theme changes, also run:

```bash
pnpm vitest run scripts/design-token-audit.test.ts src/lib/styles/__tests__/theme-contract.test.ts src/lib/utils/__tests__/vscode-theme-parser.test.ts src/lib/utils/__tests__/theme.test.ts
pnpm exec playwright test test/theme-contract.spec.ts --reporter=line
pnpm run check
pnpm run lint
pnpm tsc -p tsconfig.json --noEmit
```

The Playwright contract test uses a real browser to verify resolved colors for explicit light/dark,
system preference, every preset, and sparse imported high-contrast themes. On macOS it uses an
existing system Chrome installation when the Playwright-managed Chromium binary is unavailable.

## Badge status guidance

Use a Badge for a short status attached to an item. Name the state in text; colour
reinforces meaning and must never be the only cue. Use either `variant="solid"`
or `variant="dot"` with the same mapping:

| Meaning     | Colour prop | Example         |
| ----------- | ----------- | --------------- |
| Neutral     | `gray`      | Draft           |
| Information | `blue`      | In progress     |
| Success     | `green`     | Complete        |
| Warning     | `amber`     | Needs attention |
| Danger      | `red`       | Failed          |

Use plain text for ordinary metadata, Button for a primary action, InputMessage
for field validation, and an alert when the message needs an explanation.
A Badge should not turn every piece of metadata into a competing visual marker.

### Categorical colours

The 17 named colours are for categorisation only, such as distinguishing named
project labels. Keep the category visible in text and its colour assignment
consistent. Do not use this palette to invent more status meanings.

### Compatibility

Legacy `default`, `secondary`, `outline`, `destructive`, `success`, and `info`
variants remain supported for existing callers. New code uses `solid` or `dot`
with an explicit colour from the status mapping above.
