// Port of CatalogShell.svelte and the sandbox layout's root-style ownership.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SizeProvider } from '@/components/ui/size-context';
import { store } from '@/store';
import { selectCatalogQuery, selectCatalogPreferences } from '@/store/catalog/catalog-selectors';
import { setCatalogQuery, setCatalogPreferences } from '@/store/catalog/catalog-slice';
import { themePresets } from '$lib/utils/theme-presets';
import { parseVSCodeTheme } from '$lib/utils/vscode-theme-parser';
import { onReducedMotionChange, prefersReducedMotion } from '$lib/utils/reduced-motion';
import { scrollFade } from '$lib/actions/scroll-fade';
import { CatalogControls } from './catalog-controls';
import { CatalogNavigationMenu } from './catalog-navigation-menu';
import { CatalogLink } from './catalog-link';
import { catalogEntries } from './catalog';
import { buildCatalogNavigation } from './catalog-navigation';
import {
  parseCatalogUrlSettings,
  type CatalogColorTheme,
  type CatalogMotion,
  type CatalogTheme,
} from './catalog-preferences';
import { installPreviewBrowserApi } from './preview-discovery';
import { ownCatalogRootTheme } from './catalog-root-theme';
import './catalog-shell.css';

function subscribeSystemTheme(update: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', update);
  return () => media.removeEventListener('change', update);
}
function subscribeMotion(update: () => void) {
  return onReducedMotionChange(update, document);
}

export function CatalogShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const urlSettings = parseCatalogUrlSettings(new URLSearchParams(location.searchStr));
  const preferences = selectCatalogPreferences();
  const saved = preferences.value;
  const theme = urlSettings.theme ?? saved.theme;
  const motion = urlSettings.motion ?? saved.motion;
  const colorTheme = saved.colorTheme;
  const width = urlSettings.width;
  const fit = urlSettings.fit;
  const sidebarContent = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<'default' | 'compact'>('default');
  const [radius, setRadius] = useState<'rounded' | 'square'>('rounded');
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const search = selectCatalogQuery();
  const navigation = buildCatalogNavigation(catalogEntries, search.value);
  const systemDark = useSyncExternalStore(
    subscribeSystemTheme,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => prefersReducedMotion(document));
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const resolvedMotion = motion === 'system' ? (reducedMotion ? 'reduced' : 'full') : motion;

  useEffect(() => installPreviewBrowserApi(window), []);
  useLayoutEffect(() => {
    const node = sidebarContent.current;
    if (!node) return;
    const fade = scrollFade(node);
    return () => fade?.destroy?.();
  }, [fit]);
  // Route preferences remain authoritative and persist through the owning saga.
  useEffect(() => {
    if (saved.theme !== theme || saved.motion !== motion) {
      store.dispatch(setCatalogPreferences({ ...saved, theme, motion }));
    }
  }, [saved, theme, motion]);
  useEffect(() => {
    const previous = document.title;
    document.title = 'Component sandbox';
    return () => {
      document.title = previous;
    };
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const classes = {
      dark: resolvedTheme === 'dark',
      light: resolvedTheme === 'light',
      'catalog-reduced-motion': motion === 'reduced',
      'catalog-full-motion': motion === 'full',
      'catalog-component-fit': fit === 'component',
    };
    const previousClasses = Object.fromEntries(
      Object.keys(classes).map((key) => [key, root.classList.contains(key)]),
    );
    const preset = themePresets.find(({ id }) => id === colorTheme);
    const nextProperties: Record<string, string> = {
      ...(preset ? parseVSCodeTheme(preset[resolvedTheme]).cssVariables : {}),
      'color-scheme': resolvedTheme,
      '--font-ui':
        "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    };
    const previousProperties = Object.fromEntries(
      Object.keys(nextProperties).map((key) => [
        key,
        { value: root.style.getPropertyValue(key), priority: root.style.getPropertyPriority(key) },
      ]),
    );
    for (const [key, value] of Object.entries(classes)) root.classList.toggle(key, value);
    for (const [key, value] of Object.entries(nextProperties)) root.style.setProperty(key, value);
    const appliedProperties = Object.fromEntries(
      Object.keys(nextProperties).map((key) => [key, root.style.getPropertyValue(key)]),
    );
    return ownCatalogRootTheme(root, store, resolvedTheme, () => {
      for (const [key, value] of Object.entries(previousClasses)) {
        if (root.classList.contains(key) === classes[key as keyof typeof classes]) {
          root.classList.toggle(key, value);
        }
      }
      for (const [key, { value, priority }] of Object.entries(previousProperties)) {
        if (
          root.style.getPropertyValue(key) !== appliedProperties[key] ||
          root.style.getPropertyPriority(key) !== ''
        ) {
          continue;
        }
        if (value) root.style.setProperty(key, value, priority);
        else root.style.removeProperty(key);
      }
    });
  }, [resolvedTheme, colorTheme, motion, fit]);

  function updatePreference(next: {
    theme?: CatalogTheme;
    motion?: CatalogMotion;
    colorTheme?: CatalogColorTheme;
  }) {
    const preferences = { theme, motion, colorTheme, ...next };
    store.dispatch(setCatalogPreferences(preferences));
    const params = new URLSearchParams(location.searchStr);
    params.set('theme', preferences.theme);
    params.delete('reducedMotion');
    if (preferences.motion === 'system') params.delete('motion');
    else params.set('motion', preferences.motion);
    void navigate({ to: location.pathname, search: Object.fromEntries(params), replace: true });
  }
  function updateWidth(next: number | undefined) {
    const params = new URLSearchParams(location.searchStr);
    if (next) params.set('width', String(next));
    else params.delete('width');
    void navigate({ to: location.pathname, search: Object.fromEntries(params), replace: true });
  }

  return (
    <div
      className={`catalog-shell min-h-screen bg-background text-foreground${fit === 'component' ? ' component-fit' : ''}`}
      data-testid="catalog-shell"
      data-catalog-theme={theme}
      data-catalog-color-theme={colorTheme}
      data-catalog-motion={resolvedMotion}
      data-catalog-motion-preference={motion}
      data-catalog-density={density}
      data-catalog-radius={radius}
      style={
        {
          ...(radius === 'square'
            ? { '--radius-small': '2px', '--radius-medium': '3px', '--radius-large': '4px' }
            : {}),
          ...(width ? { '--catalog-preview-width': `${width}px` } : {}),
          '--sidebar-width': '256px',
        } as CSSProperties
      }
    >
      <SizeProvider key={density} size={density}>
        {fit === 'component' ? (
          <main className="catalog-component-content">{children}</main>
        ) : (
          <div
            className="catalog-layout group/sidebar-wrapper min-h-svh w-full"
            data-slot="sidebar-wrapper"
          >
            <nav
              className="catalog-sidebar bg-sidebar text-sidebar-foreground w-(--sidebar-width) flex h-full flex-col"
              aria-label="Component catalog"
            >
              <div
                className="catalog-sidebar-header flex shrink-0 flex-col gap-2 p-2"
                data-slot="sidebar-header"
                data-sidebar="header"
                data-orientation="vertical"
              >
                <CatalogLink
                  className="catalog-brand"
                  href="/sandbox"
                  aria-label="Component catalog home"
                >
                  <span className="brand-mark" aria-hidden="true">
                    I
                  </span>
                  <span>Intent UI</span>
                </CatalogLink>
                <Input
                  type="search"
                  aria-label="Search catalog"
                  placeholder="Search catalog"
                  value={search.value}
                  onChange={(event) => store.dispatch(setCatalogQuery(event.target.value))}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') store.dispatch(setCatalogQuery(''));
                  }}
                />
              </div>
              <div
                ref={sidebarContent}
                className="catalog-sidebar-content border-border flex min-h-0 flex-1 flex-col gap-2 overflow-auto border-y"
                data-slot="sidebar-content"
                data-sidebar="content"
              >
                {navigation.length ? (
                  navigation.map((group) => (
                    <div
                      key={group.id}
                      data-slot="sidebar-group"
                      data-sidebar="group"
                      data-open="true"
                      data-collapsible="false"
                      className="relative flex w-full min-w-0 flex-col p-2"
                    >
                      <div
                        data-slot="sidebar-group-label"
                        data-sidebar="group-label"
                        className="group/group-label text-muted-foreground flex h-(--control-height-medium) w-full shrink-0 items-center justify-start gap-2 rounded-md px-2 text-xs font-normal transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none"
                      >
                        {group.name} <span>{group.entries.length}</span>
                      </div>
                      <div
                        data-slot="sidebar-group-content"
                        data-sidebar="group-content"
                        className="type-body w-full will-change-[height]"
                      >
                        <div>
                          <CatalogNavigationMenu
                            entries={group.entries}
                            activePath={location.pathname}
                            density={density}
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <output className="type-caption block p-2 text-muted-foreground">
                    No catalog entries match your search.
                  </output>
                )}
              </div>
            </nav>
            <aside
              className={`catalog-customize${customizeOpen ? ' customize-open' : ''}`}
              aria-label="Catalog customization"
            >
              <Button
                variant="outline"
                className="catalog-customize-toggle"
                aria-expanded={customizeOpen}
                aria-controls="catalog-customize-content"
                onClick={() => setCustomizeOpen((value) => !value)}
              >
                Customize preview
              </Button>
              <div id="catalog-customize-content">
                <CatalogControls
                  theme={theme}
                  colorTheme={colorTheme}
                  resolvedTheme={resolvedTheme}
                  motion={motion}
                  width={width}
                  density={density}
                  radius={radius}
                  onThemeChange={(value) => updatePreference({ theme: value })}
                  onColorThemeChange={(value) => updatePreference({ colorTheme: value })}
                  onMotionChange={(value) => updatePreference({ motion: value })}
                  onWidthChange={updateWidth}
                  onDensityChange={setDensity}
                  onRadiusChange={setRadius}
                />
              </div>
            </aside>
            <main className="catalog-main">{children}</main>
          </div>
        )}
      </SizeProvider>
    </div>
  );
}
