import Link from '@tiptap/extension-link';
import type { LinkOptions } from '@tiptap/extension-link';

/**
 * Extended Link extension that supports intent:// protocol
 *
 * CONTEXT: This extension was created to allow intent:// links (our custom protocol
 * for linking between notes) to work in the Tiptap editor. Getting this to work required
 * overcoming multiple layers of validation in the Tiptap Link extension.
 *
 * LAYERS OF VALIDATION WE HAD TO OVERRIDE:
 *
 * 1. **HTML Sanitization (DOMPurify)**
 *    - Location: html-sanitizer.ts
 *    - Issue: DOMPurify was stripping intent:// URLs from href attributes
 *    - Fix: Added 'intent' to ALLOWED_URI_REGEXP and added a hook to forceKeepAttr
 *
 * 2. **Tiptap Link Extension - parseHTML validation**
 *    - Location: This file, parseHTML() method
 *    - Issue: The default Link extension's parseHTML.getAttrs() validates hrefs and rejects
 *      unrecognized protocols. If validation fails, it returns false, telling Tiptap to
 *      not parse the <a> tag as a link mark.
 *    - Fix: Override parseHTML() to return null (success) for any href, bypassing validation
 *
 * 3. **Tiptap Link Extension - attribute parsing validation**
 *    - Location: This file, addAttributes().href.parseHTML
 *    - Issue: The default Link extension's href attribute has a parseHTML function that
 *      validates the href value. If validation fails, the href is not stored in the document.
 *    - Fix: Override addAttributes().href.parseHTML to directly return the href without validation
 *
 * 4. **Tiptap Link Extension - attribute rendering validation**
 *    - Location: This file, addAttributes().href.renderHTML
 *    - Issue: The default Link extension's href attribute has a renderHTML function that
 *      validates the href before outputting it to HTML. If validation fails, the href is
 *      rendered as an empty string.
 *    - Fix: Override addAttributes().href.renderHTML to directly output the href without validation
 *
 * 5. **Tiptap Link Extension - mark-level rendering**
 *    - Location: This file, renderHTML() method
 *    - Issue: Even with attribute-level renderHTML fixed, we needed to ensure the mark-level
 *      renderHTML properly outputs the HTMLAttributes object.
 *    - Fix: Override renderHTML() to return ['a', HTMLAttributes, 0] which tells Tiptap to
 *      render an <a> tag with all the attributes from HTMLAttributes
 *
 * IMPORTANT NOTES:
 * - The Link extension in Tiptap v3 is included in StarterKit by default
 * - We must disable StarterKit's Link (link: false) and add this custom extension instead
 * - This extension is used in both markdown and non-markdown editor modes
 * - The validation bypasses apply to ALL protocols, not just intent://
 *   (you may want to add back validation for other protocols if needed)
 *
 * DEBUGGING TIPS:
 * - Check editor.getJSON() to see if href is stored in the document (attribute parsing)
 * - Check editor.getHTML() to see if href is rendered in the output (attribute rendering)
 * - Add console.logs in parseHTML, addAttributes, and renderHTML to trace the flow
 */
const IntentLink = Link.extend({
  parseHTML() {
    return [
      {
        tag: 'a[href]:not([href *= "javascript:" i])',
        getAttrs: (dom: any) => {
          const href = (dom as HTMLElement).getAttribute('href');
          // Return null (success) for any href, including intent://
          // null means "parse this element as this mark"
          return href ? null : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }: any) {
    return ['a', HTMLAttributes, 0];
  },

  addAttributes() {
    return {
      href: {
        default: null,
        // Custom parseHTML that doesn't validate intent:// URLs
        parseHTML: (element: any) => element.getAttribute('href'),
        // Custom renderHTML that outputs the href
        renderHTML: (attributes: any) => {
          if (!attributes.href) {
            return {};
          }
          return {
            href: attributes.href,
          };
        },
      },
      target: {
        default: this.options.HTMLAttributes.target,
      },
      rel: {
        default: this.options.HTMLAttributes.rel,
      },
      class: {
        default: this.options.HTMLAttributes.class,
      },
    };
  },

  addCommands() {
    return {
      setLink:
        (attributes: any) =>
          ({ commands }: any) => {
          // If href is null or undefined, unset the link
            if (attributes.href === null || attributes.href === undefined) {
              return commands.unsetMark(this.name);
            }

            // Set the link mark with the provided attributes
            // We bypass validation by directly setting the mark
            return commands.setMark(this.name, attributes);
          },
    };
  },
});

/**
 * Helper function to create an IntentLink extension with custom options
 *
 * @param options - Additional options to pass to the Link extension
 * @returns A configured Link extension that supports intent:// links
 */
export function createIntentLink(options: Partial<LinkOptions> = {}) {
  return IntentLink.configure({
    // Disable validation so intent:// links are accepted by setLink command
    validate: undefined,
    ...options,
  });
}

/**
 * Pre-configured Link extension with intent:// protocol support
 * Use this directly if you don't need to customize options
 */
export const CustomLink = createIntentLink();

// Backward compatibility alias
/** @deprecated Use createIntentLink instead */
export const createWorkspacesLink = createIntentLink;
