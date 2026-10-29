export const inlineHtmlDemo = `<title>Desk clamp fit</title>
<style>
  .scene { padding: 0; }
  h2 { margin: 0 0 6px; font-size: inherit; font-weight: 600; }
  p { margin: 0; color: hsl(var(--muted-foreground)); }
  .drawing { margin: 20px 0; padding: 16px; background: hsl(var(--muted) / .4); border-radius: 8px; }
  .diagram-heading { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  svg { display: block; width: 100%; height: auto; }
  .desk { fill: hsl(var(--muted-foreground) / .3); }
  .clamp { fill: none; stroke: hsl(var(--foreground)); stroke-width: 10; stroke-linejoin: round; }
  .measure { stroke: hsl(var(--primary-ink)); stroke-width: 2; }
  label { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  input { display: block; width: 100%; accent-color: hsl(var(--primary-ink)); }
  output { font-variant-numeric: tabular-nums; }
  .result { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; }
  #fit { font-weight: 500; }
</style>
<section class="scene">
  <h2>Will the clamp fit?</h2>
  <p>Compare the desk thickness with a 60 mm clamp opening.</p>
  <div class="drawing">
    <div class="diagram-heading"><span>Desk surface</span><output id="diagram-value">28 mm</output></div>
    <svg viewBox="0 40 510 170" role="img" aria-label="Desk clamp cross-section">
      <rect id="desk" class="desk" x="70" y="75" width="365" height="46" rx="3" />
      <path class="clamp" d="M350 65 H450 V180 H365" />
      <path class="clamp" d="M392 166 V140 M372 137 H412" />
      <path class="measure" d="M50 75 V121 M44 75 H56 M44 121 H56" id="dimension" />
    </svg>
  </div>
  <label for="thickness">Desk thickness <output id="thickness-value">28 mm</output></label>
  <input id="thickness" type="range" min="10" max="80" value="28" step="1" />
  <div class="result"><span id="fit">Fits</span><output id="clearance">32 mm spare</output></div>
</section>
<script>
  const slider = document.getElementById('thickness');
  function updateFit() {
    const thickness = Number(slider.value);
    const bottom = 75 + thickness * 1.65;
    document.getElementById('desk').setAttribute('height', thickness * 1.65);
    document.getElementById('dimension').setAttribute('d', 'M50 75 V' + bottom + ' M44 75 H56 M44 ' + bottom + ' H56');
    document.getElementById('diagram-value').textContent = thickness + ' mm';
    document.getElementById('thickness-value').textContent = thickness + ' mm';
    document.getElementById('fit').textContent = thickness <= 60 ? 'Fits' : 'Opening too small';
    document.getElementById('clearance').textContent = thickness <= 60 ? (60 - thickness) + ' mm spare' : (thickness - 60) + ' mm over';
  }
  slider.addEventListener('input', updateFit);
  updateFit();
</script>`;

export function inlineHtmlMessage(source = inlineHtmlDemo, marker = '```') {
  return `Here is an interactive cross-section.\n\n${marker}ws-block:html\n${source}\n${marker}\n\nAdjust the thickness to see the available clearance.`;
}
