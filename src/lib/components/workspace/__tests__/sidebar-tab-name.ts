const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Matches a sidebar section tab by label whether or not it is announced "(in use)":
 * Browsers and Shells add that suffix while the workspace has browser tabs, terminals or
 * a live script (cloudlands-fe #4809).
 */
export function inUseTab(label: string): RegExp {
  return new RegExp(`^${escape(label)}(?: \\(in use\\))?$`);
}
