/** Load editor infrastructure without importing the normal renderer store or selectors. */
export async function initializePayloadMonaco() {
  const [workers, themes] = await Promise.all([
    import('$lib/utils/monaco-workers'),
    import('$lib/utils/monaco-theme'),
  ]);
  await workers.configureMonacoWorkers();
  return {
    monaco: workers.monaco,
    defineMonacoThemes: themes.defineMonacoThemes,
    getActiveMonacoThemeName: themes.getActiveMonacoThemeName,
  };
}
