/**
 * HTML template with inlined CSS for light and dark themes
 */

const LIGHT_THEME_CSS = `
  :root {
    --bg-primary: #ffffff;
    --bg-secondary: #f8f8f8;
    --bg-tertiary: #f0f0f0;
    --text-primary: #1a1a1a;
    --text-secondary: #666666;
    --text-tertiary: #999999;
    --border-color: #e0e0e0;
    --code-bg: #f5f5f5;
    --code-border: #ddd;
    --accent-color: #5b5bff;
    --success-color: #22c55e;
    --error-color: #ef4444;
  }
`;

const DARK_THEME_CSS = `
  :root.dark {
    --bg-primary: #1a1a1a;
    --bg-secondary: #2a2a2a;
    --bg-tertiary: #3a3a3a;
    --text-primary: #f0f0f0;
    --text-secondary: #b0b0b0;
    --text-tertiary: #808080;
    --border-color: #404040;
    --code-bg: #2a2a2a;
    --code-border: #404040;
    --accent-color: #7c7cff;
    --success-color: #4ade80;
    --error-color: #f87171;
  }
`;

const SHARED_CSS = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html, body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: var(--text-primary);
    background-color: var(--bg-primary);
  }

  body {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .header {
    margin-bottom: 2rem;
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 1rem;
  }

  .header h1 {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
  }

  .header-meta {
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .theme-toggle {
    position: fixed;
    top: 1rem;
    right: 1rem;
    padding: 0.5rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .message {
    padding: 1rem;
    border-radius: 6px;
    border-left: 3px solid var(--accent-color);
  }

  .message.user {
    background-color: var(--bg-secondary);
    border-left-color: var(--accent-color);
  }

  .message.assistant {
    background-color: var(--bg-secondary);
    border-left-color: #22c55e;
  }

  .message.system {
    background-color: var(--bg-tertiary);
    border-left-color: #f59e0b;
  }

  .message-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .message-role {
    font-weight: 600;
    color: var(--text-primary);
  }

  .message-timestamp {
    font-size: 0.8rem;
  }

  .message-content {
    color: var(--text-primary);
  }

  /* Text block - prose styling */
  .text-block {
    margin-bottom: 0.75rem;
    font-size: 0.875rem;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .text-block p {
    margin: 0.5rem 0;
  }

  .text-block p:first-child {
    margin-top: 0;
  }

  .text-block p:last-child {
    margin-bottom: 0;
  }

  .text-block a {
    color: var(--accent-color);
    text-decoration: underline;
    text-decoration-color: var(--accent-color);
  }

  .text-block a:hover {
    opacity: 0.8;
  }

  /* Headings */
  .text-block h1 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 1.25rem 0 0.75rem 0;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .text-block h2 {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 1rem 0 0.625rem 0;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .text-block h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0.875rem 0 0.5rem 0;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .text-block h4,
  .text-block h5,
  .text-block h6 {
    font-size: 0.875rem;
    font-weight: 600;
    margin: 0.75rem 0 0.375rem 0;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .text-block h1:first-child,
  .text-block h2:first-child,
  .text-block h3:first-child,
  .text-block h4:first-child,
  .text-block h5:first-child,
  .text-block h6:first-child {
    margin-top: 0;
  }

  /* Lists */
  .text-block ul {
    list-style-type: disc;
    list-style-position: outside;
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .text-block ol {
    list-style-type: decimal;
    list-style-position: outside;
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  .text-block li {
    margin: 0.25rem 0;
    line-height: 1.5;
  }

  .text-block li p {
    display: inline;
    margin: 0;
  }

  /* Nested lists */
  .text-block ul ul,
  .text-block ol ol,
  .text-block ul ol,
  .text-block ol ul {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }

  .text-block ul ul {
    list-style-type: circle;
  }

  .text-block ul ul ul {
    list-style-type: square;
  }

  /* Blockquotes */
  .text-block blockquote {
    border-left: 3px solid var(--border-color);
    padding-left: 1rem;
    margin: 0.75rem 0;
    color: var(--text-secondary);
    font-style: italic;
  }

  .text-block blockquote p {
    margin: 0.25rem 0;
  }

  /* Inline code */
  .text-block code {
    background-color: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 3px;
    padding: 0.125rem 0.375rem;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
    font-size: 0.8rem;
    color: var(--accent-color);
  }

  /* Code blocks in text */
  .text-block pre {
    background-color: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 4px;
    padding: 0.75rem 1rem;
    margin: 0.75rem 0;
    overflow-x: auto;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .text-block pre code {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-primary);
    font-size: inherit;
  }

  /* Tables */
  .text-block table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    font-size: 0.8rem;
  }

  .text-block th {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    padding: 0.5rem 0.75rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-primary);
  }

  .text-block td {
    border: 1px solid var(--border-color);
    padding: 0.5rem 0.75rem;
    color: var(--text-primary);
  }

  .text-block tr:nth-child(even) {
    background-color: var(--bg-secondary);
  }

  .text-block tr:hover {
    background-color: var(--bg-tertiary);
  }

  /* Horizontal rules */
  .text-block hr {
    border: none;
    border-top: 1px solid var(--border-color);
    margin: 1rem 0;
  }

  /* Strong and emphasis */
  .text-block strong {
    font-weight: 600;
    color: var(--text-primary);
  }

  .text-block em {
    font-style: italic;
  }

  /* Definition lists */
  .text-block dl {
    margin: 0.5rem 0;
  }

  .text-block dt {
    font-weight: 600;
    margin-top: 0.5rem;
  }

  .text-block dd {
    margin-left: 1.5rem;
    color: var(--text-secondary);
  }

  .code-block {
    background-color: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 4px;
    padding: 1rem;
    overflow-x: auto;
    margin: 0.75rem 0;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.85rem;
  }

  .code-block code {
    color: var(--text-primary);
  }

  .tool-call {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin: 0.75rem 0;
    padding: 0.75rem;
  }

  .tool-call-summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--accent-color);
    padding: 0.5rem;
  }

  .tool-call-summary:hover {
    text-decoration: underline;
  }

  .tool-call-details {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
  }

  .tool-input {
    background-color: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 4px;
    padding: 0.75rem;
    overflow-x: auto;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.8rem;
  }

  .tool-result {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin: 0.75rem 0;
    padding: 0.75rem;
  }

  .tool-result.error {
    border-left: 3px solid var(--error-color);
  }

  .tool-result-summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--accent-color);
    padding: 0.5rem;
  }

  .tool-result-summary:hover {
    text-decoration: underline;
  }

  .tool-output {
    background-color: var(--code-bg);
    border: 1px solid var(--code-border);
    border-radius: 4px;
    padding: 0.75rem;
    overflow-x: auto;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.8rem;
    margin-top: 0.75rem;
  }

  .thinking-block {
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    margin: 0.75rem 0;
    padding: 0.75rem;
  }

  .thinking-summary {
    cursor: pointer;
    font-weight: 600;
    color: var(--text-secondary);
    padding: 0.5rem;
  }

  .thinking-summary:hover {
    text-decoration: underline;
  }

  .thinking-content {
    margin-top: 0.75rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border-color);
    color: var(--text-secondary);
  }

  .image-block {
    margin: 0.75rem 0;
  }

  .image-block img {
    max-width: 100%;
    border-radius: 4px;
    border: 1px solid var(--border-color);
  }

  .audio-block {
    margin: 0.75rem 0;
    padding: 0.75rem;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
  }

  .audio-block audio {
    width: 100%;
    max-width: 400px;
  }

  .audio-transcript {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-style: italic;
  }

  .file-block {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.75rem 0;
    padding: 0.5rem 0.75rem;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .file-icon {
    font-size: 1rem;
  }

  .file-name {
    font-weight: 500;
  }

  .file-type {
    color: var(--text-tertiary);
    font-size: 0.75rem;
  }

  @media (prefers-color-scheme: dark) {
    html:not(.light) {
      color-scheme: dark;
    }
    html:not(.light) body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }
  }
`;

export function getHtmlTemplate(
  title: string,
  messagesHtml: string,
  exportedAt?: Date,
): string {
  const timestamp = exportedAt ? new Date(exportedAt).toLocaleString() : new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    ${LIGHT_THEME_CSS}
    ${DARK_THEME_CSS}
    ${SHARED_CSS}
  </style>
</head>
<body>
  <button class="theme-toggle" onclick="toggleTheme()">🌙 Dark</button>

  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="header-meta">
      <div>Exported: ${timestamp}</div>
    </div>
  </div>

  <div class="messages">
    ${messagesHtml}
  </div>

  <script>
    function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.contains('dark');
      const button = document.querySelector('.theme-toggle');

      if (isDark) {
        html.classList.remove('dark');
        button.textContent = '🌙 Dark';
      } else {
        html.classList.add('dark');
        button.textContent = '☀️ Light';
      }

      localStorage.setItem('theme', isDark ? 'light' : 'dark');
    }

    // Load saved theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.querySelector('.theme-toggle').textContent = '☀️ Light';
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string | undefined | null): string {
  // Handle undefined or null values gracefully
  if (!text) {
    return '';
  }

  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}
