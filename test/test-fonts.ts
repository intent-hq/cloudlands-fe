import { test, type Page } from '@playwright/test';

/**
 * Font stack the root Playwright harness applies to `--font-ui` / `body`, leading
 * with the repo-bundled Inter Variable so text metrics match the CT harness
 * (`playwright/index.ts`) and /sandbox instead of the host's fallback fonts.
 */
const HARNESS_FONT_UI =
  "'Inter Variable', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const INTER_FAMILY = 'Inter Variable';
const INTER_STYLESHEET_PATH = 'node_modules/@fontsource-variable/inter/index.css';
// Weights the root harness renders text at; the variable face serves all of them.
const INTER_LOAD_DESCRIPTORS = [
  `400 12px '${INTER_FAMILY}'`,
  `500 12px '${INTER_FAMILY}'`,
  `600 12px '${INTER_FAMILY}'`,
];

interface LoadBundledInterFontOptions {
  /** Vite dev-server origin (with trailing slash) that serves `node_modules/…`. */
  baseUrl: string;
}

/**
 * Loads the repo-bundled Inter Variable face into `page` and asserts it is the face
 * actually in use before any pixel snapshot is taken (cloudlands-fe#2709,
 * intent-hq/intent#5033). Goldens are regenerated on Linux CI with this face; a spec
 * that snapshots under a host fallback font produces goldens that fail there.
 *
 * The assertion iterates `document.fonts` for a `FontFace` whose `family` normalises
 * to `Inter Variable` with `status === 'loaded'`. `document.fonts.check()` is not
 * used: it returns `true` when no matching face exists at all.
 */
export async function loadBundledInterFont(
  page: Page,
  { baseUrl }: LoadBundledInterFontOptions,
): Promise<void> {
  await test.step(`load bundled ${INTER_FAMILY} font`, async () => {
    await page.addStyleTag({ url: `${baseUrl}${INTER_STYLESHEET_PATH}` });
    const loaded = await page.evaluate(
      async ({ fontUi, family, descriptors }) => {
        document.documentElement.style.setProperty('--font-ui', fontUi);
        document.body.style.fontFamily = 'var(--font-ui)';
        await Promise.all(descriptors.map((descriptor) => document.fonts.load(descriptor)));
        await document.fonts.ready;
        const normalise = (value: string) => value.trim().replace(/^["']|["']$/g, '');
        const faces = Array.from(document.fonts).filter(
          (face) => normalise(face.family) === family,
        );
        return {
          loaded: faces.some((face) => face.status === 'loaded'),
          statuses: faces.map((face) => face.status),
        };
      },
      { fontUi: HARNESS_FONT_UI, family: INTER_FAMILY, descriptors: INTER_LOAD_DESCRIPTORS },
    );
    if (!loaded.loaded) {
      throw new Error(
        `Bundled '${INTER_FAMILY}' did not load on ${page.url()} from ${baseUrl}${INTER_STYLESHEET_PATH} ` +
          `(matching FontFace statuses: ${loaded.statuses.length ? loaded.statuses.join(', ') : 'none'}). ` +
          'Pixel snapshots would render with a host fallback font; ' +
          'check the stylesheet URL is served by the harness Vite server.',
      );
    }
  });
}
