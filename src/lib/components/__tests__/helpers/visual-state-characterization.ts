import { fireEvent } from '@testing-library/svelte';

export const configuredVisualStates = [
  'light',
  'dark',
  'wide',
  'narrow',
  'zoom-100',
  'zoom-200',
  'hover',
  'focus',
  'keyboard',
  'reduced-motion',
] as const;

type VisualConfiguration = {
  theme: 'light' | 'dark';
  width: number;
  zoom: 1 | 2;
  reducedMotion: boolean;
};

type MountedCapability = {
  container: HTMLElement;
  target: HTMLElement;
  assertCapability: () => void | Promise<void>;
  unmount: () => void;
};

const configurations: VisualConfiguration[] = [
  { theme: 'light', width: 1024, zoom: 1, reducedMotion: false },
  { theme: 'dark', width: 320, zoom: 2, reducedMotion: true },
];

export async function exerciseVisualStates(
  mountCapability: (
    configuration: VisualConfiguration,
  ) => MountedCapability | Promise<MountedCapability>,
): Promise<string[]> {
  const observed = new Set<string>();
  const initialWidth = window.innerWidth;
  const initialMatchMedia = window.matchMedia;
  const initiallyDark = document.documentElement.classList.contains('dark');
  try {
    for (const configuration of configurations) {
      document.documentElement.classList.toggle('dark', configuration.theme === 'dark');
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: configuration.width,
      });
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (query: string) => ({
          matches: query.includes('prefers-reduced-motion') && configuration.reducedMotion,
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => true,
        }),
      });
      const mounted = await mountCapability(configuration);
      mounted.container.style.width = `${configuration.width}px`;
      mounted.container.style.zoom = String(configuration.zoom);
      let hoverObserved = false;
      let keyboardObserved = false;
      mounted.target.addEventListener('mouseenter', () => (hoverObserved = true), { once: true });
      mounted.target.addEventListener('keydown', () => (keyboardObserved = true), { once: true });
      await fireEvent.mouseEnter(mounted.target);
      mounted.target.focus();
      await fireEvent.keyDown(mounted.target, { key: 'Enter' });
      if (!hoverObserved || !keyboardObserved || document.activeElement !== mounted.target) {
        throw new Error('Visual-state interaction was not delivered to the capability target');
      }
      if (
        document.documentElement.classList.contains('dark') !== (configuration.theme === 'dark') ||
        window.innerWidth !== configuration.width ||
        mounted.container.style.zoom !== String(configuration.zoom) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches !==
          configuration.reducedMotion
      ) {
        throw new Error('Visual-state environment does not match the requested configuration');
      }
      await mounted.assertCapability();
      observed.add(configuration.theme);
      observed.add(configuration.width < 500 ? 'narrow' : 'wide');
      observed.add(configuration.zoom === 2 ? 'zoom-200' : 'zoom-100');
      observed.add('hover');
      observed.add('focus');
      observed.add('keyboard');
      if (configuration.reducedMotion) observed.add('reduced-motion');
      mounted.unmount();
    }
  } finally {
    document.documentElement.classList.toggle('dark', initiallyDark);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: initialMatchMedia });
  }
  return configuredVisualStates.filter((state) => observed.has(state));
}
