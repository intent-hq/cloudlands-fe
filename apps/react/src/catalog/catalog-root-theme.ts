import { setThemeName } from '../../../../src/store/renderer/slices/theme/theme-slice';
import type {
  ThemeName,
  ThemeState,
} from '../../../../src/store/renderer/slices/theme/theme-types';

type ThemeStore = {
  readonly state: { theme: ThemeState };
  dispatch: (action: ReturnType<typeof setThemeName>) => unknown;
};

type RootOwner = {
  previousName: ThemeName;
  restoreRoot: () => void;
  released: boolean;
};

// DOM lifetime bookkeeping only; the resolved theme remains canonical Redux state.
const rootOwners = new WeakMap<HTMLElement, RootOwner[]>();

export function ownCatalogRootTheme(
  root: HTMLElement,
  store: ThemeStore,
  name: ThemeName,
  restoreRoot: () => void,
): () => void {
  const owners = rootOwners.get(root) ?? [];
  const owner: RootOwner = { previousName: store.state.theme.name, restoreRoot, released: false };
  owners.push(owner);
  rootOwners.set(root, owners);
  store.dispatch(setThemeName(name));

  return () => {
    if (owner.released) return;
    owner.released = true;
    // An older unmount must not restore styles or state over a newer catalog.
    if (owners.at(-1) !== owner) return;
    let previousName = name;
    while (owners.at(-1)?.released) {
      const released = owners.pop()!;
      released.restoreRoot();
      previousName = released.previousName;
    }
    if (owners.length === 0) rootOwners.delete(root);
    // Preserve a theme published by a different owner after this catalog's write.
    if (store.state.theme.name === name && previousName !== name) {
      store.dispatch(setThemeName(previousName));
    }
  };
}
