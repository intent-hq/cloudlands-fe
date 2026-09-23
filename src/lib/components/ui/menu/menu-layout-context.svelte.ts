import { getContext, setContext, untrack } from 'svelte';

const MENU_LAYOUT = Symbol('menu-layout');

interface MenuLayout {
  readonly alignIconColumn: boolean;
  readonly reserveIcon: boolean;
  registerIcon(): () => void;
}

/** Each popup owns its columns, including non-portalled/static submenus. */
export function createMenuLayout(alignIconColumn: () => boolean | undefined) {
  const parent = getContext<MenuLayout | undefined>(MENU_LAYOUT);
  let icons = $state(0);
  const enabled = () => alignIconColumn() ?? parent?.alignIconColumn ?? false;
  setContext<MenuLayout>(MENU_LAYOUT, {
    get alignIconColumn() {
      return enabled();
    },
    get reserveIcon() {
      return enabled() && icons > 0;
    },
    registerIcon() {
      untrack(() => icons++);
      return () => untrack(() => icons--);
    },
  });
}

/** Register declared artwork, never the empty slot reserved for another row. */
export function useMenuIconColumn(hasIcon: () => boolean) {
  const layout = getContext<MenuLayout | undefined>(MENU_LAYOUT);
  $effect(() => {
    if (hasIcon()) return layout?.registerIcon();
  });
  return () => layout?.reserveIcon ?? false;
}
