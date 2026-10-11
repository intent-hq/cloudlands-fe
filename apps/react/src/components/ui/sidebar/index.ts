import './sidebar.css';
export {
  SidebarProvider,
  SidebarProvider as Provider,
  useSidebar,
  type SidebarProviderProps,
  type SidebarState,
  type SidebarPeek,
} from './context';
export { Sidebar, Sidebar as Root, type SidebarProps } from './sidebar';
export { SidebarRail, SidebarRail as Rail } from './sidebar-rail';
export {
  SidebarHeader,
  SidebarHeader as Header,
  SidebarFooter,
  SidebarFooter as Footer,
  SidebarContent,
  SidebarContent as Content,
  SidebarInset,
  SidebarInset as Inset,
  SidebarInput,
  SidebarInput as Input,
  SidebarSeparator,
  SidebarSeparator as Separator,
  SidebarTrigger,
  SidebarTrigger as Trigger,
  SidebarCallout,
  SidebarCallout as Callout,
  SidebarMenuSkeleton,
  SidebarMenuSkeleton as MenuSkeleton,
} from './sidebar-layout';
export {
  SidebarGroup,
  SidebarGroup as Group,
  SidebarGroupLabel,
  SidebarGroupLabel as GroupLabel,
  SidebarGroupContent,
  SidebarGroupContent as GroupContent,
  SidebarGroupAction,
  SidebarGroupAction as GroupAction,
  SidebarGroupActions,
  SidebarGroupActions as GroupActions,
  type SidebarGroupProps,
} from './sidebar-group';
export { SidebarMenu, SidebarMenu as Menu } from './sidebar-menu';
export {
  SidebarMenuItem,
  SidebarMenuItem as MenuItem,
  SidebarMenuSub,
  SidebarMenuSub as MenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubItem as MenuSubItem,
} from './sidebar-menu-row';
export {
  SidebarMenuButton,
  SidebarMenuButton as MenuButton,
  SidebarMenuSubButton,
  SidebarMenuSubButton as MenuSubButton,
  sidebarMenuButtonVariants,
  type SidebarMenuButtonProps,
  type SidebarMenuSubButtonProps,
  type SidebarMenuButtonSize,
  type SidebarMenuButtonVariant,
} from './sidebar-menu-button';
export {
  SidebarMenuAction,
  SidebarMenuAction as MenuAction,
  SidebarMenuActions,
  SidebarMenuActions as MenuActions,
  SidebarMenuBadge,
  SidebarMenuBadge as MenuBadge,
} from './sidebar-menu-actions';
export {
  SidebarHarness,
  SidebarHarness as Harness,
  type SidebarHarnessProps,
} from './sidebar-harness';
export { sidebarMetadata } from '$lib/components/ui/sidebar/sidebar.meta';
