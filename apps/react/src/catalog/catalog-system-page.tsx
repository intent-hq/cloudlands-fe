// Port of src/lib/component-catalog/CatalogSystemPage.svelte.
// Developer catalog specimen copy is retained from the reference.
import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { surfaceClasses } from '@/components/ui/surface-context';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CatalogSystemSlug } from './catalog-navigation';
import './catalog-system-page.css';

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

export function CatalogSystemPage({ slug }: { slug: CatalogSystemSlug }) {
  const [motionReplay, setMotionReplay] = useState(0);
  return (
    <article className="system-page" data-system-page={slug}>
      <header>
        <h1>{titles[slug][0]}</h1>
        <p>{titles[slug][1]}</p>
      </header>
      {slug === 'motion' ? (
        <>
          <section>
            <h2>Three speeds</h2>
            <p>Use the smallest spring that keeps the state change readable.</p>
            <div className="specimen-list">
              {springTiers.map((tier) => (
                <div className="spring-row" key={tier[0]}>
                  <strong>{tier[0]}</strong>
                  <span>{tier[1]}</span>
                  <code>
                    {tier[2]} · {tier[3]}
                  </code>
                  <div className="spring-track" aria-hidden="true">
                    <i
                      key={motionReplay}
                      className={motionReplay > 0 ? 'active' : undefined}
                      style={
                        {
                          '--tier': `var(${tier[2]})`,
                          '--ease': `var(${tier[2]}-ease)`,
                        } as CSSProperties
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <Button variant="outline" onClick={() => setMotionReplay((value) => value + 1)}>
              Replay motion
            </Button>
            <p className="reduced-motion-note">Reduced motion is on</p>
          </section>
          <section>
            <h2>Reduced motion</h2>
            <p>
              The catalog's Make them yours panel can disable decorative movement while preserving
              state.
            </p>
          </section>
        </>
      ) : slug === 'sizes' ? (
        <section>
          <h2>The principle</h2>
          <p>
            Use default controls for primary workflows and compact controls for dense supporting
            surfaces.
          </p>
          <div className="size-ladder">
            {sizes.map((size) => (
              <div key={size[0]} style={{ height: `var(${size[1]})` }}>
                <strong>{size[0]}</strong>
                <code>{size[1]}</code>
                <span>{size[2]}</span>
              </div>
            ))}
          </div>
        </section>
      ) : slug === 'typography' ? (
        <section>
          <h2>Typography scale</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Size / line height (px)</th>
                  <th>Weight</th>
                  <th>Use</th>
                  <th>Specimen</th>
                </tr>
              </thead>
              <tbody>
                {typeRoles.map((role) => (
                  <tr key={role[0]}>
                    <th scope="row">{role[0]}</th>
                    <td>{role[1]}</td>
                    <td>{role[2]}</td>
                    <td>{role[3]}</td>
                    <td>
                      {role[0] === 'code' ? (
                        <code className="type-code">{role[4]}</code>
                      ) : (
                        <span className={`type-${role[0]}`}>{role[4]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : slug === 'color' ? (
        <section>
          <h2>Semantic color roles</h2>
          <p>
            Swatches use live theme tokens. Use the matching foreground token for text on solid
            semantic backgrounds.
          </p>
          <div className="color-roles">
            {colorRoles.map((role) => (
              <div className="color-role" key={role[0]}>
                <h3 className="type-caption font-medium!">{role[0]}</h3>
                {role.slice(1).map((token) => (
                  <div className="color-token" key={token}>
                    <span
                      className="color-swatch"
                      style={{
                        background:
                          token === 'hover' || token === 'active'
                            ? `var(--${token})`
                            : token === 'overlay'
                              ? 'rgb(var(--overlay))'
                              : `hsl(var(--${token}))`,
                      }}
                      aria-hidden="true"
                    />
                    <code>--{token}</code>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : slug === 'surfaces' ? (
        <>
          <section>
            <h2>Three default choices</h2>
            <ul>
              <li>
                <strong>Canvas:</strong> the page and ordinary content; group controls with spacing
                first.
              </li>
              <li>
                <strong>Contained section:</strong> a distinct group that needs one enclosing
                boundary, such as a panel or card.
              </li>
              <li>
                <strong>Floating overlay:</strong> temporary content above the page, such as a menu,
                popover or tooltip.
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
              These levels remain available for existing components, not as additional default
              choices. Each overlay rises two levels above its substrate, capped at level eight.
            </p>
            <div className="surface-ladder">
              {SURFACE_LEVELS.map((surface) => (
                <div key={surface.level} className={surface.className}>
                  <span>Surface {surface.level}</span>
                  <code>{surface.className}</code>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2>Elevation</h2>
            <div className="elevation-demo">
              <div>Canvas</div>
              <div>Contained section</div>
              <div>Floating overlay</div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section>
            <h2>Vertical</h2>
            <p>Keyboard-focusable scroll regions use the same quiet track and thumb treatment.</p>
            <ScrollArea className="scroll-demo h-64 rounded-(--radius-medium) border border-border p-4">
              <div className="grid gap-3">
                {Array.from({ length: 18 }, (_, index) => index + 1).map((row) => (
                  <div key={row} className="scroll-row">
                    Scrollable row {row}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>
          <section>
            <h2>Horizontal</h2>
            <ScrollArea
              orientation="horizontal"
              className="scroll-demo h-24 rounded-(--radius-medium) border border-border p-4"
            >
              <div className="flex w-max gap-3">
                {Array.from({ length: 12 }, (_, index) => index + 1).map((column) => (
                  <span key={column} className="scroll-chip">
                    Column {column}
                  </span>
                ))}
              </div>
            </ScrollArea>
          </section>
        </>
      )}
    </article>
  );
}
