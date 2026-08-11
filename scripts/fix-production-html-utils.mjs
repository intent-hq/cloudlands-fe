const PARAGLIDE_SCRIPT = '<script src="./generated/paraglide.js"></script>';

export function injectParaglideBundle(html) {
  if (html.includes(PARAGLIDE_SCRIPT)) return html;
  if (!html.includes('</head>')) {
    throw new Error('Cannot inject the Paraglide bundle without a closing head tag');
  }
  return html.replace('</head>', `\t${PARAGLIDE_SCRIPT}\n</head>`);
}
