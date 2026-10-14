import interFontData from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import { INLINE_HTML_STYLES } from './inline-html-styles';

/** Only existing semantic tokens cross the opaque iframe boundary. */
const THEME_TOKENS = [
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

interface InlineHtmlTheme {
  dark: boolean;
  variables: Record<string, string>;
}

export const INLINE_HTML_MIN_HEIGHT = 96;
export const INLINE_HTML_MAX_HEIGHT = 720;
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

export function readInlineHtmlTheme(element: Element): InlineHtmlTheme {
  const styles = getComputedStyle(element);
  return {
    dark: document.documentElement.classList.contains('dark'),
    variables: {
      ...Object.fromEntries(
        THEME_TOKENS.map((token) => [`--${token}`, styles.getPropertyValue(`--${token}`).trim()]),
      ),
      // rem-based app tokens must use the host root, not the iframe's browser default.
      '--inline-html-root-font-size': getComputedStyle(document.documentElement).fontSize,
    },
  };
}

/** Runs before any generated script; do not capture values from this module. */
function installPreviewBridge(
  channel: string,
  initialTheme: InlineHtmlTheme,
  maxScrollDelta: number,
) {
  const scroll = new MessageChannel();
  const postScroll = MessagePort.prototype.postMessage.bind(scroll.port1);
  window.parent.postMessage({ channel, type: 'scroll-port' }, '*', [scroll.port2]);
  const send = (type: string, payload: Record<string, unknown> = {}) => {
    window.parent.postMessage({ channel, type, ...payload }, '*');
  };
  let queued = false;
  const measure = () => {
    queued = false;
    if (!document.body) return;
    const height = Math.ceil(
      Math.max(document.body.scrollHeight, document.body.getBoundingClientRect().height),
    );
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
    // Restrict incoming variable names to the original, trusted token vocabulary.
    for (const key of Object.keys(initialTheme.variables)) {
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
    } else if (data.type === 'error' && typeof data.message === 'string') {
      window.parent.postMessage(
        { channel, type: 'error', message: data.message.slice(0, 300) },
        '*',
      );
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

/**
 * Parse inertly, then place policy and bridge ahead of every source node.
 * Both layers use sandbox="allow-scripts" (never allow-same-origin). The
 * trusted shell's frame-src policy also blocks script-driven child navigation.
 */
export function buildInlineHtmlDocument(
  source: string,
  channel: string,
  theme: InlineHtmlTheme,
  frameTitle: string,
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
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = INLINE_HTML_CSP;
  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const style = doc.createElement('style');
  style.textContent = `
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 100 900;
      font-display: swap; src: url('${interFontData}') format('woff2'); }
    ${INLINE_HTML_STYLES}
  `;
  const bridge = doc.createElement('script');
  const json = JSON.stringify([channel, theme, INLINE_HTML_MAX_SCROLL_DELTA]).replace(
    /</g,
    '\\u003c',
  );
  bridge.textContent = `(${installPreviewBridge.toString()})(...${json});`;
  doc.head.prepend(policy, charset, style, bridge);
  const childDocument = `<!doctype html>${doc.documentElement.outerHTML}`;

  const shell = document.implementation.createHTMLDocument('');
  const shellPolicy = shell.createElement('meta');
  shellPolicy.httpEquiv = 'Content-Security-Policy';
  // srcdoc is local. No external URL can load into the authored frame, including
  // when its scripts try to navigate themselves with location.assign or href.
  shellPolicy.content = INLINE_HTML_CSP.replace("frame-src 'none'", 'frame-src about:');
  const shellCharset = shell.createElement('meta');
  shellCharset.setAttribute('charset', 'utf-8');
  const shellStyle = shell.createElement('style');
  shellStyle.textContent = 'html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }';
  const shellBridge = shell.createElement('script');
  const shellJson = JSON.stringify([
    channel,
    childDocument,
    frameTitle,
    INLINE_HTML_MAX_SCROLL_DELTA,
  ]).replace(/</g, '\\u003c');
  shellBridge.textContent = `(${installPreviewShell.toString()})(...${shellJson});`;
  shell.head.prepend(shellPolicy, shellCharset, shellStyle, shellBridge);
  return `<!doctype html>${shell.documentElement.outerHTML}`;
}
