import { app, BrowserWindow, session } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildInlineHtmlPreviewScript,
  INLINE_HTML_MAX_HEIGHT,
  INLINE_HTML_MIN_HEIGHT,
  INLINE_HTML_THEME_TOKENS,
  type InlineHtmlTheme,
} from '../../inline-html/inline-html-runtime';

export interface InlineHtmlPreviewOptions {
  html: string;
  width?: number;
  appearance?: 'light' | 'dark';
}

export interface InlineHtmlPreviewResult {
  base64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
  contentHeight: number;
  truncated: boolean;
  appearance: 'light' | 'dark';
  consoleMessages: Array<{ level: string; message: string }>;
}

const MAX_HTML_LENGTH = 512_000;
const MAX_CAPTURE_HEIGHT = 8_000;
const PREVIEW_TIMEOUT_MS = 20_000;
const previewSlots = [false, false];
let resources: Promise<{ css: string; fontData: string }> | undefined;

/** The same tokens and font as chat, copied into the packaged app at build time. */
function readPreviewResources(): Promise<{ css: string; fontData: string }> {
  resources ??= (async () => {
    const packaged = join(app.getAppPath(), 'dist', 'renderer', 'resources', 'inline-html');
    const paths = app.isPackaged
      ? [[join(packaged, 'tokens.css'), join(packaged, 'inter.woff2')]]
      : [app.getAppPath(), resolve('.')].map((root) => [
          join(root, 'src', 'lib', 'styles', 'tokens.css'),
          join(
            root,
            'node_modules',
            '@fontsource-variable',
            'inter',
            'files',
            'inter-latin-wght-normal.woff2',
          ),
        ]);
    for (const [cssPath, fontPath] of paths) {
      try {
        const [css, font] = await Promise.all([readFile(cssPath, 'utf8'), readFile(fontPath)]);
        return { css, fontData: `data:font/woff2;base64,${font.toString('base64')}` };
      } catch {
        // Development fixtures can have their own app path; try the project cwd next.
      }
    }
    throw new Error('Inline visual preview theme resources are unavailable');
  })().catch((error) => {
    resources = undefined;
    throw error;
  });
  return resources;
}

/** No tab registration, app preload, app session, or visible window is involved. */
export async function previewInlineHtml(
  options: InlineHtmlPreviewOptions,
  deadline?: number,
): Promise<InlineHtmlPreviewResult> {
  const { html, width = 800, appearance = 'light' } = options;
  if (typeof html !== 'string' || html.length === 0 || html.length > MAX_HTML_LENGTH)
    throw new Error(`HTML must contain 1–${MAX_HTML_LENGTH} characters`);
  if (!Number.isInteger(width) || width < 320 || width > 1600)
    throw new Error('Preview width must be an integer from 320 to 1600');
  if (appearance !== 'light' && appearance !== 'dark')
    throw new Error('Unknown preview appearance');
  const slot = previewSlots.indexOf(false);
  if (slot < 0)
    throw new Error('Two visual previews are already running; try again after they finish');
  const budget = Math.min(PREVIEW_TIMEOUT_MS, (deadline ?? Infinity) - Date.now());
  if (budget <= 0) throw new Error('Inline visual preview timed out before starting');
  previewSlots[slot] = true;
  const channel = randomUUID();
  // A bounded pool avoids accumulating Electron session objects between requests.
  // These sessions never load app documents or authenticated origins.
  const isolatedSession = session.fromPartition(`inline-html-preview-${slot}`);
  let window: BrowserWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const consoleMessages: InlineHtmlPreviewResult['consoleMessages'] = [];
  const record = (level: string, message: string) => {
    if (consoleMessages.length < 30)
      consoleMessages.push({ level, message: message.slice(0, 1000) });
  };
  try {
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    isolatedSession.setPermissionCheckHandler(() => false);
    isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: !/^(about:|data:)/.test(details.url) });
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new Error(`Inline visual preview timed out after ${Math.ceil(budget)}ms`));
        if (window && !window.isDestroyed()) window.destroy();
      }, budget);
    });
    return await Promise.race([
      timeout,
      (async () => {
        const { css, fontData } = await readPreviewResources();
        if (expired) throw new Error('Inline visual preview timed out');
        window = new BrowserWindow({
          show: false,
          focusable: false,
          skipTaskbar: true,
          width,
          height: INLINE_HTML_MIN_HEIGHT,
          useContentSize: true,
          webPreferences: {
            session: isolatedSession,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            webviewTag: false,
            backgroundThrottling: false,
            offscreen: true,
          },
        });
        const contents = window.webContents;
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        contents.on('will-navigate', (event) => event.preventDefault());
        contents.on('will-frame-navigate', (event) => {
          if (!['about:blank', 'about:srcdoc'].includes(event.url)) event.preventDefault();
        });
        contents.on('console-message', ({ level, message }) => record(level, message));
        await window.loadURL('about:blank');
        const theme: InlineHtmlTheme = await contents.executeJavaScript(`(() => {
          document.documentElement.classList.toggle('dark', ${appearance === 'dark'});
          const style = document.createElement('style');
          style.textContent = ${JSON.stringify(css)};
          document.head.append(style);
          const styles = getComputedStyle(document.documentElement);
          return { dark: ${appearance === 'dark'}, variables: Object.fromEntries([
            ...${JSON.stringify(INLINE_HTML_THEME_TOKENS)}.map(key => ['--' + key, styles.getPropertyValue('--' + key).trim()]),
            ['--inline-html-root-font-size', styles.fontSize]
          ]) };
        })()`);
        const documentExpression = buildInlineHtmlPreviewScript(
          html,
          channel,
          theme,
          // i18n-ignore (internal offscreen frame title, never shown in the app UI)
          'Author preview',
          null,
          fontData,
        );
        const contentHeight: number = await contents.executeJavaScript(`new Promise(resolve => {
          document.body.style.cssText = ${JSON.stringify(`margin:0;overflow:hidden;background:hsl(${theme.variables['--background']})`)};
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', 'allow-scripts');
          frame.style.cssText = 'display:block;border:0;width:100%;height:${INLINE_HTML_MIN_HEIGHT}px';
          let ready = false, height = ${INLINE_HTML_MIN_HEIGHT}, settled;
          const finish = () => {
            clearTimeout(settled);
            if (ready) settled = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(height))), 250);
          };
          window.addEventListener('message', event => {
            if (event.source !== frame.contentWindow || event.data?.channel !== ${JSON.stringify(channel)}) return;
            const data = event.data;
            if (data.type === 'resize' && Number.isFinite(data.height) && data.height >= 0) {
              height = Math.max(${INLINE_HTML_MIN_HEIGHT}, Math.min(${INLINE_HTML_MAX_HEIGHT}, Math.ceil(data.height)));
              frame.style.height = height + 'px';
            } else if (data.type === 'ready') ready = true;
            else if (data.type === 'error' || data.type === 'layout') console.error(String(data.message).slice(0,1000));
            finish();
          });
          frame.srcdoc = ${documentExpression};
          document.body.append(frame);
        })`);
        const height = Math.min(contentHeight, MAX_CAPTURE_HEIGHT);
        window.setContentSize(width, height);
        await contents.executeJavaScript(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        );
        // A completed layout does not guarantee that the hidden compositor has
        // a surface for capturePage. Wait for a fresh offscreen paint before
        // capturing; capturePage also paints child-frame surfaces at the new size.
        await new Promise<void>((resolve) => {
          contents.on('paint', function onPaint(_event, _dirtyRect, image) {
            if (image.isEmpty()) return;
            contents.off('paint', onPaint);
            resolve();
          });
          contents.invalidate();
        });
        const capture = await contents.capturePage(undefined, {
          stayHidden: false,
          stayAwake: true,
        });
        const size = capture.getSize();
        const normalized = size.width === width ? capture : capture.resize({ width });
        return {
          base64: normalized.toPNG().toString('base64'),
          mimeType: 'image/png' as const,
          width,
          height,
          contentHeight,
          truncated: contentHeight > height,
          appearance,
          consoleMessages,
        };
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    expired = true;
    if (window && !window.isDestroyed()) window.destroy();
    isolatedSession.webRequest.onBeforeRequest(null);
    previewSlots[slot] = false;
  }
}
