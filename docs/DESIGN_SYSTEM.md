# Design System

Use this guide before changing product styling or theme behavior. The canonical token source is
[`src/lib/styles/tokens.css`](../src/lib/styles/tokens.css); do not create another product-facing
token vocabulary in a component, feature stylesheet, or theme adapter.

## I need to…

Start with a pattern, not a primitive. The generated
[cheatsheet](../../docs/fe/DESIGN_SYSTEM_CHEATSHEET.md) has the complete public API summary, and
[`/sandbox/recipes`](../src/routes/sandbox/recipes/+page.svelte) renders copyable full compositions.

### …notify the user

Import `notify` from `$lib/components/patterns/notify`; inspect [`/sandbox/notify`](../src/lib/components/patterns/notify).

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
[`/sandbox/confirm`](../src/lib/components/patterns/confirm).

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
[`/sandbox/settings`](../src/lib/components/patterns/settings).

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
[`/sandbox/collection`](../src/lib/components/patterns/collection).

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
[`/sandbox/screen`](../src/lib/components/patterns/screen).

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
[`/sandbox/action-menu`](../src/lib/components/patterns/action-menu).

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import { ActionBar, defineActions } from '$lib/components/patterns/action-menu';
  const actions = defineActions([{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete' }]);
</script>
<ActionBar {actions} visibleCount={1} onAction={runAction} />
```

### …show empty, loading, or error state

Import `EmptyState`, `LoadingState`, and `ErrorState` from `$lib/components/patterns/screen`; inspect
[`/sandbox/screen`](../src/lib/components/patterns/screen).

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
{#if open}<section in:springIn={{ tier: 'moderate' }} out:crispOut>Content</section>{/if}
<!-- Use duration-spring-* only for class transitions. -->
```

## Never

- Never add raw `<button>`, `<input>`, `<select>`, or `<textarea>` controls; use their UI primitives.
- Never import `svelte-sonner` directly; route transient feedback through `notify`.
- Never call `window.alert`, `window.confirm`, or `window.prompt`; use the Confirm pattern.
- Never import `svelte/motion` or `svelte/transition` outside `$lib/motion`.
- Never use arbitrary duration, easing, background, or text-color utilities; use semantic tokens.
- Never mount `Dialog.Root` directly in a feature; use `FormDialog` or the Confirm service.
- Never hand-compose settings rows from primitives; define a schema and render `SettingsForm`.

## Choose a semantic role

| Intent                 | Approved token or utility                                  | Example                  | Do not use                     |
| ---------------------- | ---------------------------------------------------------- | ------------------------ | ------------------------------ |
| App canvas             | `--background`, `bg-background`, `text-foreground`         | Main content             | `bg-white`, `dark:bg-gray-900` |
| Raised surface         | `--card`, `bg-card`, `text-card-foreground`                | Panel or card            | Raw neutral palette            |
| Overlay surface        | `--popover`, `bg-popover`, `text-popover-foreground`       | Menu or tooltip          | Adapter variables              |
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
  not additional styles. Body is the default for messages, controls, and suggested actions; caption
  is reserved for short metadata. The bundled Inter variable Latin weight face keeps the existing
  Inter/system fallback stack. Components may transition `font-weight` or
  `font-variation-settings` from 500 to 600 with the fast spring tier; component adoption owns those
  transitions. Preserve the separate JetBrains Mono/system monospace boundary.
- Spacing: `--space-{1..7}` follows a 4/8/12/16/24/32/48px rhythm. Use
  `--content-measure-{reading,form,wide}` for editorial copy, settings, and broad workspaces.
- Controls: compact/small/medium/large resolve to 28/28/32/36px. Compact is a density alias, not a
  smaller public control size.
- Shape and elevation: small/medium/large radii are 5/7/9px. `--elevation-raised` is a quiet
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

Text-entry controls use a one-pixel inset shadow in `--ring` for focus, never an outer ring or
outline. Canonical `Input`, `Textarea`, `FileInput`, and composed input surfaces use a transparent
rest state, `bg-hover` on hover, and `bg-card` plus the inset shadow on focus. The `noFocusStyle`
compatibility prop may suppress the focus background and inset shadow when a parent surface already
owns focus presentation. This exception is limited to input surfaces: buttons, toggles, menus, and
other keyboard-operable controls retain their focus rings.

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

### Compact command menus

Use `Menu.CommandItem` for conventional right-click/dropdown action rows that pair a leading icon
with an optional trailing keyboard shortcut. Keep labels short and verb-led, group related commands
with `Menu.Separator`, and use canonical `Menu.Root`, `Menu.Trigger`, and `Menu.Content` rather than
the deprecated dropdown compatibility wrapper in new callers.

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
and its `/sandbox/<slug>` catalog page. `eslint-rules/design-system/baseline.json` records only scoped
exceptions with an owner and reason; remove files as callers migrate, and never add a new violating
file. The baseline test fails when a rule finds a file outside that checked-in set, and CI compares the
file with the PR base revision to reject baseline additions while allowing removals.

| Rule                                     | Replace with                                     |
| ---------------------------------------- | ------------------------------------------------ |
| `intent/no-raw-controls`                 | `Button`, `Input`, `Select`, or `Textarea`       |
| `intent/no-direct-toast`                 | `notify` from the Notify pattern                 |
| `intent/no-native-dialogs`               | `confirm()` from the Confirm pattern             |
| `intent/no-adhoc-transitions`            | shared motion tiers from `$lib/motion`           |
| `intent/no-arbitrary-motion-or-color`    | semantic color and spring motion tokens          |
| `intent/no-dialog-root-outside-patterns` | `FormDialog` (or the imperative Confirm service) |
| `intent/settings-use-schema`             | `defineSettings` rendered through `SettingsForm` |

`no-raw-controls` shares the narrow exception policy in
`scripts/ui-component-raw-element-allowlist.json`; do not create a second lint-only exception.
Direct `svelte-sonner` imports remain valid only inside the Notify pattern and toast primitives, and
direct `svelte/transition` or `svelte/motion` imports remain valid only inside `$lib/motion`.

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
