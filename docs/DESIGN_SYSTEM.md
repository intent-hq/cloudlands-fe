# Design System

Use this guide before changing product styling or theme behavior. The canonical token source is
[`src/lib/styles/tokens.css`](../src/lib/styles/tokens.css); do not create another product-facing
token vocabulary in a component, feature stylesheet, or theme adapter.

## Choose a semantic role

| Intent                 | Approved token or utility                                  | Example                  | Do not use                     |
| ---------------------- | ---------------------------------------------------------- | ------------------------ | ------------------------------ |
| App canvas             | `--background`, `bg-background`, `text-foreground`         | Main content             | `bg-white`, `dark:bg-gray-900` |
| Raised surface         | `--card`, `bg-card`, `text-card-foreground`                | Panel or card            | Raw neutral palette            |
| Overlay surface        | `--popover`, `bg-popover`, `text-popover-foreground`       | Menu or tooltip          | Adapter variables              |
| Primary action         | `--primary`, `bg-primary`, `text-primary-foreground`       | Default button           | Brand or source-theme colors   |
| Secondary action       | `--secondary`, `bg-secondary`, `text-secondary-foreground` | Secondary button         | Raw neutral palette            |
| Selected/hovered UI    | `--accent`, `bg-accent`, `text-accent-foreground`          | Active row               | Hard-coded alpha colors        |
| Low-emphasis UI        | `--muted`, `bg-muted`, `text-muted-foreground`             | Supporting text          | `text-gray-*`                  |
| Danger state           | `--danger`, `--danger-background`, `text-danger`           | Delete/error             | `red-*`                        |
| Informational state    | `--info`, `text-info`                                      | Saving/help state        | `blue-*`                       |
| Success state          | `--success`, `text-success`                                | Saved/complete state     | `green-*`                      |
| Warning state          | `--warning`, `text-warning`                                | Unsaved/caution state    | `amber-*`, `yellow-*`          |
| Decorative boundary    | `--border`, `--sidebar-border`                             | Card/list hairline       | Using it as control focus      |
| Control boundary/focus | `--input`, `--ring`                                        | Input hover/focus border | Outer input focus rings        |
| Keyboard focus         | `--ring`                                                   | Non-input control ring   | Fixed gray/blue colors         |
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
  is reserved for short metadata. Preserve the Inter/system UI stack and the separate JetBrains
  Mono/system monospace boundary.
- Spacing: `--space-{1..7}` follows a 4/8/12/16/24/32/48px rhythm. Use
  `--content-measure-{reading,form,wide}` for editorial copy, settings, and broad workspaces.
- Controls: compact/small/medium/large resolve to 28/28/32/36px. Compact is a density alias, not a
  smaller public control size.
- Shape and elevation: small/medium/large radii are 5/7/9px. `--elevation-raised` is a quiet
  one-pixel lift; `--elevation-overlay` is reserved for floating overlays.
- Motion: `--motion-{fast,standard,slow}` with `--ease-*`; preserve reduced-motion behavior.
- Layers: `--layer-{base,sticky,chrome,popover,modal,toast,tooltip,drag-overlay}`.
- Texture: `--surface-hatch` is the only shared diagonal recipe. It derives from background, muted,
  and border roles, so it resolves in light, dark, preset, and imported themes without branching.

Prefer the existing Tailwind utility mapped to a token. Use `var(--token)` in component CSS only
when no mapped utility expresses the property.

### Input focus treatment

Text-entry controls use a border-color change for focus, never an outer ring or outline. Canonical
`Input`, `Textarea`, `FileInput`, and rich-input surfaces use `border-ring` with `ring-0`; preserve
that treatment in composed fields. The `noFocusStyle` compatibility prop may suppress the border
change when a parent surface already owns focus presentation. This exception is limited to input
surfaces: buttons, toggles, menus, and other keyboard-operable controls retain their focus rings.

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
pnpm exec tsx scripts/ui-component-audit.ts json
pnpm exec tsx scripts/ui-component-audit.ts check
pnpm vitest run scripts/ui-component-audit.test.ts
```

`inventory` is sorted and includes classification, owner, exports, caller count, replacement,
characterization test, and removal gate. `dynamic` is the deletion-candidate proof; `check` must pass
before any Plan 007 migration lane starts.

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
