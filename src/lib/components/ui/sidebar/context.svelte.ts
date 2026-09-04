import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
import { getContext, setContext } from 'svelte';

type Getter<T> = () => T;
export type SidebarPeek = 'none' | 'hover' | 'click';
export type SidebarSide = 'left' | 'right';

export type SidebarStateProps = {
  /**
   * A getter function that returns the current open state of the sidebar.
   * We use a getter function here to support `bind:open` on the `Sidebar.Provider`
   * component.
   */
  open: Getter<boolean>;

  /**
   * A function that sets the open state of the sidebar. To support `bind:open`, we need
   * a source of truth for changing the open state to ensure it will be synced throughout
   * the sub-components and any `bind:` references.
   */
  setOpen: (open: boolean) => void;
  peek: Getter<SidebarPeek>;
  shortcut: Getter<string | null | undefined>;
  width: Getter<string>;
};

class SidebarState {
  readonly props: SidebarStateProps;
  open = $derived.by(() => this.props.open());
  openMobile = $state(false);
  peekOpen = $state(false);
  resizedWidth = $state<number | null>(null);
  side = $state<SidebarSide>('left');
  setOpen: SidebarStateProps['setOpen'];
  providerElement = $state<HTMLElement | null>(null);
  #isMobile: IsMobile;
  state = $derived.by(() => (this.open ? 'expanded' : 'collapsed'));
  width = $derived.by(() =>
    this.resizedWidth === null ? this.props.width() : `${this.resizedWidth}px`,
  );

  constructor(props: SidebarStateProps) {
    this.setOpen = props.setOpen;
    this.#isMobile = new IsMobile();
    this.props = props;
  }

  // Convenience getter for checking if the sidebar is mobile
  // without this, we would need to use `sidebar.isMobile.current` everywhere
  get isMobile() {
    return this.#isMobile.current;
  }

  setProviderElement = (element: HTMLElement | null) => {
    this.providerElement = element;
  };

  setSide = (side: SidebarSide) => {
    this.side = side;
  };

  setWidth = (width: number) => {
    this.resizedWidth = width;
  };

  setPeekOpen = (open: boolean) => {
    this.peekOpen = !this.isMobile && !this.open && this.props.peek() !== 'none' && open;
  };

  requestPeek = (mode: Exclude<SidebarPeek, 'none'>) => {
    if (this.props.peek() === mode) this.setPeekOpen(true);
  };

  dismissPeek = () => {
    this.peekOpen = false;
  };

  handleShortcutKeydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape' && this.peekOpen) {
      e.preventDefault();
      this.dismissPeek();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const target = e.target;
    if (
      target instanceof HTMLElement &&
      target.matches('input, textarea, select, [contenteditable="true"]')
    )
      return;
    const active = document.activeElement as HTMLElement | null;
    const focusedProvider = active?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');
    if (!this.providerElement || focusedProvider !== this.providerElement) return;
    const shortcut = this.props.shortcut() ?? (this.side === 'left' ? '[' : ']');
    if (shortcut === null || e.key !== shortcut) return;
    e.preventDefault();
    this.dismissPeek();
    this.toggle();
  };

  handleOutsidePointerDown = (e: PointerEvent) => {
    if (!this.peekOpen || this.providerElement?.contains(e.target as Node)) return;
    this.dismissPeek();
  };

  setOpenMobile = (value: boolean) => {
    this.openMobile = value;
  };

  toggle = () => {
    this.dismissPeek();
    return this.#isMobile.current ? (this.openMobile = !this.openMobile) : this.setOpen(!this.open);
  };
}

const SYMBOL_KEY = 'scn-sidebar';

/**
 * Instantiates a new `SidebarState` instance and sets it in the context.
 *
 * @param props The constructor props for the `SidebarState` class.
 * @returns  The `SidebarState` instance.
 */
export function setSidebar(props: SidebarStateProps): SidebarState {
  return setContext(Symbol.for(SYMBOL_KEY), new SidebarState(props));
}

/**
 * Retrieves the `SidebarState` instance from the context. This is a class instance,
 * so you cannot destructure it.
 * @returns The `SidebarState` instance.
 */
export function useSidebar(): SidebarState {
  return getContext(Symbol.for(SYMBOL_KEY));
}
