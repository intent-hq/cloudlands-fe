import { splitTextByUrls } from '$lib/components/chat/message-link-utils';

/** Enhance already sanitized text; existing links and literal code keep their meaning. */
export function linkifyMarkdownText(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest('a,pre,code,script,style,textarea')) continue;
    const parts = splitTextByUrls(node.data);
    if (!parts.some((part) => part.type === 'link')) continue;
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (part.type === 'text') fragment.append(part.content);
      else {
        const link = document.createElement('a');
        link.setAttribute('href', part.url);
        link.textContent = part.url;
        fragment.append(link);
      }
    }
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}
