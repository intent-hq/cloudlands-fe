import { describe, expect, it } from 'vitest';
import { injectParaglideBundle } from './fix-production-html-utils.mjs';

describe('production HTML transforms', () => {
  it('injects the generated Paraglide bundle before application scripts', () => {
    const html = injectParaglideBundle(
      '<html><head></head><body><script>boot()</script></body></html>',
    );
    expect(html).toContain('<script src="./generated/paraglide.js"></script>\n</head>');
    expect(html.indexOf('paraglide.js')).toBeLessThan(html.indexOf('boot()'));
  });

  it('is idempotent', () => {
    const once = injectParaglideBundle('<html><head></head><body></body></html>');
    expect(injectParaglideBundle(once)).toBe(once);
  });
});
