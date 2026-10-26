/**
 * Pure inline visual runtime: no app DOM, Vite assets, or host styles at import.
 * The renderer and an isolated preview window build the same document from it.
 */
import { INLINE_HTML_STYLES } from './inline-html-styles';
import { isInlineVisualSnapshot, type InlineVisualSnapshot } from './inline-visual-types';

/** Only existing semantic tokens cross the opaque iframe boundary. */
export const INLINE_HTML_THEME_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'primary',
  'primary-ink',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'border',
  'input',
  'ring',
  'danger',
  'danger-background',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'font-ui',
  'font-code',
  'text-body-size',
  'text-body-line-height',
  'text-body-weight',
  'text-body-tracking',
  'radius-small',
  'radius-medium',
  'radius-large',
  'app-background',
  'sidebar',
  'sidebar-accent',
  'agent-avatar-surface-active',
  'agent-avatar-foreground',
  'diagram-host-surface',
  'diagram-canvas',
  'diagram-label-surface',
  'diagram-node-surface',
  'diagram-node-hover-surface',
  'diagram-node-outline',
  'diagram-node-title',
  'diagram-metadata',
  'diagram-group-outline',
  'diagram-connector',
  'diagram-connector-hover',
  'diagram-connector-muted',
  'diagram-connector-inactive',
  'diagram-connector-danger',
  'diagram-connector-success',
  'diagram-connector-warning',
  'diagram-connector-active',
  'diagram-accent',
  'diagram-accent-foreground',
  'diagram-node-radius',
  'diagram-group-radius',
  'diagram-connector-width',
  'text-caption-size',
  'text-caption-line-height',
  'text-caption-weight',
  'text-caption-tracking',
  'text-body-strong-size',
  'text-body-strong-line-height',
  'text-body-strong-weight',
  'text-body-strong-tracking',
  'space-1',
  'space-2',
  'space-3',
  'space-4',
  'space-5',
  'space-6',
  'space-7',
  'control-height-compact',
  'control-height-small',
  'control-height-medium',
  'control-height-large',
  'radius-full',
  'spring-fast',
  'spring-fast-exit',
  'spring-fast-ease',
  'spring-moderate',
  'spring-moderate-exit',
  'spring-moderate-ease',
  'spring-slow',
  'spring-slow-exit',
  'spring-slow-ease',
  'spring-exit-ease',
  'motion-fast',
  'motion-standard',
  'motion-slow',
  'ease-standard',
  'ease-emphasized-out',
  'motion-reduced',
] as const;

export interface InlineHtmlTheme {
  dark: boolean;
  variables: Record<string, string>;
}

export const INLINE_HTML_MIN_HEIGHT = 96;
/** Frames fit content up to this bound; it only stops pages that grow with their frame.
 * Matches T3 Code HTML_RENDER_MAX_FIT_HEIGHT at 4e42eaf4 (MIT; see NOTICE). */
export const INLINE_HTML_MAX_HEIGHT = 20_000;
/** Stage height for pages detected sizing themselves from the frame (vh, height: 100%). */
const INLINE_HTML_VIEWPORT_LOCK_HEIGHT = 480;
export const INLINE_HTML_MAX_SCROLL_DELTA = 512;

const INLINE_HTML_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  'font-src data:',
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Runs before any generated script; do not capture values from this module. */
function installPreviewBridge(
  channel: string,
  initialTheme: InlineHtmlTheme,
  maxScrollDelta: number,
  lockHeight: number,
  initialSnapshot: InlineVisualSnapshot | null,
  validateSnapshot: (value: unknown) => value is InlineVisualSnapshot,
) {
  const scroll = new MessageChannel();
  const postScroll = MessagePort.prototype.postMessage.bind(scroll.port1);
  window.parent.postMessage({ channel, type: 'scroll-port' }, '*', [scroll.port2]);
  const send = (type: string, payload: Record<string, unknown> = {}) => {
    window.parent.postMessage({ channel, type, ...payload }, '*');
  };
  let visualState = initialSnapshot?.state ?? null;
  let pendingSnapshot: InlineVisualSnapshot | null = null;
  let snapshotQueued = false;
  // This is a data-only bridge. App actions stay in the trusted host toolbar.
  Object.defineProperty(window, 'intentVisual', {
    configurable: false,
    writable: false,
    value: Object.freeze({
      get state() {
        return visualState;
      },
      publish(value: unknown): boolean {
        try {
          if (!validateSnapshot(value)) return false;
          const snapshot = JSON.parse(JSON.stringify(value)) as InlineVisualSnapshot;
          visualState = snapshot.state;
          pendingSnapshot = snapshot;
          if (!snapshotQueued) {
            snapshotQueued = true;
            requestAnimationFrame(() => {
              snapshotQueued = false;
              if (pendingSnapshot) send('snapshot', { snapshot: pendingSnapshot });
              pendingSnapshot = null;
            });
          }
          return true;
        } catch {
          return false;
        }
      },
    }),
  });
  let queued = false;
  let sent = -1;
  let lastViewport = innerHeight;
  let lastOverflow = Number.NaN;
  let chase = 0;
  let locked = 0;
  // A page sized from its frame (vh, height: 100% plus margins) outgrows every
  // frame by the same amount. Hold a stable stage instead of growing to the cap.
  const measure = () => {
    queued = false;
    if (!document.body) return;
    let height = Math.ceil(
      Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height),
    );
    const viewport = innerHeight;
    const overflow = height - viewport;
    if (viewport > lastViewport + 1 && overflow > 1 && Math.abs(overflow - lastOverflow) <= 1) {
      chase += 1;
    } else if (viewport !== lastViewport || overflow <= 1) {
      chase = 0;
    }
    lastViewport = viewport;
    lastOverflow = overflow;
    if (!locked && chase >= 3) {
      locked = Math.max(lockHeight, viewport);
      const message =
        'Page height follows the frame (vh units or height: 100%); frame height held.';
      console.warn(message);
      send('layout', { message });
    }
    if (locked) height = Math.min(height, locked);
    if (height === sent) return;
    sent = height;
    send('resize', { height });
  };
  const scheduleMeasure = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };
  const applyTheme = (theme: InlineHtmlTheme) => {
    if (!theme || typeof theme.dark !== 'boolean' || !theme.variables) return;
    const root = document.documentElement;
    root.classList.toggle('dark', theme.dark);
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    const fontSize = theme.variables['--inline-html-root-font-size'];
    if (
      '--inline-html-root-font-size' in initialTheme.variables &&
      typeof fontSize === 'string' &&
      fontSize.length < 512
    )
      root.style.setProperty('--inline-html-root-font-size', fontSize);
    // Restrict incoming variable names to the original, trusted token vocabulary.
    for (const key of Object.keys(initialTheme.variables)) {
      if (key === '--inline-html-root-font-size') continue;
      const value = theme.variables[key];
      if (typeof value === 'string' && value.length < 512) root.style.setProperty(key, value);
    }
    scheduleMeasure();
  };
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || !event.data || event.data.channel !== channel) return;
    if (event.data.type === 'theme') applyTheme(event.data.theme);
  });
  const handleWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      !event.isTrusted ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !event.deltaY ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const canScroll = (element: Element) => {
      const styles = getComputedStyle(element);
      if (
        element !== document.scrollingElement &&
        !/^(auto|scroll|overlay)$/.test(styles.overflowY)
      )
        return false;
      if (/^(hidden|clip)$/.test(styles.overflowY)) return false;
      const maximum = element.scrollHeight - element.clientHeight;
      return (
        maximum > 1 && (event.deltaY < 0 ? element.scrollTop > 1 : element.scrollTop < maximum - 1)
      );
    };
    if (
      event.composedPath().some((target) => target instanceof Element && canScroll(target)) ||
      (document.scrollingElement && canScroll(document.scrollingElement))
    )
      return;
    const unit =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? parseFloat(getComputedStyle(document.body).lineHeight) || 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? innerHeight
          : 1;
    const deltaY = Math.max(-maxScrollDelta, Math.min(maxScrollDelta, event.deltaY * unit));
    if (!Number.isFinite(deltaY)) return;
    event.preventDefault();
    postScroll({ deltaY });
  };
  window.addEventListener(
    'wheel',
    () => {
      // Run after the visual's handlers, including handlers added later.
      window.removeEventListener('wheel', handleWheel);
      window.addEventListener('wheel', handleWheel, { passive: false });
    },
    { capture: true, passive: false },
  );
  window.addEventListener('error', (event: ErrorEvent) => {
    if (event.message) send('error', { message: event.message.slice(0, 300) });
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    send('error', {
      message: String(reason instanceof Error ? reason.message : reason).slice(0, 300),
    });
  });
  // Preserve local fragment links; external and app links never activate.
  window.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a, area') : null;
      if (!target) return;
      const href = target.getAttribute('href') ?? target.getAttribute('xlink:href');
      if (!href?.startsWith('#')) event.preventDefault();
    },
    true,
  );
  window.addEventListener('submit', (event) => event.preventDefault(), true);
  applyTheme(initialTheme);
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      const observer = new ResizeObserver(scheduleMeasure);
      observer.observe(document.body);
      new MutationObserver(scheduleMeasure).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      window.addEventListener('resize', scheduleMeasure);
      document.addEventListener('load', scheduleMeasure, true);
      void document.fonts.ready.then(scheduleMeasure);
      send('ready');
      scheduleMeasure();
    },
    { once: true },
  );
}

/** Trusted shell: authored scripts never run in the document owning this CSP. */
function installPreviewShell(
  channel: string,
  childDocument: string,
  frameTitle: string,
  maxScrollDelta: number,
  validateSnapshot: (value: unknown) => value is InlineVisualSnapshot,
) {
  const child = document.createElement('iframe');
  child.setAttribute('sandbox', 'allow-scripts');
  child.setAttribute('referrerpolicy', 'no-referrer');
  child.title = frameTitle;
  child.style.cssText = 'display:block;width:100%;height:100%;border:0;';
  let scrollPort: MessagePort | undefined;
  const handleScroll = (event: MessageEvent) => {
    const deltaY = event.data?.deltaY;
    if (
      typeof deltaY === 'number' &&
      Number.isFinite(deltaY) &&
      deltaY !== 0 &&
      Math.abs(deltaY) <= maxScrollDelta
    ) {
      window.parent.postMessage({ channel, type: 'wheel', deltaY }, '*');
    }
  };
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.channel !== channel) return;
    if (event.source === window.parent && data.type === 'theme') {
      child.contentWindow?.postMessage({ channel, type: 'theme', theme: data.theme }, '*');
      return;
    }
    if (event.source !== child.contentWindow || event.origin !== 'null') return;
    if (data.type === 'scroll-port' && !scrollPort && event.ports.length === 1) {
      // The trusted bootstrap sends this port before any authored script runs.
      scrollPort = event.ports[0];
      scrollPort.onmessage = handleScroll;
      return;
    }
    if (
      data.type === 'resize' &&
      typeof data.height === 'number' &&
      Number.isFinite(data.height) &&
      data.height >= 0
    ) {
      window.parent.postMessage({ channel, type: 'resize', height: data.height }, '*');
    } else if (data.type === 'ready') {
      window.parent.postMessage({ channel, type: 'ready' }, '*');
    } else if (
      (data.type === 'error' || data.type === 'layout') &&
      typeof data.message === 'string'
    ) {
      window.parent.postMessage(
        { channel, type: data.type, message: data.message.slice(0, 300) },
        '*',
      );
    } else if (data.type === 'snapshot' && validateSnapshot(data.snapshot)) {
      window.parent.postMessage({ channel, type: 'snapshot', snapshot: data.snapshot }, '*');
    }
  });
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      child.srcdoc = childDocument;
      document.body.append(child);
    },
    { once: true },
  );
}

/** Serializable inputs: the builder below must only reference its parameters. */
interface InlineHtmlRuntimeParts {
  csp: string;
  styles: string;
  maxScrollDelta: number;
  lockHeight: number;
  bridge: string;
  shell: string;
  validate: string;
}

/**
 * Parse inertly, then place policy and bridge ahead of every source node.
 * Both layers use sandbox="allow-scripts" (never allow-same-origin). The
 * trusted shell's frame-src policy also blocks script-driven child navigation.
 * Self-contained so it can be serialized into an isolated preview window.
 */
function buildWithParts(
  parts: InlineHtmlRuntimeParts,
  validateSnapshot: (value: unknown) => value is InlineVisualSnapshot,
  source: string,
  channel: string,
  theme: InlineHtmlTheme,
  frameTitle: string,
  initialSnapshot: InlineVisualSnapshot | null,
  fontData: string,
): string {
  const doc = document.implementation.createHTMLDocument('');
  const template = doc.createElement('template');
  // Template parsing is inert, including resource loads. DOMParser may fetch
  // images before the resulting document ever reaches the sandbox/CSP.
  template.innerHTML = source;
  doc.body.append(template.content);
  // Strip declarative navigation and resource hints before insertion, including
  // metadata in templates. CSP remains active even if source later removes its meta.
  const stripNavigation = (root: ParentNode) => {
    root
      .querySelectorAll('meta, base, link, iframe, frame, frameset, object, embed')
      .forEach((node) => node.remove());
    root.querySelectorAll('template').forEach((node) => stripNavigation(node.content));
    root.querySelectorAll('a, area').forEach((node) => {
      for (const attr of ['href', 'xlink:href']) {
        if (!node.getAttribute(attr)?.startsWith('#')) node.removeAttribute(attr);
      }
      node.removeAttribute('target');
      node.removeAttribute('ping');
      node.removeAttribute('download');
    });
  };
  stripNavigation(doc);
  const escape = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = parts.csp;
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const style = doc.createElement('style');
  const font = /^data:[\w.+/-]+;base64,[A-Za-z0-9+/=]+$/.test(fontData)
    ? `@font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900;
      font-display: swap; src: url('${fontData}') format('woff2'); }`
    : '';
  style.textContent = `${font}${parts.styles}`;
  const bridge = doc.createElement('script');
  const json = escape([
    channel,
    theme,
    parts.maxScrollDelta,
    parts.lockHeight,
    validateSnapshot(initialSnapshot) ? initialSnapshot : null,
  ]);
  bridge.textContent = `(${parts.bridge})(...${json}, (${parts.validate}));`;
  doc.head.prepend(policy, charset, style, bridge);
  const childDocument = `<!doctype html>${doc.documentElement.outerHTML}`;

  const shell = document.implementation.createHTMLDocument('');
  const shellPolicy = shell.createElement('meta');
  shellPolicy.httpEquiv = 'Content-Security-Policy';
  // srcdoc is local. No external URL can load into the authored frame, including
  // when its scripts try to navigate themselves with location.assign or href.
  shellPolicy.content = parts.csp.replace("frame-src 'none'", 'frame-src about:');
  const shellCharset = shell.createElement('meta');
  shellCharset.setAttribute('charset', 'utf-8');
  const shellStyle = shell.createElement('style');
  shellStyle.textContent = 'html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }';
  const shellBridge = shell.createElement('script');
  const shellJson = escape([channel, childDocument, frameTitle, parts.maxScrollDelta]);
  shellBridge.textContent = `(${parts.shell})(...${shellJson}, (${parts.validate}));`;
  shell.head.prepend(shellPolicy, shellCharset, shellStyle, shellBridge);
  return `<!doctype html>${shell.documentElement.outerHTML}`;
}

const runtimeParts = (): InlineHtmlRuntimeParts => ({
  csp: INLINE_HTML_CSP,
  styles: INLINE_HTML_STYLES,
  maxScrollDelta: INLINE_HTML_MAX_SCROLL_DELTA,
  lockHeight: INLINE_HTML_VIEWPORT_LOCK_HEIGHT,
  bridge: installPreviewBridge.toString(),
  shell: installPreviewShell.toString(),
  validate: isInlineVisualSnapshot.toString(),
});

/** Builds the sandboxed srcdoc with the current `document`. `fontData` is an optional woff2 data URL. */
export function buildInlineHtmlRuntimeDocument(
  source: string,
  channel: string,
  theme: InlineHtmlTheme,
  frameTitle: string,
  initialSnapshot: InlineVisualSnapshot | null = null,
  fontData = '',
): string {
  return buildWithParts(
    runtimeParts(),
    isInlineVisualSnapshot,
    source,
    channel,
    theme,
    frameTitle,
    initialSnapshot,
    fontData,
  );
}

/**
 * Executable JS expression that evaluates to the same srcdoc string inside an
 * isolated page (for example `webContents.executeJavaScript`). Without
 * `fontData`, text falls back to that page's fonts, so wrapping may differ.
 */
export function buildInlineHtmlPreviewScript(
  html: string,
  channel: string,
  theme: InlineHtmlTheme,
  title: string,
  initialSnapshot: InlineVisualSnapshot | null = null,
  fontData = '',
): string {
  const parts = runtimeParts();
  const snapshot = isInlineVisualSnapshot(initialSnapshot) ? initialSnapshot : null;
  const args = [html, channel, theme, title, snapshot, fontData]
    .map((value) => JSON.stringify(value))
    .join(', ');
  return `(${buildWithParts.toString()})(${JSON.stringify(parts)}, (${parts.validate}), ${args})`;
}
