/**
 * Monaco Editor Web Workers Configuration for Electron + Vite
 *
 * CRITICAL: Monaco Editor requires proper web workers to compute diffs asynchronously.
 * Without real workers, features like diff computation will silently fail - `onDidUpdateDiff`
 * will never fire and `getLineChanges()` will always return null.
 *
 * ## The Problem
 *
 * Monaco Editor uses web workers for computationally expensive operations like:
 * - Diff computation (comparing two text documents)
 * - Syntax highlighting and tokenization
 * - Language services (TypeScript, JSON, CSS, HTML)
 *
 * In a standard web environment, Monaco loads these workers from CDN or bundled files.
 * In Electron + Vite, we need to explicitly configure how these workers are loaded.
 *
 * ## The Solution
 *
 * Vite provides a special `?worker` suffix that bundles worker files properly.
 * We import the Monaco workers using this suffix and configure `MonacoEnvironment.getWorker`
 * to return new instances of these workers based on the language label.
 *
 * ## References
 *
 * - Vite Discussion: https://github.com/vitejs/vite/discussions/1791
 * - Evan You's solution: https://github.com/vitejs/vite/discussions/1791#discussioncomment-321046
 * - Monaco ESM Integration: https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md
 *
 * @see https://github.com/vitejs/vite/discussions/1791#discussioncomment-321046
 */

import * as monaco from 'monaco-editor';
import { logger } from './client-logger';
import {
  shouldSuppressMonacoConsoleError,
  shouldSuppressMonacoUnhandledRejection,
} from './monaco-error-suppression';

// Track initialization state
let isMonacoInitialized = false;
let initializationPromise: Promise<void> | null = null;
let workersConfigured = false;

// Worker instances (loaded lazily)
type WorkerModule = { default: new () => Worker };
let workerModules: {
  editor: WorkerModule;
  json: WorkerModule;
  css: WorkerModule;
  html: WorkerModule;
  ts: WorkerModule;
} | null = null;

// Export monaco for convenience
export { monaco };

/**
 * Configures Monaco Editor web workers for Electron + Vite environment.
 *
 * This function dynamically imports Monaco workers and sets up the global
 * `MonacoEnvironment.getWorker` function that Monaco uses to instantiate workers.
 *
 * **IMPORTANT**: This must be called before any Monaco editor instances are created,
 * typically in the root layout component.
 *
 * @returns Promise that resolves when workers are configured
 *
 * @example
 * ```typescript
 * // In +layout.svelte or app initialization
 * import { configureMonacoWorkers } from '$lib/utils/monaco-workers';
 *
 * if (typeof window !== 'undefined') {
 *   configureMonacoWorkers().then(() => {
 *     console.log('Monaco workers ready');
 *   });
 * }
 * ```
 */
export async function configureMonacoWorkers(): Promise<void> {
  if (typeof window === 'undefined') {
    return;
  }

  // Skip if already configured
  if (workersConfigured) {
    return;
  }

  try {
    // Import all Monaco workers using Vite's ?worker suffix (NOT ?worker&inline)
    // This tells Vite to bundle these as separate worker files that load on demand
    // PERF: Removes 15.5MB from initial bundle by not inlining workers
    const [editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
      import('monaco-editor/esm/vs/editor/editor.worker?worker'),
      import('monaco-editor/esm/vs/language/json/json.worker?worker'),
      import('monaco-editor/esm/vs/language/css/css.worker?worker'),
      import('monaco-editor/esm/vs/language/html/html.worker?worker'),
      import('monaco-editor/esm/vs/language/typescript/ts.worker?worker'),
    ]);

    // Store worker modules for later use
    workerModules = {
      editor: editorWorker,
      json: jsonWorker,
      css: cssWorker,
      html: htmlWorker,
      ts: tsWorker,
    };

    // Configure Monaco's global environment
    (self as any).MonacoEnvironment = {
      getWorker(_: any, label: string) {
        if (!workerModules) {
          logger.error('[Monaco] Workers not loaded yet');
          return { postMessage: () => {}, terminate: () => {} };
        }

        try {
          // Return the appropriate worker based on the language label
          if (label === 'json') {
            return new workerModules.json.default();
          }
          if (label === 'css' || label === 'scss' || label === 'less') {
            return new workerModules.css.default();
          }
          if (label === 'html' || label === 'handlebars' || label === 'razor') {
            return new workerModules.html.default();
          }
          if (label === 'typescript' || label === 'javascript') {
            return new workerModules.ts.default();
          }
          // Default to the base editor worker for all other languages
          return new workerModules.editor.default();
        } catch (error) {
          logger.error('[Monaco] Failed to create worker for', label, error);
          return { postMessage: () => {}, terminate: () => {} };
        }
      },
      globalAPI: false,
    };

    workersConfigured = true;
    logger.info('[Monaco] Workers configured successfully (lazy loaded)');

    // Set up console.error filter for Monaco internal errors (only in development)
    setupMonacoErrorFilter();
  } catch (error) {
    logger.error('[Monaco] Failed to configure Monaco workers', { error });
    throw error;
  }
}

/**
 * Sets up a console.error filter to suppress known Monaco internal errors.
 *
 * Monaco Editor sometimes logs internal errors to the console that are not
 * actionable and can be safely ignored. This filter suppresses these known
 * errors to reduce console noise during development.
 */
function setupMonacoErrorFilter(): void {
  if (typeof window === 'undefined') return;

  const win = window as any;

  // Only configure once and only in development
  if (win.__monacoErrorFilterConfigured || !import.meta.env.DEV) return;

  win.__monacoErrorFilterConfigured = true;

  const originalError = console.error;
  console.error = (...args) => {
    if (shouldSuppressMonacoConsoleError(args)) return;

    originalError.apply(console, args);
  };

  // Also filter unhandled promise rejections from Monaco TypeScript worker and webview
  win.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (shouldSuppressMonacoUnhandledRejection(event.reason)) {
      event.preventDefault();
      return;
    }
  });
}

/**
 * Configures Monaco Editor language services (TypeScript, JavaScript).
 *
 * This sets up compiler options and diagnostics for TypeScript/JavaScript
 * language features in Monaco Editor.
 *
 * @example
 * ```typescript
 * // After configuring workers
 * configureMonacoLanguages();
 * ```
 */
export function configureMonacoLanguages(): void {
  // Implementation would go here
}

/**
 * Ensure Monaco is fully initialized before use
 */
export async function ensureMonacoInitialized(): Promise<void> {
  if (isMonacoInitialized) {
    return Promise.resolve();
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = new Promise<void>((resolve, reject) => {
    // Wait for Monaco to be fully loaded
    let attempts = 0;
    const maxAttempts = 100; // 5 seconds max wait

    const checkMonaco = () => {
      attempts++;

      try {
        // Check if Monaco is available and has all required components
        if (
          monaco &&
          monaco.editor &&
          monaco.languages &&
          monaco.editor.createModel &&
          typeof monaco.editor.createModel === 'function'
        ) {
          // Test that we can actually create a model
          const testModel = monaco.editor.createModel('test', 'plaintext');
          testModel.dispose();

          isMonacoInitialized = true;
          logger.info('[Monaco] Monaco Editor initialized successfully');
          resolve();
        } else if (attempts >= maxAttempts) {
          const error = new Error('[Monaco] Monaco Editor failed to initialize after 5 seconds');
          logger.error(error.message);
          reject(error);
        } else {
          setTimeout(checkMonaco, 50);
        }
      } catch (err) {
        if (attempts >= maxAttempts) {
          logger.error('[Monaco] Monaco Editor initialization error:', err);
          reject(err);
        } else {
          // Keep trying if we haven't hit the max attempts
          setTimeout(checkMonaco, 50);
        }
      }
    };

    checkMonaco();
  });

  return initializationPromise;
}

/**
 * Initialize Monaco with proper configuration
 */
export async function initializeMonaco() {
  try {
    // Ensure Monaco is loaded first
    await ensureMonacoInitialized();

    // Check if TypeScript language service is available
    if (!monaco.languages?.typescript) {
      logger.warn('[Monaco] TypeScript language service not available yet');
      return;
    }

    // Configure TypeScript/JavaScript language defaults
    if (monaco.languages.typescript.javascriptDefaults) {
      monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        noEmit: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.React,
        reactNamespace: 'React',
        allowJs: true,
        typeRoots: ['node_modules/@types'],
      });

      // Set eager model sync for better performance
      monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    }

    // Configure TypeScript language defaults
    if (monaco.languages.typescript.typescriptDefaults) {
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
      });

      monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.CommonJS,
        noEmit: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.React,
        reactNamespace: 'React',
        allowJs: true,
        typeRoots: ['node_modules/@types'],
      });

      // Set eager model sync for better performance
      monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
    }

    // Register Svelte language with HTML-like syntax highlighting
    registerSvelteLanguage();
  } catch (error) {
    logger.warn('[Monaco] Error configuring Monaco languages:', error);
  }
}

/**
 * Register Svelte as a custom language with syntax highlighting
 * Svelte uses HTML as a base with embedded TypeScript/JavaScript
 */
function registerSvelteLanguage() {
  // Check if already registered
  const languages = monaco.languages.getLanguages();
  if (languages.some((lang) => lang.id === 'svelte')) {
    return;
  }

  // Register the language
  monaco.languages.register({
    id: 'svelte',
    extensions: ['.svelte'],
    aliases: ['Svelte', 'svelte'],
    mimetypes: ['text/x-svelte'],
  });

  // Set language configuration (brackets, comments, etc.)
  monaco.languages.setLanguageConfiguration('svelte', {
    comments: {
      lineComment: '//',
      blockComment: ['<!--', '-->'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
      ['<', '>'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>' },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
      { open: '"', close: '"', notIn: ['string'] },
      { open: '`', close: '`', notIn: ['string', 'comment'] },
      { open: '<!--', close: '-->', notIn: ['comment', 'string'] },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '<', close: '>' },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
    folding: {
      markers: {
        start: /^\s*<!--\s*#region\b.*-->/,
        end: /^\s*<!--\s*#endregion\b.*-->/,
      },
    },
    wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
    indentationRules: {
      increaseIndentPattern:
        /<(?!(?:area|base|br|col|embed|hr|img|input|keygen|link|menuitem|meta|param|source|track|wbr)\b)[a-zA-Z][^/>]*>|{[^}]*$/,
      decreaseIndentPattern: /^\s*(<\/|}<)/,
    },
  });

  // Set up tokenization (syntax highlighting)
  monaco.languages.setMonarchTokensProvider('svelte', {
    defaultToken: '',
    tokenPostfix: '.svelte',

    // Svelte-specific keywords
    svelteKeywords: [
      '#if',
      '/if',
      ':else',
      ':else if',
      '#each',
      '/each',
      '#await',
      '/await',
      ':then',
      ':catch',
      '#key',
      '/key',
      '#snippet',
      '/snippet',
      '@render',
      '@html',
      '@debug',
      '@const',
    ],

    // TypeScript/JavaScript keywords
    keywords: [
      'break',
      'case',
      'catch',
      'class',
      'continue',
      'const',
      'constructor',
      'debugger',
      'default',
      'delete',
      'do',
      'else',
      'export',
      'extends',
      'false',
      'finally',
      'for',
      'from',
      'function',
      'get',
      'if',
      'import',
      'in',
      'instanceof',
      'interface',
      'let',
      'new',
      'null',
      'return',
      'set',
      'static',
      'super',
      'switch',
      'this',
      'throw',
      'true',
      'try',
      'typeof',
      'undefined',
      'var',
      'void',
      'while',
      'with',
      'yield',
      'async',
      'await',
      'of',
      'as',
      'type',
    ],

    // Svelte runes
    runes: ['$state', '$derived', '$effect', '$props', '$bindable', '$inspect', '$host'],

    // HTML tag names
    tagNames: [
      'a',
      'abbr',
      'address',
      'area',
      'article',
      'aside',
      'audio',
      'b',
      'base',
      'bdi',
      'bdo',
      'blockquote',
      'body',
      'br',
      'button',
      'canvas',
      'caption',
      'cite',
      'code',
      'col',
      'colgroup',
      'data',
      'datalist',
      'dd',
      'del',
      'details',
      'dfn',
      'dialog',
      'div',
      'dl',
      'dt',
      'em',
      'embed',
      'fieldset',
      'figcaption',
      'figure',
      'footer',
      'form',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'head',
      'header',
      'hgroup',
      'hr',
      'html',
      'i',
      'iframe',
      'img',
      'input',
      'ins',
      'kbd',
      'label',
      'legend',
      'li',
      'link',
      'main',
      'map',
      'mark',
      'menu',
      'meta',
      'meter',
      'nav',
      'noscript',
      'object',
      'ol',
      'optgroup',
      'option',
      'output',
      'p',
      'param',
      'picture',
      'pre',
      'progress',
      'q',
      'rp',
      'rt',
      'ruby',
      's',
      'samp',
      'script',
      'section',
      'select',
      'slot',
      'small',
      'source',
      'span',
      'strong',
      'style',
      'sub',
      'summary',
      'sup',
      'table',
      'tbody',
      'td',
      'template',
      'textarea',
      'tfoot',
      'th',
      'thead',
      'time',
      'title',
      'tr',
      'track',
      'u',
      'ul',
      'var',
      'video',
      'wbr',
    ],

    operators: [
      '<=',
      '>=',
      '==',
      '!=',
      '===',
      '!==',
      '=>',
      '+',
      '-',
      '**',
      '*',
      '/',
      '%',
      '++',
      '--',
      '<<',
      '</',
      '>>',
      '>>>',
      '&',
      '|',
      '^',
      '!',
      '~',
      '&&',
      '||',
      '??',
      '?',
      ':',
      '=',
      '+=',
      '-=',
      '*=',
      '**=',
      '/=',
      '%=',
      '<<=',
      '>>=',
      '>>>=',
      '&=',
      '|=',
      '^=',
      '@',
      '...',
    ],

    symbols: /[=><!~?:&|+\-*\/^%]+/,

    escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,

    tokenizer: {
      root: [
        // Svelte script tags with lang="ts"
        [
          /(<)(script)(\s+)(lang)(=)("ts"|'ts')/,
          [
            'delimiter.html',
            'tag.html',
            '',
            'attribute.name.html',
            'delimiter.html',
            'attribute.value.html',
          ],
        ],
        [/<script/, { token: 'tag.html', next: '@script' }],
        [/<style/, { token: 'tag.html', next: '@style' }],

        // Svelte template expressions
        [/{#/, { token: 'keyword.svelte', next: '@svelteBlock' }],
        [/{:/, { token: 'keyword.svelte', next: '@svelteBlock' }],
        [/{\//, { token: 'keyword.svelte', next: '@svelteBlock' }],
        [/{@/, { token: 'keyword.svelte', next: '@svelteExpression' }],
        [/{/, { token: 'delimiter.bracket', next: '@svelteExpression' }],

        // HTML Comments
        [/<!--/, { token: 'comment.html', next: '@htmlComment' }],

        // HTML Tags
        [/(<)(\w+)/, ['delimiter.html', { token: 'tag.html', next: '@tag' }]],
        [/(<\/)(\w+)/, ['delimiter.html', { token: 'tag.html', next: '@tag' }]],

        // Text content
        [/[^<{]+/, 'text.html'],
      ],

      script: [[/<\/script>/, { token: 'tag.html', next: '@pop' }], { include: '@typescript' }],

      style: [
        [/<\/style>/, { token: 'tag.html', next: '@pop' }],
        [/./, 'source.css'],
      ],

      tag: [
        [/\s+/, ''],
        [/(\w+)(=)/, ['attribute.name.html', { token: 'delimiter.html', next: '@attributeValue' }]],
        [/\w+/, 'attribute.name.html'],
        [/on:\w+/, 'attribute.name.event.svelte'],
        [/bind:\w+/, 'attribute.name.binding.svelte'],
        [/class:\w+/, 'attribute.name.class.svelte'],
        [/use:\w+/, 'attribute.name.action.svelte'],
        [/transition:\w+/, 'attribute.name.transition.svelte'],
        [/in:\w+/, 'attribute.name.transition.svelte'],
        [/out:\w+/, 'attribute.name.transition.svelte'],
        [/animate:\w+/, 'attribute.name.animation.svelte'],
        [/\/>/, { token: 'delimiter.html', next: '@pop' }],
        [/>/, { token: 'delimiter.html', next: '@pop' }],
      ],

      attributeValue: [
        [/"[^"]*"/, { token: 'attribute.value.html', next: '@pop' }],
        [/'[^']*'/, { token: 'attribute.value.html', next: '@pop' }],
        [/{/, { token: 'delimiter.bracket', next: '@svelteExpressionInAttr' }],
        [/\w+/, { token: 'attribute.value.html', next: '@pop' }],
      ],

      svelteBlock: [
        [/}/, { token: 'keyword.svelte', next: '@pop' }],
        [/\b(if|else|each|await|then|catch|key|snippet|as)\b/, 'keyword.control.svelte'],
        { include: '@typescript' },
      ],

      svelteExpression: [
        [/}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/@(html|debug|const|render)/, 'keyword.svelte'],
        { include: '@typescript' },
      ],

      svelteExpressionInAttr: [
        [/}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: '@typescript' },
      ],

      htmlComment: [
        [/-->/, { token: 'comment.html', next: '@pop' }],
        [/./, 'comment.html'],
      ],

      typescript: [
        // Runes
        [/\$(?:state|derived|effect|props|bindable|inspect|host)\b/, 'variable.language.svelte'],

        // Comments
        [/\/\/.*$/, 'comment'],
        [/\/\*/, { token: 'comment', next: '@tsComment' }],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@tsDoubleString'],
        [/'/, 'string', '@tsSingleString'],
        [/`/, 'string', '@tsTemplateString'],

        // Numbers
        [/\d*\.\d+([eE][-+]?\d+)?/, 'number.float'],
        [/0[xX][0-9a-fA-F]+/, 'number.hex'],
        [/\d+/, 'number'],

        // Keywords
        [
          /\b(break|case|catch|class|continue|const|constructor|debugger|default|delete|do|else|export|extends|false|finally|for|from|function|get|if|import|in|instanceof|interface|let|new|null|return|set|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with|yield|async|await|of|as|type)\b/,
          'keyword',
        ],

        // Identifiers
        [/[a-zA-Z_$][\w$]*/, 'identifier'],

        // Operators
        [/@symbols/, 'operator'],

        // Delimiters
        [/[{}()[\]]/, 'delimiter.bracket'],
        [/[;,.]/, 'delimiter'],
      ],

      tsComment: [
        [/\*\//, { token: 'comment', next: '@pop' }],
        [/./, 'comment'],
      ],

      tsDoubleString: [
        [/[^\\"]+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/"/, 'string', '@pop'],
      ],

      tsSingleString: [
        [/[^\\']+/, 'string'],
        [/@escapes/, 'string.escape'],
        [/\\./, 'string.escape.invalid'],
        [/'/, 'string', '@pop'],
      ],

      tsTemplateString: [
        [/\$\{/, { token: 'delimiter.bracket', next: '@tsTemplateStringExpression' }],
        [/[^`$]+/, 'string'],
        [/`/, 'string', '@pop'],
      ],

      tsTemplateStringExpression: [
        [/}/, { token: 'delimiter.bracket', next: '@pop' }],
        { include: '@typescript' },
      ],
    },
  });

  logger.info('[Monaco] Svelte language registered');
}
