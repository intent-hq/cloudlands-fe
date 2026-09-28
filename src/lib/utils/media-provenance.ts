/** File media implicitly reads the head workspace; node transcripts cannot use it.
 * Embedded bytes, published web URLs and note assets have independent provenance.
 * This is a provenance check, not a replacement for HTML/URL sanitization.
 */
export function canLoadMediaUrl(url: string, allowFileMedia: boolean): boolean {
  return allowFileMedia || /^(?:https?:|data:|blob:|workspace-asset:)/i.test(url.trim());
}

/** Filter already-sanitized Markdown in an inert template, before live DOM mounting. */
export function filterFileMedia(html: string, allowFileMedia: boolean): string {
  if (allowFileMedia || !html) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const media of template.content.querySelectorAll('img, video')) {
    const source = media.getAttribute('src') || media.getAttribute('data-media-src') || '';
    const sources = [...media.querySelectorAll('source')];
    if (
      !canLoadMediaUrl(source, false) ||
      sources.some((child) => !canLoadMediaUrl(child.getAttribute('src') || '', false))
    ) {
      // No original URL/path survives into the fallback's file recovery actions.
      const placeholder = document.createElement('img');
      placeholder.setAttribute(
        'alt',
        media.getAttribute('alt') || media.getAttribute('data-name') || '',
      );
      placeholder.setAttribute('data-media-unavailable', 'node-owned');
      media.replaceWith(placeholder);
      continue;
    }
    // srcset is not emitted by the Markdown processor. Do not let an alternate
    // candidate or poster reintroduce an implicit file read.
    media.removeAttribute('srcset');
    const poster = media.getAttribute('poster');
    if (poster && !canLoadMediaUrl(poster, false)) media.removeAttribute('poster');
  }
  return template.innerHTML;
}
