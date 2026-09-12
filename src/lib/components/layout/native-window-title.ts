export interface NativeWindowTitleContext {
  focusedTabTitle?: string | null;
  workspaceTitle?: string | null;
  branch?: string | null;
}

const FALLBACK_TITLE = 'Intent'; // i18n-ignore (brand name)

export function formatNativeWindowTitle({
  focusedTabTitle,
  workspaceTitle,
  branch,
}: NativeWindowTitleContext): string {
  const parts = [focusedTabTitle, workspaceTitle, branch]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(' — ') : FALLBACK_TITLE;
}
