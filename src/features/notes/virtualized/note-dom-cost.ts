/** UTF-8 payload size without allocating a second copy of a native view's strings.
 * Lone surrogates count as the three-byte replacement used by TextEncoder. */
function utf8Length(text: string) {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** Measures light DOM and accessible shadow DOM, including native renderer output.
 * These are text/name/attribute payload bytes and node counts, NOT browser heap,
 * layout/GPU allocations, external resources, or admission limits. No HTML snapshot
 * is constructed. Closed shadow trees must report costs through their view adapter. */
export function measureNoteDom(root: Node) {
  const roots: Node[] = [root];
  const shadowRoots: ShadowRoot[] = [];
  let nodes = 0,
    payloadBytes = 0;
  for (let i = 0; i < roots.length; i++) {
    const walker = root.ownerDocument!.createTreeWalker(roots[i]);
    let node: Node | null = walker.currentNode;
    while (node) {
      nodes++;
      payloadBytes += utf8Length(node.nodeName);
      if (node.nodeValue !== null) payloadBytes += utf8Length(node.nodeValue);
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        for (const attr of element.attributes) {
          payloadBytes += utf8Length(attr.name) + utf8Length(attr.value);
        }
        if (element.shadowRoot) {
          roots.push(element.shadowRoot);
          shadowRoots.push(element.shadowRoot);
        }
      }
      node = walker.nextNode();
    }
  }
  return { nodes, payloadBytes, shadowRoots };
}
