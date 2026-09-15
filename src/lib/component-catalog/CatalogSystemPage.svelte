<script lang="ts">
  import type { CatalogSystemSlug } from './catalog-navigation';
  import { Button } from '$lib/components/ui/button';
  import { ScrollArea } from '$lib/components/ui/scroll-area';
  import { surfaceClasses } from '$lib/components/ui';

  let { slug }: { slug: CatalogSystemSlug } = $props();
  let motionReplay = $state(0);
  const typeRoles = [
    [
      'caption',
      '13 / 18',
      '400; 500 for selection or label emphasis',
      'Compact UI: controls, navigation, short metadata',
      'Supporting metadata',
    ],
    [
      'body',
      '15 / 22',
      '400; 500 for emphasis',
      'Reading: messages, documents, explanatory copy, expanded form content',
      'Readable interface copy',
    ],
    ['title', '17 / 24', '500', 'Section title', 'Section title'],
    ['display', '22 / 28', '500', 'Page title', 'Intent design system'],
    [
      'code',
      '13 / 20',
      '400',
      'Code; monospace only where content is code',
      "const size = 'compact';",
    ],
  ] as const;
  const colorRoles = [
    ['App canvas', 'background', 'foreground'],
    ['Raised surface', 'card', 'card-foreground'],
    ['Overlay surface', 'popover', 'popover-foreground'],
    ['Primary action', 'primary', 'primary-foreground'],
    ['Secondary action', 'secondary', 'secondary-foreground'],
    ['Hover preview', 'hover'],
    ['Pressed UI', 'active'],
    ['Selected UI', 'selected'],
    ['Emphasized UI', 'accent', 'accent-foreground'],
    ['Low-emphasis UI', 'muted', 'muted-foreground'],
    ['Danger state', 'danger', 'danger-background'],
    ['Informational state', 'info'],
    ['Success state', 'success'],
    ['Warning state', 'warning'],
    ['Decorative boundary', 'border', 'sidebar-border'],
    ['Control boundary/focus', 'input', 'ring'],
    ['Keyboard focus', 'focus-ring'],
    ['Foreground overlay', 'overlay'],
    ['Navigation chrome', 'sidebar', 'sidebar-foreground'],
  ] as const;
  const springTiers = [
    ['fast', 'Hover, press, and focus feedback', '--spring-fast', '--spring-fast-exit'],
    ['moderate', 'Menus and compact disclosure', '--spring-moderate', '--spring-moderate-exit'],
    ['slow', 'Large panels and takeover transitions', '--spring-slow', '--spring-slow-exit'],
  ] as const;
  const sizes = [
    ['Compact', '--control-height-small', '28px'],
    ['Default', '--control-height-medium', '36px'],
    ['Large', '--control-height-large', '36px'],
  ] as const;
  const SURFACE_LEVELS = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((level) => ({
    level,
    className: surfaceClasses(level),
  }));
  const titles = {
    typography: ['Typography', 'Compact UI and reading content share five explicit type roles.'],
    color: ['Color', 'Semantic roles keep color meaningful across themes.'],
    motion: ['Motion', 'Three spring speeds keep every interaction fast, legible, and related.'],
    sizes: ['Sizes', 'A compact control ladder keeps dense product interfaces aligned.'],
    surfaces: ['Surfaces', 'Choose canvas, contained section or floating overlay for composition.'],
    scrollbars: ['Scrollbars', 'Quiet scroll affordances appear when content needs them.'],
  } as const;
</script>

<article class="system-page" data-system-page={slug}>
  <header>
    <h1>{titles[slug][0]}</h1>
    <p>{titles[slug][1]}</p>
  </header>

  {#if slug === 'motion'}
    <section>
      <h2>Three speeds</h2>
      <p>Use the smallest spring that keeps the state change readable.</p>
      <div class="specimen-list">
        {#each springTiers as tier (tier[0])}
          <div class="spring-row">
            <strong>{tier[0]}</strong><span>{tier[1]}</span><code>{tier[2]} · {tier[3]}</code>
            <div class="spring-track" aria-hidden="true">
              {#key motionReplay}
                <i
                  class:active={motionReplay > 0}
                  style={`--tier:var(${tier[2]});--ease:var(${tier[2]}-ease)`}
                ></i>
              {/key}
            </div>
          </div>
        {/each}
      </div>
      <Button variant="outline" onclick={() => motionReplay++}>Replay motion</Button>
      <!-- i18n-ignore (developer catalog specimen) -->
      <p class="reduced-motion-note">Reduced motion is on</p>
    </section>
    <section>
      <h2>Reduced motion</h2>
      <p>
        The catalog's Make them yours panel can disable decorative movement while preserving state.
      </p>
    </section>
  {:else if slug === 'sizes'}
    <section>
      <h2>The principle</h2>
      <p>
        Use default controls for primary workflows and compact controls for dense supporting
        surfaces.
      </p>
      <div class="size-ladder">
        {#each sizes as size (size[0])}
          <div style={`height:var(${size[1]})`}>
            <strong>{size[0]}</strong><code>{size[1]}</code><span>{size[2]}</span>
          </div>
        {/each}
      </div>
    </section>
  {:else if slug === 'typography'}
    <section>
      <h2>Typography scale</h2>
      <div class="table-scroll">
        <table>
          <thead
            ><tr
              ><th>Role</th><th>Size / line height (px)</th><th>Weight</th><th>Use</th><th
                >Specimen</th
              ></tr
            ></thead
          >
          <tbody>
            {#each typeRoles as role (role[0])}
              <tr
                ><th scope="row">{role[0]}</th><td>{role[1]}</td><td>{role[2]}</td><td>{role[3]}</td
                ><td>
                  {#if role[0] === 'code'}<code class="type-code">{role[4]}</code>{:else}<span
                      class={`type-${role[0]}`}>{role[4]}</span
                    >{/if}
                </td></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {:else if slug === 'color'}
    <section>
      <h2>Semantic color roles</h2>
      <p>
        Swatches use live theme tokens. Use the matching foreground token for text on solid semantic
        backgrounds.
      </p>
      <div class="color-roles">
        {#each colorRoles as role (role[0])}
          <div class="color-role">
            <h3 class="type-caption font-medium!">{role[0]}</h3>
            {#each role.slice(1) as token (token)}
              <div class="color-token">
                <span
                  class="color-swatch"
                  style={`background: ${token === 'hover' || token === 'active' ? `var(--${token})` : token === 'overlay' ? 'rgb(var(--overlay))' : `hsl(var(--${token}))`}`}
                  aria-hidden="true"
                ></span><code>--{token}</code>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    </section>
  {:else if slug === 'surfaces'}
    <section>
      <h2>Three default choices</h2>
      <ul>
        <li>
          <strong>Canvas:</strong> the page and ordinary content; group controls with spacing first.
        </li>
        <li>
          <strong>Contained section:</strong> a distinct group that needs one enclosing boundary, such
          as a panel or card.
        </li>
        <li>
          <strong>Floating overlay:</strong> temporary content above the page, such as a menu, popover
          or tooltip.
        </li>
      </ul>
      <p>
        Use one enclosing boundary per group. Avoid another border or shadow around an already
        contained section.
      </p>
    </section>
    <section>
      <h2>Internal levels (compatibility)</h2>
      <p>
        These levels remain available for existing components, not as additional default choices.
        Each overlay rises two levels above its substrate, capped at level eight.
      </p>
      <div class="surface-ladder">
        {#each SURFACE_LEVELS as surface (surface.level)}
          <div class={surface.className}>
            <span>Surface {surface.level}</span><code>{surface.className}</code>
          </div>
        {/each}
      </div>
    </section>
    <section>
      <h2>Elevation</h2>
      <div class="elevation-demo">
        <div>Canvas</div>
        <div>Contained section</div>
        <div>Floating overlay</div>
      </div>
    </section>
  {:else}
    <section>
      <h2>Vertical</h2>
      <p>Keyboard-focusable scroll regions use the same quiet track and thumb treatment.</p>
      <ScrollArea class="scroll-demo h-64 rounded-(--radius-medium) border border-border p-4">
        <div class="grid gap-3">
          {#each Array.from({ length: 18 }, (_, index) => index + 1) as row}<div class="scroll-row">
              Scrollable row {row}
            </div>{/each}
        </div>
      </ScrollArea>
    </section>
    <section>
      <h2>Horizontal</h2>
      <ScrollArea
        orientation="horizontal"
        class="scroll-demo h-24 rounded-(--radius-medium) border border-border p-4"
        ><div class="flex w-max gap-3">
          {#each Array.from({ length: 12 }, (_, index) => index + 1) as column}<span
              class="scroll-chip">Column {column}</span
            >{/each}
        </div></ScrollArea
      >
    </section>
  {/if}
</article>

<style>
  .system-page {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: 3rem;
    padding: 2rem 1.5rem;
  }
  .system-page header h1 {
    font-size: var(--text-display-size);
    font-weight: var(--text-display-weight);
    line-height: var(--text-display-line-height);
    letter-spacing: var(--text-display-tracking);
  }
  .system-page header p,
  section > p {
    margin-top: 0.5rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--text-body-size);
    font-weight: var(--text-body-weight);
    line-height: var(--text-body-line-height);
    letter-spacing: var(--text-body-tracking);
  }
  h2 {
    font-size: var(--text-title-size);
    font-weight: var(--text-title-weight);
    line-height: var(--text-title-line-height);
    letter-spacing: var(--text-title-tracking);
  }
  .specimen-list,
  .size-ladder {
    display: grid;
    gap: 0.75rem;
    margin-block: 1rem;
  }
  .spring-row {
    display: grid;
    grid-template-columns: 5rem 1fr auto;
    align-items: center;
    gap: 0.75rem;
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }
  .spring-row span,
  .spring-row code {
    color: hsl(var(--muted-foreground));
  }
  .spring-track {
    grid-column: 1/-1;
    position: relative;
    width: 100%;
    height: 0.75rem;
  }
  .spring-row i {
    position: absolute;
    left: 0;
    display: block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    background: hsl(var(--foreground));
  }
  .spring-row i.active {
    left: calc(100% - 0.75rem);
    animation: spring-travel var(--tier) var(--ease);
  }
  @keyframes spring-travel {
    from {
      left: 0;
    }
    to {
      left: calc(100% - 0.75rem);
    }
  }
  .reduced-motion-note {
    display: none;
  }
  :global(.catalog-reduced-motion) .spring-row i.active {
    animation: none;
  }
  :global(.catalog-reduced-motion) .reduced-motion-note {
    display: block;
  }
  @container style(--motion-reduced: 1) {
    .spring-row i.active {
      animation: none;
    }
    .reduced-motion-note {
      display: block;
    }
  }
  .size-ladder > div {
    display: grid;
    grid-template-columns: 6rem 1fr auto;
    align-items: center;
    padding-inline: 0.75rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }
  .table-scroll {
    overflow-x: auto;
    margin-top: 1rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }
  th,
  td {
    padding: 0.75rem;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid hsl(var(--border));
  }
  th {
    font-weight: var(--text-title-weight);
  }
  .color-roles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 1.5rem;
    margin-top: 1rem;
  }
  .color-role,
  .color-token {
    display: grid;
    gap: 0.5rem;
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
  }
  .color-token {
    grid-template-columns: 2rem 1fr;
    align-items: center;
  }
  .color-swatch {
    width: 2rem;
    height: 2rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
  }
  .surface-ladder {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.75rem;
    margin-top: 1rem;
  }
  .surface-ladder > div {
    display: grid;
    align-content: end;
    aspect-ratio: 1;
    padding: 0.625rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }
  .surface-ladder code {
    color: hsl(var(--muted-foreground));
  }
  .elevation-demo {
    display: flex;
    align-items: center;
    margin-top: 1rem;
  }
  .elevation-demo div {
    flex: 1;
    padding: 1.25rem;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    background: hsl(var(--card));
    box-shadow: var(--elevation-raised);
  }
  .elevation-demo div + div {
    margin-left: -1rem;
    transform: translateY(0.75rem);
  }
  :global(.scroll-demo) {
    margin-top: 1rem;
  }
  .scroll-row,
  .scroll-chip {
    border-radius: var(--radius-small);
    background: hsl(var(--muted));
    padding: 0.625rem 0.75rem;
    font-size: var(--text-caption-size);
    line-height: var(--text-caption-line-height);
    letter-spacing: var(--text-caption-tracking);
  }
  @media (max-width: 560px) {
    .surface-ladder {
      grid-template-columns: repeat(2, 1fr);
    }
    .spring-row {
      grid-template-columns: 1fr;
    }
    .spring-row i {
      grid-column: 1;
    }
  }
</style>
