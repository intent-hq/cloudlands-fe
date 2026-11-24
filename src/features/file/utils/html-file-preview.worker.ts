import { defaultTreeAdapter as tree, html, parse, serializeOuter } from 'parse5';
import type { DefaultTreeAdapterTypes as Ast } from 'parse5';

const MAX_NODES = 12_000;
const MAX_DEPTH = 128;
const BLOCKED_ELEMENTS = new Set([
  'animate',
  'animateMotion',
  'animateTransform',
  'applet',
  'base',
  'discard',
  'embed',
  'fencedframe',
  'frame',
  'frameset',
  'iframe',
  'link',
  'meta',
  'object',
  'portal',
  'script',
  'set',
  'template',
  'webview',
]);
const BLOCKED_ATTRIBUTES = new Set([
  'action',
  'autofocus',
  'download',
  'formaction',
  'ping',
  'target',
]);

function prepareElement(element: Ast.Element) {
  const isLink = element.tagName === 'a' || element.tagName === 'area';
  element.attrs = element.attrs.filter((attribute) => {
    const { name, value } = attribute;
    if (name.startsWith('on') || BLOCKED_ATTRIBUTES.has(name)) return false;
    if (name !== 'href') return true;
    if (value.startsWith('#')) {
      if (isLink) attribute.value = `about:srcdoc${value}`;
      return true;
    }
    return (
      element.namespaceURI === html.NS.SVG &&
      element.tagName === 'image' &&
      /^data:image\//i.test(value)
    );
  });
}

function previewDocument(source: string): string | null {
  const document = parse(source, { scriptingEnabled: false });
  const root = document.childNodes.find(tree.isElementNode);
  if (!root) return null;
  const head = root.childNodes.find(
    (child): child is Ast.Element => tree.isElementNode(child) && child.tagName === 'head',
  );
  if (!head) return null;

  let remaining = MAX_NODES;
  function prepareChildren(parent: Ast.ParentNode, depth: number): boolean {
    remaining -= parent.childNodes.length;
    if (remaining < 0 || depth > MAX_DEPTH) return false;
    parent.childNodes = parent.childNodes.filter(
      (child) => !tree.isElementNode(child) || !BLOCKED_ELEMENTS.has(child.tagName),
    );
    for (const child of parent.childNodes) {
      if (!tree.isElementNode(child)) continue;
      prepareElement(child);
      if (!prepareChildren(child, depth + 1)) return false;
    }
    return true;
  }
  if (!prepareChildren(document, 0)) return null;

  const policy = tree.createElement('meta', html.NS.HTML, [
    { name: 'http-equiv', value: 'Content-Security-Policy' },
    {
      name: 'content',
      value:
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'",
    },
  ]);
  const first = head.childNodes[0];
  if (first) tree.insertBefore(head, policy, first);
  else tree.appendChild(head, policy);
  return `<!doctype html>${serializeOuter(root)}`;
}

self.onmessage = ({ data }: MessageEvent<string>) => {
  self.postMessage(previewDocument(data));
};
