/** Runs in the browser against rendered text, including translucent backgrounds. */
export function measureText(element: Element) {
  type Color = [number, number, number, number];
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const parse = (color: string): Color => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (front: Color, back: Color): Color => {
    const alpha = front[3] + back[3] * (1 - front[3]);
    if (!alpha) return [0, 0, 0, 0];
    return [0, 1, 2]
      .map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha)
      .concat(alpha) as Color;
  };
  const luminance = (color: Color) => {
    const channels = color.slice(0, 3).map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const layers: Color[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    layers.push(parse(getComputedStyle(node).backgroundColor));
  }
  const background = layers
    .reverse()
    .reduce<Color>((back, front) => over(front, back), [0, 0, 0, 0]);
  const style = getComputedStyle(element);
  const foreground = over(parse(style.color), background);
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  let x: number | undefined;
  while ((text = walker.nextNode())) {
    if (!text.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    x = range.getBoundingClientRect().x;
    break;
  }
  return {
    x,
    color: style.color,
    background,
    weight: style.fontWeight,
    contrast: (light + 0.05) / (dark + 0.05),
  };
}
