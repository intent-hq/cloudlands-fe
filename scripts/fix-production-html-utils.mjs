import { createHash } from 'node:crypto';

const PARAGLIDE_SCRIPT = '<script src="/generated/paraglide.js"></script>';
const CSP_META_PATTERN = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/>/i;

export function injectParaglideBundle(html) {
  if (html.includes(PARAGLIDE_SCRIPT)) return html;
  if (!html.includes('</head>')) {
    throw new Error('Cannot inject the Paraglide bundle without a closing head tag');
  }
  return html.replace('</head>', `\t${PARAGLIDE_SCRIPT}\n</head>`);
}

/**
 * Replace development-only script allowances with exact hashes for generated
 * inline bootstraps. External same-origin scripts remain covered by 'self'.
 */
export function hardenProductionScriptCsp(html) {
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1] ?? ''))
    .map((match) => match[2] ?? '')
    .filter((content) => content.trim())
    .map((content) => `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`);

  if (!CSP_META_PATTERN.test(html)) {
    throw new Error('Cannot harden production scripts without a Content-Security-Policy meta tag');
  }

  return html.replace(CSP_META_PATTERN, (fullMatch, content) => {
    const directives = content
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean);
    let foundScriptSrc = false;
    const updatedDirectives = directives.map((directive) => {
      const [name, ...values] = directive.split(/\s+/);
      if (name !== 'script-src') return directive;
      foundScriptSrc = true;
      const safeValues = values.filter(
        (value) => value !== "'unsafe-inline'" && value !== "'unsafe-eval'",
      );
      return `script-src ${[...new Set([...safeValues, ...inlineScripts])].join(' ')}`;
    });

    if (!foundScriptSrc) {
      updatedDirectives.push(`script-src ${["'self'", ...inlineScripts].join(' ')}`);
    }
    return fullMatch.replace(content, `${updatedDirectives.join('; ')};`);
  });
}
