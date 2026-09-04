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

function readColor(styles: TokenStyle, name: string): string {
  const value = readToken(styles, name);
  return /^(#|rgb|hsl|oklch|color\()/.test(value) ? value : `hsl(${value})`;
}

function readPixelSize(styles: TokenStyle, name: string, fallbackName?: string): string {
  const value = readToken(styles, name, fallbackName);
  if (!value.endsWith('rem')) return value;
  const rootFontSize = Number.parseFloat(styles.fontSize);
  if (!Number.isFinite(rootFontSize)) throw new Error('Missing root font size for Mermaid');
  return `${Number.parseFloat(value) * rootFontSize}px`;
}

export function createMermaidConfig(styles: TokenStyle, htmlLabels = true): MermaidConfig {
  const background = readColor(styles, '--background');
  const foreground = readColor(styles, '--foreground');
  const card = readColor(styles, '--card');
  const cardForeground = readColor(styles, '--card-foreground');
  const muted = readColor(styles, '--muted');
  const mutedForeground = readColor(styles, '--muted-foreground');
  const border = readColor(styles, '--border');
  const accent = readColor(styles, '--accent');
  const accentForeground = readColor(styles, '--accent-foreground');
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
    },
    class: { defaultRenderer: 'dagre-d3', htmlLabels: false },
    state: {
      defaultRenderer: 'dagre-d3',
      nodeSpacing: 48,
      rankSpacing: 48,
      padding: 8,
    },
    themeVariables: {
      background,
      primaryColor: card,
      primaryTextColor: cardForeground,
      primaryBorderColor: border,
      secondaryColor: muted,
      secondaryTextColor: foreground,
      secondaryBorderColor: border,
      tertiaryColor: background,
      tertiaryTextColor: foreground,
      tertiaryBorderColor: border,
      lineColor: mutedForeground,
      arrowheadColor: mutedForeground,
      textColor: foreground,
      mainBkg: card,
      nodeBkg: card,
      nodeBorder: border,
      nodeTextColor: cardForeground,
      clusterBkg: muted,
      clusterBorder: border,
      defaultLinkColor: mutedForeground,
      edgeLabelBackground: background,
      titleColor: foreground,
      actorBkg: card,
      actorBorder: border,
      actorTextColor: cardForeground,
      actorLineColor: border,
      signalColor: mutedForeground,
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
      transitionColor: mutedForeground,
      transitionLabelColor: foreground,
      stateBkg: card,
      stateLabelColor: cardForeground,
      labelBackgroundColor: background,
      compositeBackground: muted,
      compositeTitleBackground: muted,
      compositeBorder: border,
      classText: cardForeground,
      fillType0: card,
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
