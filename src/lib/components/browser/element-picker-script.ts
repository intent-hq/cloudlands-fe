// i18n-ignore: This script is an internal webview protocol, not user-facing text.
export const elementPickerScript = String.raw`
  (function() {
    var PICKED_PREFIX = '__INTENT_ELEMENT_PICKED__:';
    var CANCELLED = '__INTENT_ELEMENT_PICK_CANCELLED__';
    var existingCleanup = window.__intentElementPickerCleanup;
    if (typeof existingCleanup === 'function') existingCleanup();

    var overlay = document.createElement('div');
    var label = document.createElement('div');
    overlay.setAttribute('data-intent-element-picker-overlay', '');
    overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #7c3aed;background:rgba(124,58,237,.12);box-sizing:border-box;display:none;';
    label.style.cssText = 'position:absolute;left:-2px;bottom:100%;max-width:320px;padding:2px 5px;background:#7c3aed;color:#fff;font:11px/1.4 ui-monospace,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    overlay.appendChild(label);
    (document.documentElement || document.body).appendChild(overlay);

    function escapeCss(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return value.replace(/[^a-zA-Z0-9_-]/g, function(character) {
        return '\\' + character;
      });
    }

    function segment(element) {
      var value = element.tagName.toLowerCase();
      if (element.id) return value + '#' + escapeCss(element.id);
      var classValue = typeof element.className === 'string' ? element.className.trim() : '';
      if (classValue) value += '.' + classValue.split(/\s+/).map(escapeCss).join('.');
      return value;
    }

    function uniqueSelector(element) {
      if (element.id) {
        var idSelector = '#' + escapeCss(element.id);
        if (document.querySelectorAll(idSelector).length === 1) return idSelector;
      }
      var parts = [];
      var current = element;
      while (current && current.nodeType === 1) {
        var part = segment(current);
        var parent = current.parentElement;
        if (parent) {
          var siblings = Array.prototype.filter.call(parent.children, function(child) {
            return child.tagName === current.tagName;
          });
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        var selector = parts.join(' > ');
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (_) {}
        current = parent;
      }
      return parts.join(' > ');
    }

    function domPath(element) {
      var parts = [];
      var current = element;
      while (current && current.nodeType === 1) {
        parts.unshift(segment(current));
        current = current.parentElement;
      }
      return parts.join('>');
    }

    function sourceReference(element) {
      try {
        var attribute = element.getAttribute('data-source') || element.getAttribute('data-loc');
        if (attribute) return attribute;
        var testId = element.getAttribute('data-testid');
        if (testId) return 'data-testid=' + testId;
      } catch (_) {}
      try {
        var svelteLoc = element.__svelte_meta && element.__svelte_meta.loc;
        if (svelteLoc && svelteLoc.file) {
          return svelteLoc.file + (svelteLoc.line == null ? '' : ':' + svelteLoc.line + ':' + (svelteLoc.column || 0));
        }
      } catch (_) {}
      try {
        var fiberKey = Object.keys(element).find(function(key) {
          return key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0;
        });
        var fiber = fiberKey ? element[fiberKey] : null;
        while (fiber) {
          if (fiber._debugSource && fiber._debugSource.fileName) {
            return fiber._debugSource.fileName + ':' + (fiber._debugSource.lineNumber || 0) + ':' + (fiber._debugSource.columnNumber || 0);
          }
          var ownerType = fiber._debugOwner && fiber._debugOwner.type;
          var ownerName = ownerType && (ownerType.displayName || ownerType.name);
          if (ownerName) return 'React:' + ownerName;
          fiber = fiber.return;
        }
      } catch (_) {}
      try {
        var vueType = element.__vueParentComponent && element.__vueParentComponent.type;
        if (vueType && vueType.__file) return vueType.__file;
      } catch (_) {}
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      if (window.__intentElementPickerCleanup === cleanup) delete window.__intentElementPickerCleanup;
    }

    function onMove(event) {
      var target = event.target;
      if (!target || target === overlay || overlay.contains(target) || !target.getBoundingClientRect) return;
      var rect = target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left = rect.left + 'px';
      overlay.style.top = rect.top + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
      label.textContent = segment(target) + ' ' + Math.round(rect.width) + '×' + Math.round(rect.height);
    }

    function onClick(event) {
      var target = event.target;
      if (!target || target === overlay || overlay.contains(target) || !target.getBoundingClientRect) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      var rect = target.getBoundingClientRect();
      var text = (target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      var payload = {
        selector: uniqueSelector(target),
        domPath: domPath(target),
        tagName: target.tagName.toLowerCase(),
        id: target.id || '',
        className: typeof target.className === 'string' ? target.className : '',
        textSnippet: text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pageUrl: window.location.href
      };
      var sourceRef = sourceReference(target);
      if (sourceRef) payload.sourceRef = sourceRef;
      cleanup();
      console.log(PICKED_PREFIX + JSON.stringify(payload));
    }

    function onKeyDown(event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cleanup();
      console.log(CANCELLED);
    }

    window.__intentElementPickerCleanup = cleanup;
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  })();
`;
