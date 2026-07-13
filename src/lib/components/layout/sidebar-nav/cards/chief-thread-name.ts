import { DEFAULT_CHIEF_THREAD_TITLE } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';

export function formatChiefThreadName(_date: Date): string {
  return DEFAULT_CHIEF_THREAD_TITLE;
}
