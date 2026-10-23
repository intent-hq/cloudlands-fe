/** Keep agent and discussion composers aligned as their panels and drafts change. */
export function composerMinHeight(panelHeight: number | null, hasContent: boolean): number {
  // The agent input's editor, toolbar, padding and borders need 82px even empty.
  // Use that rendered baseline for both composers, including compact panels.
  return panelHeight && panelHeight > 640 && hasContent ? 100 : 82;
}
