/**
 * CDP Helpers - Playwright-style API for browser automation
 *
 * This file is injected into the page context by cdp_run_script.
 * It provides a Playwright-inspired API for interacting with the page.
 */

(function () {
  'use strict';

  // ============================================================================
  // LOCATOR CLASS
  // ============================================================================

  class Locator {
    constructor(selector, options = {}) {
      this.selector = selector;
      this.options = options;
    }

    /**
     * Find the element(s) matching this locator
     * @private
     */
    _findElements() {
      if (this.options.role) {
        // Find by ARIA role
        const role = this.options.role;
        const name = this.options.name;
        const exact = this.options.exact !== false;

        const elements = Array.from(document.querySelectorAll('*')).filter((el) => {
          const ariaRole = el.getAttribute('role') || this._getImplicitRole(el);
          if (ariaRole !== role) return false;

          if (name) {
            const accessibleName = this._getAccessibleName(el);
            if (name instanceof RegExp) {
              return name.test(accessibleName);
            } else if (exact) {
              return accessibleName === name;
            } else {
              return accessibleName.toLowerCase().includes(name.toLowerCase());
            }
          }

          return true;
        });

        return elements;
      } else if (this.options.text) {
        // Find by text content
        const text = this.options.text;
        const exact = this.options.exact !== false;

        const elements = Array.from(document.querySelectorAll('*')).filter((el) => {
          const textContent = el.textContent || '';
          if (text instanceof RegExp) {
            return text.test(textContent);
          } else if (exact) {
            return textContent.trim() === text;
          } else {
            return textContent.toLowerCase().includes(text.toLowerCase());
          }
        });

        return elements;
      } else {
        // CSS selector
        return Array.from(document.querySelectorAll(this.selector));
      }
    }

    /**
     * Get the first matching element
     * @private
     */
    _getElement(options = {}) {
      const timeout = options.timeout || 5000;
      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        const check = () => {
          const elements = this._findElements();

          if (elements.length > 0) {
            resolve(elements[0]);
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for element: ${this.selector}`));
          } else {
            setTimeout(check, 100);
          }
        };

        check();
      });
    }

    /**
     * Get implicit ARIA role for an element
     * @private
     */
    _getImplicitRole(element) {
      const tagName = element.tagName.toLowerCase();
      const type = element.getAttribute('type');

      const roleMap = {
        button: 'button',
        a: element.hasAttribute('href') ? 'link' : null,
        input:
          type === 'button' || type === 'submit'
            ? 'button'
            : type === 'checkbox'
              ? 'checkbox'
              : type === 'radio'
                ? 'radio'
                : 'textbox',
        textarea: 'textbox',
        select: 'combobox',
        h1: 'heading',
        h2: 'heading',
        h3: 'heading',
        h4: 'heading',
        h5: 'heading',
        h6: 'heading',
        nav: 'navigation',
        main: 'main',
        aside: 'complementary',
        header: 'banner',
        footer: 'contentinfo',
        article: 'article',
        section: 'region',
        form: 'form',
        img: 'img',
        ul: 'list',
        ol: 'list',
        li: 'listitem',
        dialog: 'dialog',
      };

      return roleMap[tagName] || null;
    }

    /**
     * Get accessible name for an element
     * @private
     */
    _getAccessibleName(element) {
      // Check aria-label
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      // Check aria-labelledby
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelElement = document.getElementById(labelledBy);
        if (labelElement) return labelElement.textContent.trim();
      }

      // Check associated label
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) return label.textContent.trim();
      }

      // Check parent label
      const parentLabel = element.closest('label');
      if (parentLabel) return parentLabel.textContent.trim();

      // Check title attribute
      const title = element.getAttribute('title');
      if (title) return title;

      // Check alt attribute (for images)
      const alt = element.getAttribute('alt');
      if (alt) return alt;

      // Fallback to text content
      return element.textContent.trim();
    }

    // ========================================================================
    // ACTIONS
    // ========================================================================

    async click(options = {}) {
      const element = await this._getElement(options);
      element.click();

      // Wait a bit for any effects
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    async fill(value, options = {}) {
      const element = await this._getElement(options);

      // Focus the element
      element.focus();

      // Clear existing value
      element.value = '';

      // Set new value
      element.value = value;

      // Trigger input event
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async clear(options = {}) {
      return this.fill('', options);
    }

    // ========================================================================
    // WAITING
    // ========================================================================

    async waitFor(options = {}) {
      const state = options.state || 'visible';
      const timeout = options.timeout || 5000;
      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        const check = () => {
          const elements = this._findElements();

          let condition = false;
          if (state === 'attached') {
            condition = elements.length > 0;
          } else if (state === 'detached') {
            condition = elements.length === 0;
          } else if (state === 'visible') {
            condition = elements.length > 0 && this._isVisible(elements[0]);
          } else if (state === 'hidden') {
            condition = elements.length === 0 || !this._isVisible(elements[0]);
          }

          if (condition) {
            resolve();
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for element to be ${state}: ${this.selector}`));
          } else {
            setTimeout(check, 100);
          }
        };

        check();
      });
    }

    _isVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0
      );
    }

    // ========================================================================
    // QUERIES
    // ========================================================================

    async textContent(options = {}) {
      const element = await this._getElement(options);
      return element.textContent;
    }

    async innerText(options = {}) {
      const element = await this._getElement(options);
      return element.innerText;
    }

    async isVisible(options = {}) {
      try {
        const element = await this._getElement({ timeout: options.timeout || 1000 });
        return this._isVisible(element);
      } catch {
        return false;
      }
    }

    async count() {
      return this._findElements().length;
    }

    async getAttribute(name, options = {}) {
      const element = await this._getElement(options);
      return element.getAttribute(name);
    }

    // ========================================================================
    // CHAINING
    // ========================================================================

    first() {
      // Return a new locator that only matches the first element
      const originalFind = this._findElements.bind(this);
      const newLocator = new Locator(this.selector, this.options);
      newLocator._findElements = () => {
        const elements = originalFind();
        return elements.length > 0 ? [elements[0]] : [];
      };
      return newLocator;
    }

    last() {
      const originalFind = this._findElements.bind(this);
      const newLocator = new Locator(this.selector, this.options);
      newLocator._findElements = () => {
        const elements = originalFind();
        return elements.length > 0 ? [elements[elements.length - 1]] : [];
      };
      return newLocator;
    }

    nth(index) {
      const originalFind = this._findElements.bind(this);
      const newLocator = new Locator(this.selector, this.options);
      newLocator._findElements = () => {
        const elements = originalFind();
        return elements[index] ? [elements[index]] : [];
      };
      return newLocator;
    }

    async all() {
      // Return an array of Locator instances, one for each matching element
      const elements = this._findElements();
      return elements.map((_, index) => this.nth(index));
    }
  }

  // ============================================================================
  // CDP API
  // ============================================================================

  window.cdp = {
    // Locator creation
    getByRole(role, options = {}) {
      return new Locator('*', { role, ...options });
    },

    getByText(text, options = {}) {
      return new Locator('*', { text, ...options });
    },

    getByTestId(testId) {
      return new Locator(`[data-testid="${testId}"]`);
    },

    getByLabel(label, options = {}) {
      // Find by aria-label or associated label
      const locator = new Locator('*', { label, ...options });
      locator._findElements = () => {
        const exact = options.exact !== false;
        return Array.from(document.querySelectorAll('*')).filter((el) => {
          // Check aria-label
          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) {
            if (label instanceof RegExp) {
              return label.test(ariaLabel);
            } else if (exact) {
              return ariaLabel === label;
            } else {
              return ariaLabel.toLowerCase().includes(label.toLowerCase());
            }
          }

          // Check associated label (for inputs)
          if (el.id) {
            const labelEl = document.querySelector(`label[for="${el.id}"]`);
            if (labelEl) {
              const labelText = labelEl.textContent.trim();
              if (label instanceof RegExp) {
                return label.test(labelText);
              } else if (exact) {
                return labelText === label;
              } else {
                return labelText.toLowerCase().includes(label.toLowerCase());
              }
            }
          }

          return false;
        });
      };
      return locator;
    },

    getByPlaceholder(placeholder, options = {}) {
      const exact = options.exact !== false;
      const locator = new Locator('*', { placeholder, ...options });
      locator._findElements = () => {
        return Array.from(document.querySelectorAll('[placeholder]')).filter((el) => {
          const placeholderAttr = el.getAttribute('placeholder');
          if (placeholder instanceof RegExp) {
            return placeholder.test(placeholderAttr);
          } else if (exact) {
            return placeholderAttr === placeholder;
          } else {
            return placeholderAttr.toLowerCase().includes(placeholder.toLowerCase());
          }
        });
      };
      return locator;
    },

    locator(selector) {
      return new Locator(selector);
    },

    // Page-level operations
    waitForURL(urlPattern, options = {}) {
      const timeout = options.timeout || 5000;
      const startTime = Date.now();

      return new Promise((resolve, reject) => {
        const check = () => {
          const currentUrl = window.location.href;
          let matches = false;

          if (urlPattern instanceof RegExp) {
            matches = urlPattern.test(currentUrl);
          } else if (typeof urlPattern === 'function') {
            matches = urlPattern(new URL(currentUrl));
          } else {
            matches = currentUrl.includes(urlPattern);
          }

          if (matches) {
            resolve();
          } else if (Date.now() - startTime > timeout) {
            reject(new Error(`Timeout waiting for URL to match: ${urlPattern}`));
          } else {
            setTimeout(check, 100);
          }
        };

        check();
      });
    },

    url() {
      return window.location.href;
    },

    waitForTimeout(milliseconds) {
      return new Promise((resolve) => setTimeout(resolve, milliseconds));
    },

    // Storage helpers
    storage: {
      getLocal(key) {
        return localStorage.getItem(key);
      },

      setLocal(key, value) {
        localStorage.setItem(key, value);
      },

      removeLocal(key) {
        localStorage.removeItem(key);
      },

      clearLocal() {
        localStorage.clear();
      },

      keysLocal() {
        return Object.keys(localStorage);
      },
    },
  };
})();
