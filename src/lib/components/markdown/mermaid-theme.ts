import type { MermaidConfig } from 'mermaid';

type TokenStyle = Pick<CSSStyleDeclaration, 'getPropertyValue' | 'fontSize'>;

export const MERMAID_FONT_FAMILY =
  "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; // i18n-ignore (CSS font-family identifiers)
export const MERMAID_PRIMARY_FONT = 'Inter'; // i18n-ignore (CSS font-family identifier)

function readToken(styles: TokenStyle, name: string, fallbackName?: string): string {
  const value = styles.getPropertyValue(name).trim();
  if (!value && fallbackName) return readToken(styles, fallbackName);
  if (!value) throw new Error(`Missing Mermaid design token: ${name}`);
  return value;
}

function readColor(styles: TokenStyle, name: string, fallbackName?: string): string {
  const value = readToken(styles, name, fallbackName);
  if (value.startsWith('color-mix(') && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      return alpha === 255
        ? `rgb(${red}, ${green}, ${blue})`
        : `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
    }
  }
  return /^(#|rgb|hsl|oklch|color(?:-mix)?\()/.test(value) ? value : `hsl(${value})`;
}

function readPixelSize(styles: TokenStyle, name: string, fallbackName?: string): string {
  const value = readToken(styles, name, fallbackName);
  if (!value.endsWith('rem')) return value;
  const rootFontSize = Number.parseFloat(styles.fontSize);
  if (!Number.isFinite(rootFontSize)) throw new Error('Missing root font size for Mermaid');
  return `${Number.parseFloat(value) * rootFontSize}px`;
}

export function createMermaidConfig(styles: TokenStyle, htmlLabels = true): MermaidConfig {
  const foreground = readColor(styles, '--foreground');
  const cardForeground = readColor(styles, '--card-foreground');
  const muted = readColor(styles, '--muted');
  const border = readColor(styles, '--border');
  const accent = readColor(styles, '--accent');
  const accentForeground = readColor(styles, '--accent-foreground');
  const canvas = readColor(styles, '--diagram-canvas', '--background');
  const nodeSurface = readColor(styles, '--diagram-node-surface', '--card');
  const connector = readColor(styles, '--diagram-connector', '--muted-foreground');
  const metadata = readColor(styles, '--muted-foreground');
  const fontFamily = styles.getPropertyValue('--font-ui').trim() || MERMAID_FONT_FAMILY;
  const fontSize = readPixelSize(styles, '--text-caption-size');
  readToken(styles, '--radius-small');

  return {
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily,
    fontSize: Number.parseFloat(fontSize),
    htmlLabels,
    flowchart: {
      useMaxWidth: false,
      curve: 'stepAfter',
      diagramPadding: 8,
      nodeSpacing: 32,
      rankSpacing: 40,
      wrappingWidth: 200,
    },
    sequence: {
      useMaxWidth: false,
      wrap: true,
      mirrorActors: false,
      actorMargin: 40,
      boxMargin: 8,
      boxTextMargin: 6,
      noteMargin: 8,
      messageMargin: 24,
      width: 140,
      wrapPadding: 6,
    },
    class: { defaultRenderer: 'dagre-d3', htmlLabels: false },
    state: {
      defaultRenderer: 'dagre-d3',
      nodeSpacing: 48,
      rankSpacing: 48,
      padding: 8,
    },
    themeVariables: {
      background: canvas,
      primaryColor: nodeSurface,
      primaryTextColor: foreground,
      primaryBorderColor: nodeSurface,
      secondaryColor: muted,
      secondaryTextColor: foreground,
      secondaryBorderColor: muted,
      tertiaryColor: canvas,
      tertiaryTextColor: foreground,
      tertiaryBorderColor: border,
      lineColor: connector,
      arrowheadColor: connector,
      textColor: foreground,
      mainBkg: nodeSurface,
      nodeBkg: nodeSurface,
      nodeBorder: nodeSurface,
      nodeTextColor: cardForeground,
      clusterBkg: canvas,
      clusterBorder: border,
      defaultLinkColor: connector,
      edgeLabelBackground: canvas,
      titleColor: foreground,
      actorBkg: nodeSurface,
      actorBorder: nodeSurface,
      actorTextColor: cardForeground,
      actorLineColor: border,
      signalColor: connector,
      signalTextColor: foreground,
      labelBoxBkgColor: muted,
      labelBoxBorderColor: border,
      labelTextColor: foreground,
      loopTextColor: foreground,
      activationBkgColor: accent,
      activationBorderColor: border,
      noteBkgColor: accent,
      noteBorderColor: border,
      noteTextColor: accentForeground,
      transitionColor: connector,
      transitionLabelColor: metadata,
      stateBkg: nodeSurface,
      stateLabelColor: cardForeground,
      labelBackgroundColor: canvas,
      compositeBackground: canvas,
      compositeTitleBackground: canvas,
      compositeBorder: border,
      classText: cardForeground,
      fillType0: nodeSurface,
      fillType1: muted,
      fontFamily,
    },
  };
}

let renderQueue = Promise.resolve();

export function runSerializedMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const result = renderQueue.then(task, task);
  renderQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
