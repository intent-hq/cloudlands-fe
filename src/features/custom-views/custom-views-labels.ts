import { m } from '$shared/paraglide/messages.js';
import {
  faGlobe,
  faCode,
  faChartLine,
  faBook,
  faTerminal,
  faTableColumns,
} from '@fortawesome/free-solid-svg-icons';
import type {
  CustomViewErrorCode,
  CustomViewIcon,
  CustomViewRuntime,
} from '$shared/types/custom-views';

export const customViewIconDefinitions = {
  globe: faGlobe,
  code: faCode,
  chart: faChartLine,
  book: faBook,
  terminal: faTerminal,
  grid: faTableColumns,
};
export function customViewIconLabel(icon: CustomViewIcon): string {
  return {
    globe: m.custom_views_icon_globe,
    code: m.custom_views_icon_code,
    chart: m.custom_views_icon_chart,
    book: m.custom_views_icon_book,
    terminal: m.custom_views_icon_terminal,
    grid: m.custom_views_icon_grid,
  }[icon]();
}
export function customViewStatusLabel(status: CustomViewRuntime['status']): string {
  return {
    stopped: m.custom_views_stopped,
    starting: m.custom_views_starting,
    running: m.custom_views_running,
    error: m.custom_views_failed,
  }[status]();
}
export function customViewErrorMessage(code: CustomViewErrorCode): string {
  return {
    'invalid-input': m.custom_views_error_invalid,
    'not-found': m.custom_views_error_missing,
    'port-in-use': m.custom_views_error_port,
    'directory-unavailable': m.custom_views_error_directory,
    'start-failed': m.custom_views_error_start,
    'server-exited': m.custom_views_error_exit,
    'startup-timeout': m.custom_views_error_timeout,
    'storage-failed': m.custom_views_error_storage,
    'desktop-only': m.custom_views_error_desktop,
  }[code]();
}
