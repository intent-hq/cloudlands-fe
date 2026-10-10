/** Test-only backing index metadata. Offsets are source UTF-16, never editor positions. */
export type Fence = {
  from: number;
  bodyFrom: number;
  bodyTo: number;
  to: number;
  opening: string;
  closing: string;
  language: string | null;
};

/** Full-region scan belongs to the mock backing index, not the renderer. */
export function scanFences(source: string): Fence[] {
  const fences: Fence[] = [];
  const lines = /^(`{3,}|~{3,})([^\n]*)\n/gm;
  let match: RegExpExecArray | null;
  while ((match = lines.exec(source))) {
    const [opening, marker, info] = match;
    if (marker[0] === '`' && info.includes('`')) continue;
    const bodyFrom = lines.lastIndex;
    const close = new RegExp(`^${marker[0]}{${marker.length},}[ \\t]*(?:\\n|$)`, 'gm');
    close.lastIndex = bodyFrom;
    const end = close.exec(source);
    const endFrom = end?.index ?? source.length;
    const bodyTo = endFrom > bodyFrom && source[endFrom - 1] === '\n' ? endFrom - 1 : endFrom;
    let to = end ? close.lastIndex : source.length;
    if (source[to] === '\n') to++;
    fences.push({
      from: match.index,
      bodyFrom,
      bodyTo,
      to,
      opening,
      closing: source.slice(bodyTo, to),
      language: info.trim().split(/\s+/)[0] || null,
    });
    lines.lastIndex = to;
  }
  return fences;
}
