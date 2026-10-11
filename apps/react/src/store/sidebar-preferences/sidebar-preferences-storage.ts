import { SIDEBAR_COOKIE_MAX_AGE, SIDEBAR_COOKIE_NAME } from '$lib/components/ui/sidebar/constants';

export function saveSidebarOpen(open: boolean): void {
  try {
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  } catch {
    // The sidebar remains usable when browser storage is unavailable.
  }
}
