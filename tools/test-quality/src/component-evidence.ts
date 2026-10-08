import { parse } from 'svelte/compiler';

export interface TemplateEvidence {
  start: number;
  end: number;
  code: string;
  names: string[];
  events: string[];
  handlers?: Record<string, string[]>;
  component?: string;
}

/** Read bindings, including inline handlers, without assuming template line positions. */
export function templateEvidence(text: string): TemplateEvidence[] {
  const ast = parse(text, { modern: true });
  const result: TemplateEvidence[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const n = value as Record<string, unknown>;
    if (Array.isArray(n.attributes) && typeof n.start === 'number') {
      const attributes = n.attributes as {
        start: number;
        end: number;
        name?: string;
        type: string;
      }[];
      // Attribute ends are parser positions, so > inside an inline handler cannot end the tag.
      const end = attributes.length
        ? Math.max(...attributes.map((a) => a.end))
        : n.start + String(n.name).length + 1;
      const closing = text.indexOf('>', end);
      const tagEnd = closing < 0 ? end : closing + 1;
      const elementEnd = typeof n.end === 'number' && n.end - n.start < 500 ? n.end : tagEnd;
      const code = text.slice(n.start, elementEnd);
      const names = new Set<string>();
      const identifiers = (v: unknown): void => {
        if (!v || typeof v !== 'object') return;
        const node = v as Record<string, unknown>;
        if (node.type === 'Identifier' && typeof node.name === 'string') names.add(node.name);
        for (const [key, child] of Object.entries(node))
          if (key !== 'loc') {
            if (Array.isArray(child)) child.forEach(identifiers);
            else identifiers(child);
          }
      };
      attributes.forEach(identifiers);
      const handlers: Record<string, string[]> = {};
      for (const a of attributes) {
        const event =
          a.type === 'OnDirective'
            ? a.name
            : a.name?.startsWith('on')
              ? a.name.slice(2).toLowerCase()
              : undefined;
        if (!event) continue;
        names.clear();
        identifiers(a);
        handlers[event] = [...names];
      }
      names.clear();
      attributes.forEach(identifiers);
      result.push({
        start: n.start,
        end,
        code,
        names: [...names],
        events: Object.keys(handlers),
        handlers,
        component: n.type === 'Component' ? String(n.name) : undefined,
      });
    }
    if (
      ['IfBlock', 'EachBlock', 'ExpressionTag'].includes(String(n.type)) &&
      typeof n.start === 'number'
    ) {
      const expression = n.expression as { start?: number; end?: number } | undefined;
      if (expression?.end && expression.start !== undefined) {
        const code = text.slice(n.start, expression.end) + '}';
        result.push({
          start: n.start,
          end: expression.end,
          code,
          names: [
            ...new Set(
              text.slice(expression.start, expression.end).match(/[A-Za-z_$][\w$]*/g) ?? [],
            ),
          ],
          events: [],
        });
      }
    }
    for (const [key, child] of Object.entries(n))
      if (!['loc', 'instance', 'module', 'css', 'attributes'].includes(key)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
  };
  visit(ast.fragment);
  return result;
}
