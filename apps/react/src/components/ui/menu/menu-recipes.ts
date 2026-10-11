// Source: src/lib/components/ui/menu/menu-recipes.ts. Preserve canonical row/overlay tokens.
import { cn } from '@/lib/utils';
import { menuOverlayClass } from '@/components/ui/overlay-recipes';
import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';
import '@/components/ui/overlays.css';
import './menu.css';

export const menuItem = ({ inset, className }: { inset?: boolean; className?: string } = {}) =>
  cn(
    OPTION_LIST_ROW_CLASS,
    'menu-row group/menu-item relative z-10 flex w-full min-w-0 cursor-default select-none items-start gap-2 border-none bg-transparent transition-colors duration-spring-fast ease-spring-fast focus:text-foreground focus-visible:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-reduce:transition-none',
    inset && 'pl-8',
    className,
  );
export const menuOverlay = ({ className }: { className?: string } = {}) =>
  cn(menuOverlayClass, className);
export const menuSubmenuAlignOffset = -5;
export const menuOverlayTransition = {
  enter: { tier: 'moderate', y: 4, scale: 0.95 },
  exit: { tier: 'moderate' },
} as const;
