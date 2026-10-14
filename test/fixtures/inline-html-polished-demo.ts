export const polishedClampDemo = `<title>Desk clamp fit</title>
<style>
  .clamp { stroke: var(--diagram-node-title); stroke-width: calc(var(--diagram-connector-width) * 3); }
  .dimension { stroke: var(--diagram-metadata); }
  .drawing-labels { display: flex; justify-content: space-between; gap: var(--space-4); }
  .result { display: flex; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
  #clearance { color: var(--diagram-metadata); }
</style>
<section class="visual">
  <figure class="diagram-surface">
    <div class="drawing-labels"><span>Desk</span><span>60 mm opening</span></div>
    <svg viewBox="0 0 600 228" role="img" aria-label="Desk thickness and clamp clearance">
      <rect id="desk" class="diagram-node" x="70" y="52" width="396" height="50.4" rx="6" />
      <path class="diagram-connector clamp" d="M408 46 H490 V166 H408" />
      <path id="screw" class="diagram-connector clamp" d="M438 162 V110.4 M425 110.4 H451" />
      <path id="dimension" class="diagram-connector dimension" d="M49 52 V102.4 M44 52 H54 M44 102.4 H54" />
    </svg>
  </figure>
  <div class="visual-field">
    <label for="thickness">Desk thickness</label><output id="thickness-value" for="thickness">28 mm</output>
    <input id="thickness" type="range" min="10" max="80" value="28" step="1" />
  </div>
  <div class="result"><output id="fit" for="thickness">Fits</output><output id="clearance" for="thickness">32 mm clearance</output></div>
</section>
<script>
  const slider = document.getElementById('thickness');
  function updateFit() {
    const thickness = Number(slider.value);
    const bottom = 52 + thickness * 1.8;
    const contact = Math.min(bottom + 8, 156);
    document.getElementById('desk').setAttribute('height', thickness * 1.8);
    document.getElementById('dimension').setAttribute('d', 'M49 52 V' + bottom + ' M44 52 H54 M44 ' + bottom + ' H54');
    document.getElementById('screw').setAttribute('d', 'M438 162 V' + contact + ' M425 ' + contact + ' H451');
    document.getElementById('thickness-value').textContent = thickness + ' mm';
    document.getElementById('fit').textContent = thickness <= 60 ? 'Fits' : 'Opening too small';
    document.getElementById('clearance').textContent = thickness <= 60 ? (60 - thickness) + ' mm clearance' : (thickness - 60) + ' mm over';
  }
  slider.addEventListener('input', updateFit);
  updateFit();
</script>`;

export const polishedEscalatorDemo = `<title>Why escalator steps stay level</title>
<style>
  .landing-labels, .track-labels { display: flex; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
  .track-labels { justify-content: flex-start; gap: var(--space-5); color: var(--diagram-metadata); }
  .track-labels span { display: inline-flex; align-items: center; gap: var(--space-2); }
  .track-labels svg { width: 22px; height: 10px; }
  .tread { stroke: var(--diagram-node-title); stroke-width: calc(var(--diagram-connector-width) * 2); }
  #level { opacity: .5; }
  .roller { fill: var(--diagram-canvas); stroke: var(--diagram-node-title); }
  .position-field { flex: 1 1 12rem; }
</style>
<section class="visual">
  <figure class="diagram-surface">
    <div class="landing-labels"><span>Level tread</span><span>Flat landing →</span></div>
    <svg viewBox="20 88 620 220" role="img" aria-label="A rigid escalator step with two rollers on separate tracks and a horizontal tread">
      <path id="trackA" class="diagram-connector" />
      <path id="trackB" class="diagram-guide" />
      <path id="body" class="diagram-node" />
      <path id="level" class="diagram-guide" />
      <path id="tread" class="diagram-connector tread" />
      <circle id="rollerA" class="diagram-node roller" r="6" />
      <circle id="rollerB" class="diagram-node roller" r="6" />
    </svg>
    <figcaption class="track-labels">
      <span><svg viewBox="0 0 22 10" aria-hidden="true"><path class="diagram-connector" d="M1 5 H21" /></svg>Chain roller</span>
      <span><svg viewBox="0 0 22 10" aria-hidden="true"><path class="diagram-guide" d="M1 5 H21" /></svg>Guide roller</span>
    </figcaption>
  </figure>
  <div class="visual-controls">
    <button id="play" type="button" aria-pressed="false">Play</button>
    <div class="visual-field position-field">
      <label for="position">Position</label><output id="position-value" for="position">19%</output>
      <input id="position" type="range" min="180" max="540" value="250" step="1" />
    </div>
  </div>
  <p id="description">Both rollers climb together; their separate tracks keep the tread level.</p>
</section>
<script>
  const get = id => document.getElementById(id);
  function height(x) {
    if (x <= 300) return 260 - .42 * (x - 60);
    if (x < 440) { const t = x - 300; return 159.2 - .42 * (t - t * t / 280); }
    return 129.8;
  }
  function rail(shift, drop) {
    let d = '';
    for (let x = 30; x <= 625; x += 5) d += (x === 30 ? 'M' : 'L') + x + ' ' + (height(x + shift) + drop) + ' ';
    return d;
  }
  get('trackA').setAttribute('d', rail(0, 0));
  get('trackB').setAttribute('d', rail(100, 58));
  function draw() {
    const x = Number(get('position').value), y = height(x), back = x - 100;
    get('body').setAttribute('d', 'M' + (back - 12) + ' ' + (y - 24) + 'H' + (x + 14) + 'V' + (y + 8) + 'L' + back + ' ' + (y + 58) + 'Z');
    get('tread').setAttribute('d', 'M' + (back - 12) + ' ' + (y - 24) + 'H' + (x + 14));
    get('level').setAttribute('d', 'M' + (back - 24) + ' ' + (y - 24) + 'H' + (x + 65));
    get('rollerA').setAttribute('cx', x); get('rollerA').setAttribute('cy', y);
    get('rollerB').setAttribute('cx', back); get('rollerB').setAttribute('cy', y + 58);
    get('position-value').textContent = Math.round((x - 180) / 360 * 100) + '%';
    get('description').textContent = x < 300
      ? 'Both rollers climb together; their separate tracks keep the tread level.'
      : x < 440 ? 'Each roller follows its own curve while the rigid step holds its tread level.'
      : 'Both tracks are horizontal at the landing, bringing neighboring steps to the same height.';
  }
  let playing = false, last = 0;
  function stop() { playing = false; get('play').textContent = 'Play'; get('play').setAttribute('aria-pressed', 'false'); }
  get('position').oninput = () => { stop(); draw(); };
  get('play').onclick = () => {
    playing = !playing;
    if (playing && Number(get('position').value) >= 540) get('position').value = 180;
    get('play').textContent = playing ? 'Pause' : 'Play';
    get('play').setAttribute('aria-pressed', String(playing));
  };
  function animate(time) {
    const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
    if (playing) {
      get('position').value = Math.min(540, Number(get('position').value) + dt * 45);
      draw();
      if (Number(get('position').value) >= 540) stop();
    }
    requestAnimationFrame(animate);
  }
  draw(); requestAnimationFrame(animate);
</script>`;
