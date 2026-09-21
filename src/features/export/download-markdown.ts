/** Download the exact Markdown body, without a title/frontmatter wrapper. */
export function downloadMarkdown(content: string, title: string): void {
  const stem =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .replace(/\.md$/i, '')
      .slice(0, 120) || 'document'; // i18n-ignore (fallback filename)
  const filename = `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem) ? '_' : ''}${stem}.md`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Let the browser consume the download URL before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
