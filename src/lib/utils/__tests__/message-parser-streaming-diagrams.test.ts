import { describe, expect, it } from 'vitest';
import { parseAgentMessage } from '../messageParser';
import { scanMessageFences } from '../message-fences';

// Mermaid's installed detector inventory, including aliases and beta grammars.
const families = [
  'graph LR',
  'flowchart LR',
  'flowchart-elk LR',
  'swimlane-beta',
  'erDiagram',
  'gitGraph',
  'gantt',
  'info',
  'pie',
  'quadrantChart',
  'xychart',
  'xychart-beta',
  'requirementDiagram',
  'sequenceDiagram',
  'classDiagram',
  'classDiagram-v2',
  'stateDiagram',
  'stateDiagram-v2',
  'journey',
  'timeline',
  'mindmap',
  'kanban',
  'sankey-beta',
  'packet-beta',
  'radar-beta',
  'block-beta',
  'treeView-beta',
  'architecture-beta',
  'eventmodeling',
  'ishikawa-beta',
  'venn-beta',
  'treemap-beta',
  'wardley-beta',
  'cynefin-beta',
  'railroad-beta',
  'railroad-ebnf-beta',
  'railroad-abnf-beta',
  'railroad-peg-beta',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];
const parse = (text: string, isStreaming = true) =>
  parseAgentMessage(text, undefined, { isStreaming });

describe('streaming diagram fences', () => {
  it.each(families)('keeps %s source intact without requiring closure', (source) => {
    const result = parse(`Before\n\n~~~mermaid\n${source}\n`);
    expect(result.map((block) => block.type)).toEqual(['text', 'mermaid']);
    expect(result[1]).toMatchObject({
      content: source,
      metadata: { isStreaming: true, rawSource: `${source}\n` },
    });
    expect(parse(`~~~mermaid\n${source}`, false)[0]).toMatchObject({
      type: 'mermaid',
      metadata: { isStreaming: false },
    });
  });

  it.each(['```', '````', '~~~', '~~~~~'])('tracks %s through partial closure', (fence) => {
    const start = `Before\n${fence}mermaid\nflowchart LR\n A --> B\n`;
    for (let i = 1; i < fence.length; i++) {
      expect(parse(start + fence.slice(0, i))[1].metadata?.isStreaming).toBe(true);
    }
    const closed = parse(start + fence + '\nAfter');
    expect(closed.map((block) => block.type)).toEqual(['text', 'mermaid', 'text']);
    expect(closed[1].metadata?.isStreaming).toBe(false);
    expect(closed[2].content).toBe('After');
    expect(closed[1].metadata?.fenceStart).toBe(parse(start)[1].metadata?.fenceStart);
  });

  it('does not promote partial opening declarations, escaped or nested examples', () => {
    for (const text of [
      '```mer',
      '```mermaid',
      '\\```mermaid\nA',
      'Use ```mermaid\nA',
      '````markdown\n```mermaid\nflowchart LR\n```\n````',
      '~~~text\n```mermaid\nflowchart LR\n```\n~~~',
    ]) {
      expect(parse(text).some((block) => block.type === 'mermaid')).toBe(false);
    }
  });

  it('requires matching marker type and sufficient length', () => {
    const text = '````mermaid\nflowchart LR\n```\n~~~\nA --> B\n`````\nAfter';
    const result = parse(text);
    expect(result[0].content).toBe('flowchart LR\n```\n~~~\nA --> B');
    expect(result[0].metadata?.isStreaming).toBe(false);
    expect(result[1].content).toBe('After');
  });

  it('handles multiple blocks, CRLF, indentation and final state', () => {
    const text =
      'Prose\r\n  ~~~mermaid\r\nflowchart LR\r\nA-->B\r\n  ~~~\r\n' +
      'Middle\n```mermaid\nsequenceDiagram\nA->>B: Ready';
    const result = parse(text);
    expect(result.map((block) => block.type)).toEqual(['text', 'mermaid', 'text', 'mermaid']);
    expect(result[1].metadata?.isStreaming).toBe(false);
    expect(result[3].metadata?.isStreaming).toBe(true);
    expect(parse(text, false)[3].metadata?.isStreaming).toBe(false);
  });

  it.each(['diagram', 'ws-block:diagram'])('preserves raw %s while JSON is incomplete', (lang) => {
    const result = parse(`~~~${lang}\n{ "type": "flowchart", "nodes": [`);
    expect(result[0]).toMatchObject({ type: 'diagram', metadata: { isStreaming: true } });
    expect(result[0].metadata?.rawSource).toBe('{ "type": "flowchart", "nodes": [');
    expect(parse(`~~~${lang}\n{`, false)[0]).toMatchObject({
      type: 'diagram',
      metadata: { isStreaming: false },
    });
  });

  it.each(['diagram', 'ws-block:diagram'])(
    'rejects a %s fence that never closed even when its JSON root looks complete',
    (lang) => {
      const validRoot = JSON.stringify({
        id: '10000000-0000-4000-8000-000000000001',
        type: 'diagram',
        version: 1,
        createdAt: '2026-09-22T00:00:00.000Z',
        createdBy: 'agent',
        grammar: 'flowchart',
        baseView: { layout: { type: 'layered', direction: 'LR' } },
        model: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
      });
      const streamEnded = parse(`~~~${lang}\n${validRoot}`, false)[0];
      expect(streamEnded).toMatchObject({ type: 'diagram', metadata: { isStreaming: false } });
      expect(streamEnded.metadata?.diagramData).toBeNull();
      expect(streamEnded.metadata?.diagramError).toBeTruthy();
      // A properly closed fence with the identical JSON root is still accepted.
      const closed = parse(`~~~${lang}\n${validRoot}\n~~~`, false)[0];
      expect(closed.metadata?.diagramData).not.toBeNull();
      expect(closed.metadata?.diagramError).toBeUndefined();
      // Mid-stream, the same unclosed fence still renders its live preview.
      const midStream = parse(`~~~${lang}\n${validRoot}`, true)[0];
      expect(midStream.metadata?.isStreaming).toBe(true);
      expect(midStream.metadata?.diagramData).not.toBeNull();
    },
  );

  it('does not change ordinary closed code-fence content', () => {
    const source = '~~~typescript\nconst x = "```mermaid";\n~~~\nText';
    expect(scanMessageFences(source)).toHaveLength(1);
    expect(parse(source)[0]).toMatchObject({ type: 'code', content: 'const x = "```mermaid";' });
  });

  it('lets explicit snippet wrappers own diagram examples', () => {
    const result = parse(
      '<augment_code_snippet path="example.mmd">\n````mermaid\nflowchart LR\nA-->B\n````\n</augment_code_snippet>',
    );
    expect(result.map((block) => block.type)).toEqual(['augment_code_snippet']);
  });
});
