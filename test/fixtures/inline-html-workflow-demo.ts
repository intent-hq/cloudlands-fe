// i18n-ignore-file — English-only sandbox fixture, not application copy.
// Runs inside the opaque HTML sandbox. Only intentVisual state/publish and an
// explicitly selected browser File are used; no app, network or workspace access.
export const workflowClampDemo = String.raw`<title>Desk clamp dimensions</title>
<style>
  .workflow-labels, .workflow-result, .workflow-import { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
  .workflow-labels { color: var(--diagram-metadata); }
  .workflow-clamp { stroke: var(--diagram-node-title); stroke-width: calc(var(--diagram-connector-width) * 3); }
  [data-workflow-diagram] { max-height: 240px; }
  .workflow-measure { stroke: var(--diagram-metadata); }
  .workflow-drag { fill: transparent; cursor: ns-resize; touch-action: none; }
  .workflow-drag:focus-visible { fill: var(--diagram-node-hover-surface); stroke: var(--diagram-node-title); outline: none; }
  .workflow-edge { stroke: var(--diagram-node-title); stroke-width: var(--diagram-connector-width); pointer-events: none; }
  .workflow-dimension { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: var(--space-2) var(--space-3); }
  .workflow-dimension input[type=range] { grid-column: 1 / -1; width: 100%; min-width: 0; }
  .workflow-value { display: inline-flex; align-items: baseline; gap: var(--space-1); color: var(--diagram-metadata); font-variant-numeric: tabular-nums; }
  .workflow-value input[type=number] { width: 6ch; min-width: 0; min-height: 0; padding: var(--space-1); text-align: right; color: var(--diagram-node-title); background: transparent; border-color: transparent; border-radius: var(--radius-small); font: inherit; font-variant-numeric: tabular-nums; appearance: textfield; }
  .workflow-value input::-webkit-inner-spin-button, .workflow-value input::-webkit-outer-spin-button { appearance: none; margin: 0; }
  .workflow-value input:hover, .workflow-value input:focus { background: var(--diagram-node-surface); }
  .workflow-result output { font-variant-numeric: tabular-nums; }
  .workflow-result output:last-child, .workflow-import { color: var(--diagram-metadata); }
  .workflow-import label { cursor: pointer; text-decoration: underline; text-underline-offset: .2em; }
  .workflow-import label:focus-within { outline: 2px solid var(--diagram-node-title); outline-offset: 3px; }
  .workflow-file { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
  .workflow-error { margin: 0; color: var(--diagram-node-title); }
  [data-workflow-error]:empty { display: none; }
</style>
<section class="visual" data-workflow-demo>
  <figure class="diagram-surface">
    <div class="workflow-labels"><span>Desk cross-section</span><span data-workflow-opening-label>60 mm opening</span></div>
    <svg viewBox="0 0 620 300" aria-labelledby="workflow-diagram-title" data-workflow-diagram>
      <title id="workflow-diagram-title">Desk thickness, clamp opening and rear clearance. Drag the lower desk edge or edit the dimensions below.</title>
      <rect class="diagram-node" x="68" y="52" width="282" height="44.8" rx="4" data-workflow-desk />
      <path class="diagram-connector workflow-clamp" data-workflow-clamp />
      <path class="diagram-connector workflow-clamp" data-workflow-screw />
      <path class="diagram-connector workflow-measure" data-workflow-thickness-measure />
      <path class="diagram-guide" data-workflow-wall />
      <path class="diagram-connector workflow-measure" data-workflow-rear-measure />
      <text class="diagram-label" x="350" y="28" text-anchor="middle" data-workflow-rear-label>40 mm rear</text>
      <path class="workflow-edge" data-workflow-edge />
      <rect class="workflow-drag" x="68" width="282" height="24" tabindex="0" role="slider" aria-label="Desk thickness" aria-valuemin="1" aria-valuemax="100" aria-valuenow="28" aria-valuetext="28 millimeters" aria-orientation="vertical" data-workflow-drag />
    </svg>
    <figcaption class="workflow-labels"><span>Drag the lower desk edge</span><output data-workflow-thickness-label>28 mm</output></figcaption>
  </figure>
  <div class="visual-field workflow-dimension">
    <label for="workflow-thickness">Desk thickness</label>
    <span class="workflow-value"><input id="workflow-thickness" data-workflow-number="thickness" type="number" min="1" max="100" step="0.1" value="28" aria-label="Desk thickness in millimeters" /><span>mm</span></span>
    <input data-workflow-slider="thickness" type="range" min="1" max="100" step="0.1" value="28" aria-label="Desk thickness" />
  </div>
  <div class="visual-field workflow-dimension">
    <label for="workflow-opening">Clamp opening</label>
    <span class="workflow-value"><input id="workflow-opening" data-workflow-number="opening" type="number" min="1" max="120" step="0.1" value="60" aria-label="Clamp opening in millimeters" /><span>mm</span></span>
    <input data-workflow-slider="opening" type="range" min="1" max="120" step="0.1" value="60" aria-label="Clamp opening" />
  </div>
  <div class="visual-field workflow-dimension">
    <label for="workflow-rear">Rear clearance</label>
    <span class="workflow-value"><input id="workflow-rear" data-workflow-number="rearClearance" type="number" min="0" max="150" step="0.1" value="40" aria-label="Rear clearance in millimeters" /><span>mm</span></span>
    <input data-workflow-slider="rearClearance" type="range" min="0" max="150" step="0.1" value="40" aria-label="Rear clearance" />
  </div>
  <div class="workflow-result" aria-live="polite"><output data-workflow-fit>Fits opening</output><output data-workflow-clearance>32 mm clearance</output></div>
  <div class="workflow-import">
    <label>Load dimensions<input class="workflow-file" data-workflow-file type="file" accept=".json,.csv,application/json,text/csv" aria-label="Load dimensions from JSON or CSV" /></label>
    <span>JSON / CSV</span>
  </div>
  <p class="workflow-error" data-workflow-error role="status"></p>
</section>
<script>
  const root = document.querySelector('[data-workflow-demo]');
  const get = name => root.querySelector('[data-workflow-' + name + ']');
  const limits = { thickness: [1, 100], opening: [1, 120], rearClearance: [0, 150] };
  const keys = Object.keys(limits);
  const defaults = { thickness: 28, opening: 60, rearClearance: 40 };
  const validState = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)
      && typeof value[key] === 'number' && Number.isFinite(value[key])
      && value[key] >= limits[key][0] && value[key] <= limits[key][1]
      && Math.abs(value[key] * 10 - Math.round(value[key] * 10)) < 0.000001);
  let state = { ...defaults };
  try { const saved = window.intentVisual && window.intentVisual.state; if (validState(saved)) state = { ...saved }; } catch {}
  const round = value => Math.round(value * 10) / 10;
  function draw() {
    const bottom = 52 + state.thickness * 1.6;
    const openingBottom = 52 + state.opening * 1.6;
    const contact = Math.min(bottom + 6, openingBottom);
    const wall = 350 + state.rearClearance * 1.6;
    get('desk').setAttribute('height', state.thickness * 1.6);
    get('clamp').setAttribute('d', 'M310 46 H378 V' + (openingBottom + 6) + 'H310');
    get('screw').setAttribute('d', 'M330 ' + openingBottom + 'V' + contact + 'M316 ' + contact + 'H344');
    get('thickness-measure').setAttribute('d', 'M48 52 V' + bottom + 'M42 52 H54 M42 ' + bottom + 'H54');
    get('edge').setAttribute('d', 'M68 ' + bottom + 'H350');
    get('wall').setAttribute('d', 'M' + wall + ' 38 V266');
    get('rear-measure').setAttribute('d', 'M350 36 H' + wall + 'M350 31 V41 M' + wall + ' 31 V41');
    get('rear-label').setAttribute('x', (350 + wall) / 2);
    get('rear-label').textContent = state.rearClearance + ' mm rear';
    get('drag').setAttribute('y', bottom - 12);
    get('drag').setAttribute('aria-valuenow', state.thickness);
    get('drag').setAttribute('aria-valuetext', state.thickness + ' millimeters');
    get('thickness-label').textContent = state.thickness + ' mm';
    get('opening-label').textContent = state.opening + ' mm opening';
    const clearance = round(state.opening - state.thickness);
    const fit = clearance >= 0 ? 'Fits opening' : 'Opening too small';
    get('fit').textContent = fit;
    get('clearance').textContent = Math.abs(clearance) + (clearance >= 0 ? ' mm clearance' : ' mm over');
    for (const key of keys) {
      root.querySelector('[data-workflow-slider="' + key + '"]').value = state[key];
      const number = root.querySelector('[data-workflow-number="' + key + '"]');
      if (document.activeElement !== number) number.value = state[key];
    }
    try {
      if (window.intentVisual && !window.intentVisual.publish({
        state: { ...state }, title: 'Desk clamp dimensions',
        inputs: {
          'Desk thickness (mm)': state.thickness,
          'Clamp opening (mm)': state.opening,
          'Rear clearance (mm)': state.rearClearance
        },
        results: {
          'Opening clearance (mm)': clearance,
          'Fit': fit
        }
      })) get('error').textContent = 'Could not share these dimensions. Adjust a value to try again.';
    } catch { get('error').textContent = 'Could not share these dimensions. Adjust a value to try again.'; }
  }
  function setDimension(key, value) {
    state[key] = round(Math.min(limits[key][1], Math.max(limits[key][0], value)));
    get('error').textContent = '';
    draw();
  }
  for (const key of keys) {
    root.querySelector('[data-workflow-slider="' + key + '"]').addEventListener('input', event => setDimension(key, Number(event.target.value)));
    const number = root.querySelector('[data-workflow-number="' + key + '"]');
    number.addEventListener('input', () => {
      if (number.value === '' || !number.validity.valid) { number.setAttribute('aria-invalid', 'true'); return; }
      number.removeAttribute('aria-invalid');
      setDimension(key, Number(number.value));
    });
    number.addEventListener('blur', () => { number.value = state[key]; number.removeAttribute('aria-invalid'); });
    number.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); number.blur(); } });
  }
  const handle = get('drag');
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag !== null) return;
    const matrix = get('diagram').getScreenCTM();
    if (!matrix) return;
    event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, start: new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()).y, thickness: state.thickness };
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const matrix = get('diagram').getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    setDimension('thickness', drag.thickness + (point.y - drag.start) / 1.6);
  });
  const stopDrag = event => { if (drag && drag.id === event.pointerId) drag = null; };
  handle.addEventListener('pointerup', stopDrag);
  handle.addEventListener('pointercancel', stopDrag);
  handle.addEventListener('lostpointercapture', stopDrag);
  handle.addEventListener('keydown', event => {
    const changes = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (Object.hasOwn(changes, event.key) || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setDimension('thickness', event.key === 'Home' ? 1 : event.key === 'End' ? 100 : state.thickness + changes[event.key]);
    }
  });
  let fileVersion = 0;
  get('file').addEventListener('change', async event => {
    const version = ++fileVersion;
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const extension = file.name.toLowerCase().split('.').pop();
      const types = extension === 'json' ? ['', 'application/json', 'text/plain'] : ['', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'];
      if (!['json', 'csv'].includes(extension) || !types.includes(file.type) || file.size > 131072 || file.size === 0) throw new Error('Choose a JSON or CSV file up to 128 KiB.');
      const text = (await file.text()).replace(/^\uFEFF/, '').trim();
      if (version !== fileVersion) return;
      if (text.length > 131072) throw new Error('Choose a JSON or CSV file up to 128 KiB.');
      let loaded;
      if (extension === 'json') {
        try { loaded = JSON.parse(text); } catch { throw new Error('The JSON file is not valid.'); }
        // Exported source and saved scenarios are inert: import only dimensions.
        if (loaded?.version === 1 && loaded.record?.version === 1) loaded = loaded.record.current?.state;
      } else {
        const rows = text.split(/\r?\n/);
        if (rows.length !== 2 || rows[0].trim() !== 'thickness,opening,rearClearance') throw new Error('CSV needs the header thickness,opening,rearClearance and one row of dimensions.');
        const values = rows[1].split(',').map(value => value.trim());
        if (values.length !== 3 || values.some(value => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))) throw new Error('CSV dimensions must be three numbers in millimeters.');
        loaded = Object.fromEntries(keys.map((key, index) => [key, Number(values[index])]));
      }
      if (!validState(loaded)) throw new Error('Use only thickness (1–100), opening (1–120) and rearClearance (0–150), in mm with at most one decimal.');
      state = { ...loaded }; get('error').textContent = ''; draw();
    } catch (error) {
      if (version === fileVersion) get('error').textContent = error instanceof Error ? error.message : 'Could not read that file.';
    } finally { if (version === fileVersion) event.target.value = ''; }
  });
  draw();
</script>`;

export function workflowClampMessage() {
  return `Explore the desk and clamp dimensions.\n\n\`\`\`ws-block:html\n${workflowClampDemo}\n\`\`\``;
}
