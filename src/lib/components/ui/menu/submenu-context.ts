export const SUBMENU_CONTEXT = Symbol('canonical-submenu');
export const SUBMENU_CONTENT_CLASS = Symbol('canonical-submenu-content-class');

export interface SubmenuContext {
  trigger: HTMLElement | null;
}
