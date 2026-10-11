// Source: sidebar/context.svelte.ts and sidebar-provider.svelte. State is local to this mounted surface.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type SidebarPeek = 'none' | 'hover' | 'click';
export interface SidebarState {
  open: boolean;
  state: 'expanded' | 'collapsed';
  setOpen(open: boolean): void;
  openMobile: boolean;
  setOpenMobile(open: boolean): void;
  restoreMobileFocus(): void;
  isMobile: boolean;
  peek: SidebarPeek;
  peekOpen: boolean;
  setPeekOpen(open: boolean): void;
  requestPeek(mode: Exclude<SidebarPeek, 'none'>): void;
  dismissPeek(): void;
  side: 'left' | 'right';
  setSide(side: 'left' | 'right'): void;
  width: string;
  widthMobile: string;
  setWidth(width: number): void;
  toggle(): void;
}
const SidebarContext = createContext<SidebarState | null>(null);
export function useSidebar() {
  const state = useContext(SidebarContext);
  if (!state) throw new Error('Sidebar components must be inside Sidebar.Provider');
  return state;
}
export type SidebarProviderProps = ComponentProps<'div'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Product callers route persistence through their Themis preference owner. */
  persist?: boolean;
  onPersistOpen?: (open: boolean) => void;
  peek?: SidebarPeek;
  shortcut?: string | null;
  width?: string;
  widthMobile?: string;
};
export function SidebarProvider({
  ref,
  open: controlled,
  defaultOpen = true,
  onOpenChange,
  persist = true,
  onPersistOpen,
  peek = 'none',
  shortcut,
  width = '16rem',
  widthMobile = '18rem',
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const [internal, setInternal] = useState(defaultOpen);
  const open = controlled ?? internal;
  const [openMobile, setOpenMobileState] = useState(false);
  const mobileReturnFocus = useRef<HTMLElement | null>(null);
  const setOpenMobile = useCallback((value: boolean) => {
    if (value)
      mobileReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenMobileState(value);
  }, []);
  const restoreMobileFocus = useCallback(() => {
    if (mobileReturnFocus.current?.isConnected)
      mobileReturnFocus.current.focus({ preventScroll: true });
  }, []);
  const [isMobile, setIsMobile] = useState(false);
  const [peekRequested, setPeekRequested] = useState(false);
  const [resizedWidth, setWidth] = useState<number | null>(null);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const provider = useRef<HTMLDivElement>(null);
  const peekOpen = !isMobile && !open && peek !== 'none' && peekRequested;
  const dismissPeek = useCallback(() => setPeekRequested(false), []);
  const setOpen = useCallback(
    (value: boolean) => {
      setInternal(value);
      onOpenChange?.(value);
      if (persist) onPersistOpen?.(value);
    },
    [onOpenChange, persist, onPersistOpen],
  );
  const setPeekOpen = useCallback(
    (value: boolean) => setPeekRequested(!isMobile && !open && peek !== 'none' && value),
    [isMobile, open, peek],
  );
  const requestPeek = useCallback(
    (mode: Exclude<SidebarPeek, 'none'>) => {
      if (peek === mode) setPeekOpen(true);
    },
    [peek, setPeekOpen],
  );
  const toggle = useCallback(() => {
    dismissPeek();
    if (isMobile) setOpenMobile(!openMobile);
    else setOpen(!open);
  }, [dismissPeek, isMobile, open, openMobile, setOpen, setOpenMobile]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => {
      setIsMobile(query.matches);
      dismissPeek();
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [dismissPeek]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && peekOpen) {
        event.preventDefault();
        dismissPeek();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing)
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        active.closest('[data-slot="sidebar-wrapper"]') !== provider.current
      )
        return;
      const key = shortcut === undefined ? (side === 'left' ? '[' : ']') : shortcut;
      if (key === null || event.key !== key) return;
      event.preventDefault();
      toggle();
    };
    const pointerdown = (event: PointerEvent) => {
      if (peekOpen && !provider.current?.contains(event.target as Node)) dismissPeek();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('pointerdown', pointerdown);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('pointerdown', pointerdown);
    };
  }, [peekOpen, shortcut, side, dismissPeek, toggle]);
  const resolvedWidth = resizedWidth === null ? width : `${resizedWidth}px`;
  const context = useMemo<SidebarState>(
    () => ({
      open,
      state: open ? 'expanded' : 'collapsed',
      setOpen,
      openMobile,
      setOpenMobile,
      restoreMobileFocus,
      isMobile,
      peek,
      peekOpen,
      setPeekOpen,
      requestPeek,
      dismissPeek,
      side,
      setSide,
      width: resolvedWidth,
      widthMobile,
      setWidth,
      toggle,
    }),
    [
      open,
      setOpen,
      openMobile,
      setOpenMobile,
      restoreMobileFocus,
      isMobile,
      peek,
      peekOpen,
      setPeekOpen,
      requestPeek,
      dismissPeek,
      side,
      resolvedWidth,
      widthMobile,
      toggle,
    ],
  );
  return (
    <SidebarContext value={context}>
      <TooltipProvider delayDuration={0}>
        <div
          {...props}
          ref={(node) => {
            provider.current = node;
            if (typeof ref === 'function') return ref(node);
            if (ref) ref.current = node;
          }}
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': resolvedWidth,
              '--sidebar-width-mobile': widthMobile,
              ...style,
            } as CSSProperties
          }
          className={cn(
            'group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full',
            className,
          )}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext>
  );
}
