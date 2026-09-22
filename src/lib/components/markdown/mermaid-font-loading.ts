/** Load the displayed face without changing SVG typography or suppressing load errors. */
export function loadMermaidTextFont(text: SVGTextElement): Promise<FontFace[]> | undefined {
  const style = getComputedStyle(text);
  // Inherited font-variant/feature settings can prevent CSSOM shorthand serialization.
  const font =
    style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return document.fonts?.load(font, text.textContent ?? '');
}
