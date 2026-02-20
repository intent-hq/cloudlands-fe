/**
 * Safe lowlight instance that gracefully handles unregistered languages.
 *
 * Fixes Sentry error "Unknown language: `http` is not registered" (AUGMENT-INTENT-59)
 * by wrapping the `highlight` method to fall back to `highlightAuto` when a language
 * is not registered, instead of throwing.
 */
import { common, createLowlight } from 'lowlight';
// Additional languages not in 'common' bundle that users may encounter
import protobuf from 'highlight.js/lib/languages/protobuf';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import scala from 'highlight.js/lib/languages/scala';
import elixir from 'highlight.js/lib/languages/elixir';
import haskell from 'highlight.js/lib/languages/haskell';

/**
 * Creates a lowlight instance with common + extra languages registered,
 * and a safe `highlight` method that falls back to `highlightAuto`
 * for unregistered languages instead of throwing.
 */
export function createSafeLowlight() {
  const lowlight = createLowlight(common);

  // Register additional languages not included in 'common' bundle
  // Note: kotlin and swift are already in 'common', so we don't add them here
  lowlight.register('protobuf', protobuf);
  lowlight.register('dockerfile', dockerfile);
  lowlight.register('nginx', nginx);
  lowlight.register('scala', scala);
  lowlight.register('elixir', elixir);
  lowlight.register('haskell', haskell);

  // Wrap highlight to gracefully handle unregistered languages
  const originalHighlight = lowlight.highlight.bind(lowlight);
  lowlight.highlight = (language: string, value: string, options?: Readonly<{ prefix?: string | null | undefined }> | null | undefined) => {
    if (lowlight.registered(language)) {
      return originalHighlight(language, value, options);
    }
    return lowlight.highlightAuto(value);
  };

  return lowlight;
}

/**
 * Shared safe lowlight instance for use across the application.
 * Pre-configured with common languages and safe highlight fallback.
 */
export const safeLowlight = createSafeLowlight();
