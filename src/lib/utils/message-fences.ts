interface MessageFence {
  start: number;
  end: number;
  language: string;
  source: string;
  closed: boolean;
}

/** Scan actual Markdown fences, including ordinary code fences that shield examples. */
export function scanMessageFences(content: string): MessageFence[] {
  const fences: MessageFence[] = [];
  const lines = content.matchAll(/[^\n]*(?:\n|$)/g);
  let open: { start: number; body: number; marker: string; language: string } | undefined;
  for (const line of lines) {
    if (!line[0]) continue;
    const text = line[0].replace(/\r?\n$/, '');
    const position = line.index;
    if (open) {
      const close = text.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        fences.push({
          start: open.start,
          end: position + line[0].length,
          language: open.language,
          source: content.slice(open.body, position),
          closed: true,
        });
        open = undefined;
      }
      continue;
    }
    const opening = text.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) continue;
    open = {
      start: position,
      body: position + line[0].length,
      marker: opening[1],
      // An incomplete opening line is not yet a diagram declaration.
      language: line[0].endsWith('\n') ? opening[2].trim() : '',
    };
  }
  if (open) {
    fences.push({
      start: open.start,
      end: content.length,
      language: open.language,
      source: content.slice(open.body),
      closed: false,
    });
  }
  return fences;
}
