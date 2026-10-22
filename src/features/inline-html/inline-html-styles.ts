/** Zero-specificity defaults precede authored styles in the isolated document. */
export const INLINE_HTML_STYLES = `
  :where(html) {
    height: auto;
    overflow-x: hidden;
    font-size: var(--inline-html-root-font-size);
  }
  :where(body) {
    margin: 0;
    padding: var(--space-4);
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
    font-weight: var(--text-body-weight);
    letter-spacing: var(--text-body-tracking);
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }
  :where(*), :where(*)::before, :where(*)::after { box-sizing: border-box; }
  :where(img, svg, canvas) { max-width: 100%; }
  :where(h1, h2, h3, h4, h5, h6) {
    margin: var(--space-4) 0 var(--space-2);
    font-size: var(--text-body-strong-size);
    line-height: var(--text-body-strong-line-height);
    font-weight: var(--text-body-strong-weight);
    letter-spacing: var(--text-body-strong-tracking);
    overflow-wrap: anywhere;
  }
  :where(p, ul, ol) { margin: 0 0 var(--space-3); }
  :where(p, label, output, figcaption) { overflow-wrap: anywhere; }
  :where(label, output, figcaption) {
    font-size: var(--text-body-size);
    line-height: var(--text-body-line-height);
  }
  :where(code, pre) { font-family: var(--font-code); }
  :where(button, input, select, textarea) { font: inherit; color: inherit; }
  :where(button, select, textarea, input:not([type]),
    input[type="text"], input[type="number"], input[type="search"],
    input[type="email"], input[type="url"], input[type="tel"], input[type="password"]) {
    min-width: 0;
    max-width: 100%;
    min-height: var(--control-height-medium);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--diagram-node-outline);
    border-radius: var(--radius-small);
    background: hsl(var(--background));
  }
  :where(button) {
    background: var(--diagram-node-surface);
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease-standard);
  }
  :where(button:hover:not(:disabled)) { background: var(--diagram-node-hover-surface); }
  :where(button[aria-pressed="true"]) { background: hsl(var(--secondary)); }
  :where(button:disabled, input:disabled, select:disabled, textarea:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :where(input[type="checkbox"], input[type="radio"]) {
    accent-color: hsl(var(--foreground));
  }
  :where(input[type="range"]) {
    appearance: none;
    width: 100%;
    min-width: 0;
    min-height: var(--control-height-medium);
    margin: 0;
    background: transparent;
    accent-color: hsl(var(--foreground));
    cursor: pointer;
  }
  :where(input[type="range"])::-webkit-slider-runnable-track {
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--diagram-connector-muted);
  }
  :where(input[type="range"])::-moz-range-track {
    height: var(--space-1);
    border-radius: var(--radius-full);
    background: var(--diagram-connector-muted);
  }
  :where(input[type="range"])::-webkit-slider-thumb {
    appearance: none;
    width: var(--space-4);
    height: var(--space-4);
    margin-top: calc((var(--space-1) - var(--space-4)) / 2);
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--foreground));
  }
  :where(input[type="range"])::-moz-range-thumb {
    width: var(--space-4);
    height: var(--space-4);
    border: 0;
    border-radius: var(--radius-full);
    background: hsl(var(--foreground));
  }
  :where(:focus-visible) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  :where(.visual) { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
  :where(.visual > *) { min-width: 0; margin: 0; }
  :where(.visual-controls) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-width: 0;
  }
  :where(.visual-controls > *) { min-width: 0; max-width: 100%; }
  :where(.visual-controls > input[type="range"]) { flex: 1 1 0; width: 0; }
  :where(.visual-controls > output) {
    min-width: 5ch;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  :where(.visual-controls > .visual-field) { flex: 1 1 12rem; }
  :where(.visual-field, .visual-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) fit-content(50%);
    align-items: baseline;
    gap: var(--space-2) var(--space-3);
    min-width: 0;
  }
  :where(.visual-field > *, .visual-row > *) { min-width: 0; margin: 0; overflow-wrap: anywhere; }
  :where(.visual-field > output, .visual-row > :last-child) {
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
  :where(.visual-field > input, .visual-field > select, .visual-field > textarea) {
    grid-column: 1 / -1;
    width: 100%;
  }
  :where(.diagram-surface) {
    display: grid;
    gap: var(--space-3);
    margin: 0;
    /* The surrounding visual owns the content gutter. */
    padding: 0;
    min-width: 0;
    border-radius: var(--diagram-node-radius);
    background: var(--diagram-canvas);
    color: var(--diagram-node-title);
  }
  :where(.diagram-surface > svg) { display: block; width: 100%; height: auto; }
  :where(.diagram-node) {
    fill: var(--diagram-node-surface);
    stroke: var(--diagram-node-outline);
    stroke-width: var(--diagram-connector-width);
    vector-effect: non-scaling-stroke;
  }
  :where(.diagram-connector, .diagram-guide) {
    fill: none;
    stroke: var(--diagram-connector);
    stroke-width: var(--diagram-connector-width);
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  :where(.diagram-guide) {
    stroke: var(--diagram-connector-muted);
    stroke-dasharray: 4 4;
  }
  :where(.diagram-label) {
    fill: var(--diagram-node-title);
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    font-weight: var(--text-body-weight);
    letter-spacing: var(--text-body-tracking);
  }
  @container style(--motion-reduced: 1) {
    :where(button) { transition: none; }
  }
`;
