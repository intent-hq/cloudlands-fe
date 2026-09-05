import { describe, expect, it } from 'vitest';
import {
  createMermaidConfig,
  MERMAID_FONT_FAMILY,
  runSerializedMermaidRender,
} from '../mermaid-theme';

const baseTokens = {
  '--background': '0 0% 100%',
  '--foreground': '0 0% 8%',
  '--card': '0 0% 98%',
  '--card-foreground': '0 0% 8%',
  '--muted': '210 12% 92%',
  '--muted-foreground': '210 8% 35%',
  '--border': '210 10% 82%',
  '--accent': '145 30% 90%',
  '--accent-foreground': '145 50% 20%',
  '--diagram-canvas': 'hsl(0 0% 100%)',
  '--diagram-node-surface': 'hsl(0 0% 96%)',
  '--diagram-connector': 'rgb(118 124 132)',
  '--font-ui': "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  '--text-caption-size': '0.8125rem',
  '--radius-small': '5px',
};

function styles(tokens: Record<string, string> = baseTokens) {
  return {
    fontSize: '16px',
    getPropertyValue: (name: string) => tokens[name] ?? '',
  } as CSSStyleDeclaration;
}

describe('Mermaid design-system theme', () => {
  it('maps app tokens to every shared Mermaid visual role', () => {
    const config = createMermaidConfig(styles());
    const theme = config.themeVariables;

    expect(config).toMatchObject({
      theme: 'base',
      securityLevel: 'loose',
      fontFamily: MERMAID_FONT_FAMILY,
      fontSize: 13,
      htmlLabels: true,
    });
    expect(config).not.toHaveProperty('layout');
    expect(config.class).toEqual({ defaultRenderer: 'dagre-d3', htmlLabels: false });
    expect(config.state).toEqual({
      defaultRenderer: 'dagre-d3',
      nodeSpacing: 48,
      rankSpacing: 48,
      padding: 8,
    });
    expect(config.flowchart).toMatchObject({
      curve: 'stepAfter',
      diagramPadding: 8,
      nodeSpacing: 32,
      rankSpacing: 40,
      wrappingWidth: 200,
    });
    expect(config.sequence).toMatchObject({
      actorMargin: 40,
      messageMargin: 24,
      width: 140,
      wrapPadding: 6,
    });
    expect(theme).toMatchObject({
      background: 'hsl(0 0% 100%)',
      primaryColor: 'hsl(0 0% 96%)',
      primaryTextColor: 'hsl(0 0% 8%)',
      primaryBorderColor: 'hsl(0 0% 96%)',
      lineColor: 'rgb(118 124 132)',
      arrowheadColor: 'rgb(118 124 132)',
      edgeLabelBackground: 'hsl(0 0% 100%)',
      clusterBkg: 'hsl(0 0% 100%)',
      actorBkg: 'hsl(0 0% 96%)',
      noteBkgColor: 'hsl(145 30% 90%)',
      noteTextColor: 'hsl(145 50% 20%)',
      stateBkg: 'hsl(0 0% 96%)',
      compositeBackground: 'hsl(0 0% 100%)',
      compositeTitleBackground: 'hsl(0 0% 100%)',
      transitionLabelColor: 'hsl(210 8% 35%)',
      classText: 'hsl(0 0% 8%)',
    });
  });

  it('uses current custom-theme values without a separate palette', () => {
    const custom = {
      ...baseTokens,
      '--diagram-node-surface': '#201f2b',
      '--border': 'rgb(88 86 112)',
    };
    const theme = createMermaidConfig(styles(custom)).themeVariables;

    expect(theme.primaryColor).toBe('#201f2b');
    expect(theme.primaryBorderColor).toBe('#201f2b');
    expect(theme.actorBkg).toBe('#201f2b');
  });

  it('supports SVG labels for grammars that do not need flowchart HTML wrapping', () => {
    expect(createMermaidConfig(styles(), false).htmlLabels).toBe(false);
  });

  it('measures every diagram with the application UI stack', () => {
    expect(createMermaidConfig(styles())).toMatchObject({
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 13,
    });
  });

  it('serializes Mermaid global initialization and rendering', async () => {
    const events: string[] = [];
    let finishFirst!: () => void;
    const first = runSerializedMermaidRender(
      () =>
        new Promise<void>((resolve) => {
          events.push('first:start');
          finishFirst = () => {
            events.push('first:end');
            resolve();
          };
        }),
    );
    const second = runSerializedMermaidRender(async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    finishFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });
});
