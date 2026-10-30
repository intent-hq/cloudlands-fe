// i18n-ignore-file — English-only sandbox fixture, not application copy.
// Seasons benchmark for explanatory inline visuals. Runs inside the opaque HTML
// sandbox and uses only intentVisual state/publish. Physics: solar longitude from
// the USNO low-precision Sun algorithm (https://aa.usno.navy.mil/faq/sun_approx,
// accurate to about a day for dates), geometric sunrise and sunset without
// refraction, noon Sun height = 90° − |latitude − declination|.
// Sun yellow and Earth blue are authored, meaning-bearing colors that stay the
// same in light and dark; every other mark and label uses the theme tokens.
export const seasonsDemo = String.raw`<title>How seasons work</title>
<style>
  .seasons { --sun: #f5b301; --sunlight: #ffd23f; --earth: #2f7fe0; --night: #081a3a; }
  .seasons-summary { margin: 0; }
  .seasons-views, .seasons-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: var(--space-4); }
  .seasons-view { display: grid; align-content: start; gap: var(--space-2); }
  .seasons-view > svg { overflow: hidden; }
  .seasons-view figcaption, .seasons-hemispheres { color: var(--diagram-metadata); }
  .seasons-hemispheres { display: grid; gap: var(--space-1); }
  .seasons-sun { fill: var(--sun); }
  .seasons-earth { fill: var(--earth); }
  .seasons-night { fill: var(--night); fill-opacity: .55; }
  .seasons-night-label { fill: #fff; }
  .seasons-ray { stroke: var(--sun); stroke-width: 2; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .seasons-noon-ray { stroke-width: 3; }
  .seasons-beam { fill: var(--sunlight); fill-opacity: .45; stroke: var(--sun); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
  .seasons-axis, .seasons-ground { stroke: var(--diagram-node-title); stroke-width: 1.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .seasons-lit, .seasons-unlit { fill: none; stroke-width: 4; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .seasons-lit { stroke: var(--sun); }
  .seasons-unlit { stroke: var(--diagram-metadata); }
  .seasons-you { fill: var(--diagram-node-title); stroke: hsl(var(--background)); stroke-width: 1.5; }
  .seasons-muted { fill: var(--diagram-metadata); }
  .seasons-handle { fill: transparent; cursor: grab; touch-action: none; }
  .seasons-handle:active { cursor: grabbing; }
  .seasons-handle:focus-visible { outline: none; stroke: hsl(var(--ring)); stroke-width: 2; }
  .seasons-presets { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .seasons-presets button { min-height: var(--control-height-small); }
  .seasons-error { margin: 0; }
  .seasons-error:empty { display: none; }
</style>
<section class="visual seasons" data-seasons>
  <p class="seasons-summary" data-seasons-summary aria-live="polite"></p>
  <div class="seasons-views">
    <figure class="diagram-surface seasons-view">
      <svg viewBox="0 0 360 292" role="group" aria-label="Earth's orbit seen from above the North Pole" data-seasons-orbit>
        <circle class="diagram-guide" cx="180" cy="150" r="96" />
        <path class="diagram-connector" d="M104 214 L112 218 L110 209" />
        <line class="seasons-ray" data-seasons-orbit-ray />
        <circle class="seasons-sun" cx="180" cy="150" r="20" data-seasons-sun />
        <text class="diagram-label seasons-muted" x="180" y="24" text-anchor="middle" dominant-baseline="central">Dec solstice</text>
        <text class="diagram-label seasons-muted" x="180" y="276" text-anchor="middle" dominant-baseline="central">Jun solstice</text>
        <text class="diagram-label seasons-muted" x="62" y="150" text-anchor="end"><tspan x="62" dy="-0.2em">Mar</tspan><tspan x="62" dy="1.2em">equinox</tspan></text>
        <text class="diagram-label seasons-muted" x="298" y="150" text-anchor="start"><tspan x="298" dy="-0.2em">Sep</tspan><tspan x="298" dy="1.2em">equinox</tspan></text>
        <g data-seasons-orbit-group>
          <circle class="seasons-earth" r="14" data-seasons-earth />
          <path class="seasons-night" d="M0 -14 A14 14 0 0 1 0 14 Z" data-seasons-orbit-night />
          <line class="seasons-axis" data-seasons-orbit-axis />
          <circle class="seasons-you" r="2.5" data-seasons-orbit-pole />
          <circle class="seasons-handle" r="24" tabindex="0" role="slider" aria-label="Date on Earth's orbit" aria-valuemin="0" aria-valuemax="364" data-seasons-orbit-earth />
        </g>
      </svg>
      <figcaption>Seen from above the North Pole. Drag Earth: its axis keeps pointing the same way all year.</figcaption>
    </figure>
    <figure class="diagram-surface seasons-view">
      <svg viewBox="0 0 320 270" role="img" data-seasons-side>
        <g data-seasons-rays></g>
        <text class="diagram-label seasons-muted" x="10" y="20">Sunlight</text>
        <circle class="seasons-earth" cx="196" cy="135" r="88" />
        <path class="seasons-night" d="M196 47 A88 88 0 0 1 196 223 Z" />
        <text class="diagram-label seasons-night-label" x="250" y="135" text-anchor="middle" dominant-baseline="central">Night</text>
        <line class="diagram-guide" data-seasons-equator />
        <line class="seasons-axis" data-seasons-axis />
        <path class="seasons-unlit" data-seasons-unlit />
        <path class="seasons-lit" data-seasons-lit />
        <line class="seasons-ray seasons-noon-ray" data-seasons-noon-ray />
        <circle class="seasons-you" r="5" data-seasons-you />
        <text class="diagram-label" text-anchor="middle" dominant-baseline="central" data-seasons-pole="north">N</text>
        <text class="diagram-label" text-anchor="middle" dominant-baseline="central" data-seasons-pole="south">S</text>
      </svg>
      <figcaption>Noon, seen from the side. The yellow part of your latitude's circle is in daylight (geometric, without refraction).</figcaption>
      <div class="seasons-hemispheres">
        <span data-seasons-hemisphere="north"></span>
        <span data-seasons-hemisphere="south"></span>
      </div>
    </figure>
    <figure class="diagram-surface seasons-view">
      <svg viewBox="0 0 320 190" role="img" data-seasons-beam-view>
        <path class="seasons-beam" data-seasons-beam />
        <line class="seasons-ground" x1="10" y1="150" x2="310" y2="150" />
        <line class="seasons-lit" y1="150" y2="150" data-seasons-footprint />
        <path class="diagram-connector" data-seasons-angle />
        <text class="diagram-label" x="308" y="24" text-anchor="end" data-seasons-angle-label></text>
        <text class="diagram-label seasons-muted" y="174" text-anchor="middle" data-seasons-spread></text>
      </svg>
      <figcaption data-seasons-beam-caption></figcaption>
    </figure>
  </div>
  <div class="seasons-controls">
    <div class="visual-field">
      <label for="seasons-day">Date</label>
      <output for="seasons-day" data-seasons-date></output>
      <input id="seasons-day" type="range" min="0" max="364" step="1" data-seasons-control="day" />
      <div class="seasons-presets">
        <button type="button" data-seasons-date-preset="mar-equinox">Mar equinox</button>
        <button type="button" data-seasons-date-preset="jun-solstice">Jun solstice</button>
        <button type="button" data-seasons-date-preset="sep-equinox">Sep equinox</button>
        <button type="button" data-seasons-date-preset="dec-solstice">Dec solstice</button>
      </div>
    </div>
    <div class="visual-field">
      <label for="seasons-latitude">Latitude</label>
      <output for="seasons-latitude" data-seasons-latitude></output>
      <input id="seasons-latitude" type="range" min="-90" max="90" step="0.1" data-seasons-control="latitude" />
      <select aria-label="Place" data-seasons-place></select>
    </div>
    <div class="visual-field">
      <label for="seasons-tilt">Axial tilt</label>
      <output for="seasons-tilt" data-seasons-tilt></output>
      <input id="seasons-tilt" type="range" min="0" max="45" step="0.1" data-seasons-control="tilt" />
    </div>
  </div>
  <p class="seasons-error" role="status" data-seasons-error></p>
</section>
<script>
  const root = document.querySelector('[data-seasons]');
  const q = name => root.querySelector('[data-seasons-' + name + ']');
  const control = name => root.querySelector('[data-seasons-control="' + name + '"]');
  const svgNs = 'http://www.w3.org/2000/svg';
  const rad = Math.PI / 180;
  const YEAR = 2026;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const places = [
    ['north-pole', 'North Pole', 90], ['tromso', 'Tromsø', 69.6], ['london', 'London', 51.5],
    ['new-york', 'New York', 40.7], ['singapore', 'Singapore', 1.3], ['quito', 'Quito', -0.2],
    ['sydney', 'Sydney', -33.9], ['ushuaia', 'Ushuaia', -54.8], ['south-pole', 'South Pole', -90]
  ];
  // Apparent solar longitude (degrees) at a moment measured in days from Jan 1, 00:00 UTC.
  function longitude(days) {
    const n = (Date.UTC(YEAR, 0, 1) + days * 864e5 - Date.UTC(2000, 0, 1, 12)) / 864e5;
    const g = (357.528 + 0.9856003 * n) * rad;
    const value = 280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g);
    return ((value % 360) + 360) % 360;
  }
  const days = Array.from({ length: 365 }, (_, day) => day);
  const noonLongitude = days.map(day => longitude(day + 0.5));
  // A season starts on the (UTC) date of its equinox or solstice.
  const endLongitude = days.map(day => longitude(day + 1));
  const gap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const nearestDay = target => days.reduce((best, day) => gap(noonLongitude[day], target) < gap(noonLongitude[best], target) ? day : best, 0);
  const presets = { 'mar-equinox': nearestDay(0), 'jun-solstice': nearestDay(90), 'sep-equinox': nearestDay(180), 'dec-solstice': nearestDay(270) };
  const round1 = value => Math.round(value * 10) / 10;
  const round2 = value => Math.round(value * 100) / 100;
  const formatDate = day => { const date = new Date(Date.UTC(YEAR, 0, 1 + day)); return months[date.getUTCMonth()] + ' ' + date.getUTCDate(); };
  const formatLatitude = value => value === 0 ? '0°' : Math.abs(value) + '° ' + (value > 0 ? 'N' : 'S');
  function formatHours(hours) {
    let whole = Math.floor(hours);
    let minutes = Math.round((hours - whole) * 60);
    if (minutes === 60) { whole += 1; minutes = 0; }
    return minutes ? whole + ' h ' + minutes + ' m' : whole + ' h';
  }
  // Cosine of the sunset hour angle; beyond ±1 the Sun never sets or never rises.
  function sunsetCosine(latitude, declination) {
    const x = -Math.sin(latitude * rad) * Math.sin(declination * rad);
    const y = Math.cos(latitude * rad) * Math.cos(declination * rad);
    if (y < 1e-9) return x < -1e-12 ? -Infinity : x > 1e-12 ? Infinity : 0;
    return x / y;
  }
  function daylight(latitude, declination) {
    const c = sunsetCosine(latitude, declination);
    return c <= -1 ? 24 : c >= 1 ? 0 : 2 * Math.acos(c) / rad / 15;
  }
  function hemisphereSeason(north, solarLongitude) {
    const index = Math.floor(solarLongitude / 90) % 4;
    return (north ? ['Spring', 'Summer', 'Autumn', 'Winter'] : ['Autumn', 'Winter', 'Spring', 'Summer'])[index];
  }
  const oneDecimal = value => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
  const validState = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.day) && value.day >= 0 && value.day <= 364
    && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && oneDecimal(value.latitude)
    && typeof value.tilt === 'number' && Number.isFinite(value.tilt) && value.tilt >= 0 && value.tilt <= 45 && oneDecimal(value.tilt);
  let state = { day: presets['jun-solstice'], latitude: 40.7, tilt: 23.4 };
  try { const saved = window.intentVisual && window.intentVisual.state; if (validState(saved)) state = { day: saved.day, latitude: saved.latitude, tilt: saved.tilt }; } catch {}

  const placeSelect = q('place');
  const custom = document.createElement('option');
  custom.value = 'custom'; custom.textContent = 'Custom';
  placeSelect.append(custom);
  for (const [id, name] of places) { const option = document.createElement('option'); option.value = id; option.textContent = name; placeSelect.append(option); }
  for (const offset of [-2, -1, 0, 1, 2]) {
    const y = 135 + offset * 35;
    const ray = document.createElementNS(svgNs, 'line');
    ray.setAttribute('class', 'seasons-ray');
    ray.setAttribute('x1', '10'); ray.setAttribute('x2', String(196 - Math.sqrt(88 * 88 - (y - 135) ** 2)));
    ray.setAttribute('y1', String(y)); ray.setAttribute('y2', String(y));
    q('rays').append(ray);
  }
  const attrs = (element, values) => { for (const key in values) element.setAttribute(key, typeof values[key] === 'number' ? values[key].toFixed(1) : values[key]); };
  const point = (x, y) => x.toFixed(1) + ' ' + y.toFixed(1);

  function model() {
    const solarLongitude = noonLongitude[state.day];
    const declination = Math.asin(Math.sin(state.tilt * rad) * Math.sin(solarLongitude * rad)) / rad;
    const hours = daylight(state.latitude, declination);
    const height = 90 - Math.abs(state.latitude - declination);
    const sunlight = height > 0 ? Math.round(100 * Math.sin(height * rad)) : 0;
    const place = places.find(entry => Math.abs(entry[2] - state.latitude) < 0.05);
    const season = state.tilt === 0 ? 'No seasons' : state.latitude === 0 ? 'No summer or winter' : hemisphereSeason(state.latitude > 0, endLongitude[state.day]);
    return { solarLongitude, declination, hours, height, sunlight, place, season };
  }

  function drawOrbit(m) {
    const theta = (m.solarLongitude + 180) * rad;
    const x = 180 + 96 * Math.cos(theta), y = 150 - 96 * Math.sin(theta);
    q('orbit-group').setAttribute('transform', 'translate(' + point(x, y) + ')');
    q('orbit-night').setAttribute('transform', 'rotate(' + (Math.atan2(y - 150, x - 180) / rad).toFixed(1) + ')');
    // From above, the axis is a short line whose north end always leans the same way.
    const lean = Math.sin(state.tilt * rad) * 24;
    attrs(q('orbit-axis'), { x1: 0, y1: lean, x2: 0, y2: -lean });
    attrs(q('orbit-pole'), { cx: 0, cy: -lean });
    const ux = (x - 180) / 96, uy = (y - 150) / 96;
    attrs(q('orbit-ray'), { x1: 180 + ux * 24, y1: 150 + uy * 24, x2: x - ux * 18, y2: y - uy * 18 });
    const earth = q('orbit-earth');
    earth.setAttribute('aria-valuenow', String(state.day));
    earth.setAttribute('aria-valuetext', formatDate(state.day));
  }

  function drawSide(m) {
    const d = m.declination * rad, p = state.latitude * rad, R = 88;
    const north = [-Math.sin(d), -Math.cos(d)], east = [-Math.cos(d), Math.sin(d)];
    const at = (vector, scale) => [196 + vector[0] * scale, 135 + vector[1] * scale];
    const [ax, ay] = at(north, R + 16), [bx, by] = at(north, -(R + 16));
    attrs(q('axis'), { x1: ax, y1: ay, x2: bx, y2: by });
    const [nx, ny] = at(north, R + 30), [sx, sy] = at(north, -(R + 30));
    attrs(root.querySelector('[data-seasons-pole="north"]'), { x: nx, y: ny });
    attrs(root.querySelector('[data-seasons-pole="south"]'), { x: sx, y: sy });
    const [ex, ey] = at(east, R), [wx, wy] = at(east, -R);
    attrs(q('equator'), { x1: ex, y1: ey, x2: wx, y2: wy });
    // Your latitude is a circle seen edge-on; s = 1 is noon (facing the Sun), s = −1 midnight.
    const along = s => [196 + R * (Math.sin(p) * north[0] + s * Math.cos(p) * east[0]), 135 + R * (Math.sin(p) * north[1] + s * Math.cos(p) * east[1])];
    const edge = Math.max(-1, Math.min(1, sunsetCosine(state.latitude, m.declination)));
    const segment = (from, to) => from < to && Math.cos(p) > 1e-6 ? 'M' + point(...along(from)) + 'L' + point(...along(to)) : '';
    q('lit').setAttribute('d', segment(edge, 1));
    q('unlit').setAttribute('d', segment(-1, edge));
    const [yx, yy] = along(1);
    attrs(q('you'), { cx: yx, cy: yy });
    const ray = q('noon-ray');
    if (m.height > 0) { attrs(ray, { x1: 10, y1: yy, x2: yx, y2: yy }); ray.removeAttribute('display'); } else ray.setAttribute('display', 'none');
    q('side').setAttribute('aria-label', 'Noon sunlight at ' + formatLatitude(state.latitude) + ': ' + formatHours(m.hours) + ' of daylight.');
    const abs = Math.abs(state.latitude);
    const describe = (north, name) => {
      const hours = daylight(north ? abs : -abs, m.declination);
      const season = state.tilt === 0 ? 'no seasons' : hemisphereSeason(north, endLongitude[state.day]).toLowerCase();
      return name + ' at ' + abs + '°: ' + season + ', ' + formatHours(hours) + ' of daylight';
    };
    q('hemisphere="north"').textContent = describe(true, 'Northern Hemisphere');
    q('hemisphere="south"').textContent = describe(false, 'Southern Hemisphere');
  }

  function drawBeam(m) {
    const beam = q('beam'), footprint = q('footprint'), angle = q('angle'), spread = q('spread');
    if (m.height <= 0) {
      beam.setAttribute('d', ''); angle.setAttribute('d', ''); footprint.setAttribute('display', 'none');
      q('angle-label').textContent = 'Sun below the horizon';
      spread.textContent = '';
      q('beam-caption').textContent = 'At noon the Sun stays below the horizon, so no direct sunlight reaches the ground.';
      q('beam-view').setAttribute('aria-label', 'No direct sunlight at noon.');
      return;
    }
    const a = m.height * rad, factor = 1 / Math.sin(a);
    const width = Math.min(56 * factor, 2000), x1 = 200 - width / 2, x2 = 200 + width / 2;
    const dx = -Math.cos(a) * 420, dy = -Math.sin(a) * 420;
    beam.setAttribute('d', 'M' + point(x1, 150) + 'L' + point(x2, 150) + 'L' + point(x2 + dx, 150 + dy) + 'L' + point(x1 + dx, 150 + dy) + 'Z');
    footprint.removeAttribute('display');
    attrs(footprint, { x1: Math.max(10, x1), x2: Math.min(310, x2) });
    angle.setAttribute('d', x1 > 44 ? 'M' + point(x1 - 30, 150) + 'A30 30 0 0 1 ' + point(x1 - 30 * Math.cos(a), 150 - 30 * Math.sin(a)) : '');
    q('angle-label').textContent = 'Noon Sun ' + Math.round(m.height) + '° high';
    const times = factor >= 99.5 ? 'over 99' : factor.toFixed(factor < 10 ? 2 : 0);
    attrs(spread, { x: 200 });
    spread.textContent = times + '× the ground';
    q('beam-caption').textContent = 'The same beam spreads over ' + times + '× the ground of an overhead Sun, so each patch gets ' + m.sunlight + '% as much sunlight.';
    q('beam-view').setAttribute('aria-label', q('beam-caption').textContent);
  }

  function summary(m) {
    if (state.tilt === 0) return 'With no tilt, neither pole ever leans toward the Sun: days stay about 12 hours long all year, so there are no seasons.';
    const lean = m.declination > 0.5 ? 'The North Pole leans toward the Sun' : m.declination < -0.5 ? 'The South Pole leans toward the Sun' : 'Neither pole leans toward the Sun';
    const where = m.place ? m.place[1] : formatLatitude(state.latitude);
    if (m.hours === 0) return lean + '. At ' + where + ' the Sun stays below the horizon all day.';
    if (m.hours === 24) return lean + '. At ' + where + ' the Sun never sets.';
    return lean + '. At ' + where + ': ' + formatHours(m.hours) + ' of daylight and a noon Sun ' + Math.round(m.height) + '° high.';
  }

  function draw() {
    const m = model();
    drawOrbit(m); drawSide(m); drawBeam(m);
    q('summary').textContent = summary(m);
    q('date').textContent = formatDate(state.day);
    q('latitude').textContent = formatLatitude(state.latitude);
    q('tilt').textContent = state.tilt + '°';
    control('day').value = String(state.day);
    control('latitude').value = String(state.latitude);
    control('tilt').value = String(state.tilt);
    placeSelect.value = m.place ? m.place[0] : 'custom';
    for (const button of root.querySelectorAll('[data-seasons-date-preset]'))
      button.setAttribute('aria-pressed', String(presets[button.dataset.seasonsDatePreset] === state.day));
    const failed = 'Could not share this view. Change a control to try again.';
    try {
      if (window.intentVisual && !window.intentVisual.publish({
        state: { ...state }, title: 'How seasons work',
        inputs: { 'Date': formatDate(state.day), 'Latitude (°)': state.latitude, 'Axial tilt (°)': state.tilt, 'Place': m.place ? m.place[1] : 'Custom' },
        results: {
          'Season': m.season,
          'Daylight (h)': round2(m.hours),
          'Noon Sun height (°)': round1(m.height),
          'Sunlight on flat ground (% of overhead)': m.sunlight,
          'Sun overhead at latitude (°)': round1(m.declination)
        }
      })) q('error').textContent = failed;
      else q('error').textContent = '';
    } catch { q('error').textContent = failed; }
  }
  const setDay = day => { state.day = Math.max(0, Math.min(364, Math.round(day))); draw(); };
  control('day').addEventListener('input', event => setDay(Number(event.target.value)));
  control('latitude').addEventListener('input', event => { state.latitude = round1(Math.max(-90, Math.min(90, Number(event.target.value)))); draw(); });
  control('tilt').addEventListener('input', event => { state.tilt = round1(Math.max(0, Math.min(45, Number(event.target.value)))); draw(); });
  placeSelect.addEventListener('change', () => { const place = places.find(entry => entry[0] === placeSelect.value); if (place) { state.latitude = place[2]; draw(); } });
  for (const button of root.querySelectorAll('[data-seasons-date-preset]'))
    button.addEventListener('click', () => setDay(presets[button.dataset.seasonsDatePreset]));
  const handle = q('orbit-earth');
  handle.addEventListener('keydown', event => {
    const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 30, PageDown: -30 };
    if (event.key === 'Home') setDay(0);
    else if (event.key === 'End') setDay(364);
    else if (Object.hasOwn(steps, event.key)) setDay(state.day + steps[event.key]);
    else return;
    event.preventDefault();
  });
  let dragging = null;
  const dayAtPointer = event => {
    const matrix = q('orbit').getScreenCTM();
    if (!matrix) return state.day;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const target = (Math.atan2(-(local.y - 150), local.x - 180) / rad - 180 + 720) % 360;
    return nearestDay(target);
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dragging !== null) return;
    event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId); dragging = event.pointerId;
  });
  handle.addEventListener('pointermove', event => { if (dragging === event.pointerId) setDay(dayAtPointer(event)); });
  const stop = event => { if (dragging === event.pointerId) dragging = null; };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('lostpointercapture', stop);
  draw();
</script>`;

export function seasonsMessage() {
  return `Seasons come from Earth's tilted axis, not from its distance to the Sun.\n\n\`\`\`ws-block:html\n${seasonsDemo}\n\`\`\``;
}

/**
 * The earlier generated answer to "visualize how seasons work", verbatim from
 * .intent/artifacts/inline-html/seasons-review/conversation.json. It is the
 * "before" for review screenshots only; it is not a physics reference.
 */
export const generatedSeasonsBeforeMessage =
  'Seasons happen because Earth\'s axis is tilted. As Earth goes around the Sun, each hemisphere takes turns leaning toward the Sun. Being closer to the Sun has nothing to do with it.\n\n```ws-block:html\n<style>\n  .seasons-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }\n  .seasons-grid svg { display: block; width: 100%; height: auto; }\n  .seasons-sun { fill: hsl(var(--primary)); }\n  .seasons-ray { stroke: hsl(var(--primary)); stroke-width: 2; }\n  .seasons-night { fill: hsl(var(--foreground) / 0.22); }\n  .seasons-axis { stroke: hsl(var(--foreground)); stroke-width: 1.5; stroke-linecap: round; }\n  .seasons-dot { fill: hsl(var(--foreground)); }\n  .seasons-play { min-width: 4.5em; }\n  .visual-controls input[type=range] { flex: 1; min-width: 120px; }\n</style>\n<div class="visual">\n  <div class="seasons-grid">\n    <div class="diagram-surface">\n      <svg viewBox="0 0 320 180" role="img" aria-label="Earth\'s orbit around the Sun, seen from above">\n        <ellipse class="diagram-guide" cx="160" cy="90" rx="120" ry="52" fill="none" />\n        <circle class="seasons-sun" cx="160" cy="90" r="14" />\n        <text class="diagram-label" x="296" y="94" text-anchor="start">Jun</text>\n        <text class="diagram-label" x="24" y="94" text-anchor="end">Dec</text>\n        <text class="diagram-label" x="160" y="22" text-anchor="middle">Mar</text>\n        <text class="diagram-label" x="160" y="172" text-anchor="middle">Sep</text>\n        <g id="s-earth">\n          <circle class="diagram-node" r="11" />\n          <path id="s-earth-night" class="seasons-night" d="M0,-11 A11 11 0 0 1 0,11 Z" />\n          <line class="seasons-axis" x1="6.8" y1="15.6" x2="-6.8" y2="-15.6" />\n        </g>\n      </svg>\n    </div>\n    <div class="diagram-surface">\n      <svg viewBox="0 0 240 180" role="img" aria-label="Sunlight hitting your latitude at noon">\n        <g id="s-rays"></g>\n        <circle class="diagram-node" cx="150" cy="90" r="64" />\n        <path class="seasons-night" d="M150,26 A64 64 0 0 1 150,154 Z" />\n        <line id="s-equator" class="diagram-guide" />\n        <line id="s-axis" class="seasons-axis" />\n        <line id="s-ray" class="seasons-ray" />\n        <line id="s-horizon" class="diagram-connector" />\n        <circle id="s-dot" class="seasons-dot" r="4" />\n      </svg>\n    </div>\n  </div>\n  <div class="visual-controls">\n    <button id="s-play" class="seasons-play" type="button">Play</button>\n    <input id="s-day" type="range" min="0" max="364" step="1" aria-label="Date">\n    <output id="s-day-out" for="s-day"></output>\n  </div>\n  <div class="visual-field">\n    <div class="visual-row"><label for="s-lat">Your latitude</label><output id="s-lat-out" for="s-lat"></output></div>\n    <input id="s-lat" type="range" min="-80" max="80" step="1">\n  </div>\n  <div>\n    <div class="visual-row"><span>Season</span><span id="s-season"></span></div>\n    <div class="visual-row"><span>Sun height at noon</span><span id="s-alt"></span></div>\n    <div class="visual-row"><span>Daylight</span><span id="s-len"></span></div>\n  </div>\n</div>\n<script>\n  const $ = (id) => document.getElementById(id);\n  const host = window.intentVisual;\n  const saved = host && host.state;\n  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));\n  const model = {\n    day: saved && Number.isFinite(saved.day) ? clamp(Math.round(saved.day), 0, 364) : 171,\n    lat: saved && Number.isFinite(saved.lat) ? clamp(Math.round(saved.lat), -80, 80) : 40\n  };\n  const rad = Math.PI / 180;\n  const months = [\'Jan\',\'Feb\',\'Mar\',\'Apr\',\'May\',\'Jun\',\'Jul\',\'Aug\',\'Sep\',\'Oct\',\'Nov\',\'Dec\'];\n  const fmtDay = (d) => { const t = new Date(2025, 0, 1 + d); return months[t.getMonth()] + \' \' + t.getDate(); };\n  const fmtLat = (l) => l === 0 ? \'0\u00b0\' : Math.abs(l) + \'\u00b0\' + (l > 0 ? \'N\' : \'S\');\n  const set = (el, a) => { for (const k in a) el.setAttribute(k, a[k].toFixed ? a[k].toFixed(1) : a[k]); };\n\n  const rays = $(\'s-rays\');\n  [38, 64, 116, 142].forEach((y) => {\n    const x2 = 150 - Math.sqrt(64 * 64 - (y - 90) ** 2);\n    const l = document.createElementNS(\'http://www.w3.org/2000/svg\', \'line\');\n    l.setAttribute(\'class\', \'diagram-connector\');\n    set(l, { x1: 8, y1: y, x2, y2: y });\n    rays.appendChild(l);\n  });\n\n  function season(day, north) {\n    const n = day >= 79 && day < 172 ? \'Spring\' : day >= 172 && day < 265 ? \'Summer\' : day >= 265 && day < 354 ? \'Autumn\' : \'Winter\';\n    if (north) return n;\n    return { Spring: \'Autumn\', Summer: \'Winter\', Autumn: \'Spring\', Winter: \'Summer\' }[n];\n  }\n\n  function render() {\n    const { day, lat } = model;\n    const decl = 23.44 * Math.sin(2 * Math.PI * (day - 79) / 365);\n    const a = 2 * Math.PI * (day - 171) / 365;\n    const ex = 160 + 120 * Math.cos(a), ey = 90 + 52 * Math.sin(a);\n    $(\'s-earth\').setAttribute(\'transform\', `translate(${ex.toFixed(1)} ${ey.toFixed(1)})`);\n    $(\'s-earth-night\').setAttribute(\'transform\', `rotate(${(Math.atan2(ey - 90, ex - 160) / rad).toFixed(1)})`);\n\n    const d = decl * rad, p = lat * rad, cx = 150, cy = 90, r = 64;\n    const N = [-Math.sin(d), -Math.cos(d)], E = [-Math.cos(d), Math.sin(d)];\n    set($(\'s-axis\'), { x1: cx - N[0] * (r + 14), y1: cy - N[1] * (r + 14), x2: cx + N[0] * (r + 14), y2: cy + N[1] * (r + 14) });\n    set($(\'s-equator\'), { x1: cx - E[0] * r, y1: cy - E[1] * r, x2: cx + E[0] * r, y2: cy + E[1] * r });\n    const u = [Math.cos(p) * E[0] + Math.sin(p) * N[0], Math.cos(p) * E[1] + Math.sin(p) * N[1]];\n    const px = cx + u[0] * r, py = cy + u[1] * r;\n    set($(\'s-dot\'), { cx: px, cy: py });\n    set($(\'s-horizon\'), { x1: px - u[1] * 16, y1: py + u[0] * 16, x2: px + u[1] * 16, y2: py - u[0] * 16 });\n    const alt = 90 - Math.abs(lat - decl);\n    set($(\'s-ray\'), { x1: 8, y1: py, x2: px, y2: py });\n    $(\'s-ray\').style.display = u[0] < 0 ? \'\' : \'none\';\n\n    const c = -Math.tan(p) * Math.tan(d);\n    const hours = c >= 1 ? 0 : c <= -1 ? 24 : 2 * Math.acos(c) / rad / 15;\n    const h = Math.floor(hours), m = Math.round((hours - h) * 60);\n    const len = m === 60 ? `${h + 1} h 0 m` : `${h} h ${m} m`;\n\n    $(\'s-day\').value = String(day);\n    $(\'s-day-out\').textContent = fmtDay(day);\n    $(\'s-lat\').value = String(lat);\n    $(\'s-lat-out\').textContent = fmtLat(lat);\n    $(\'s-season\').textContent = season(day, lat >= 0);\n    $(\'s-alt\').textContent = alt > 0 ? Math.round(alt) + \'\u00b0\' : \'Below horizon\';\n    $(\'s-len\').textContent = len;\n\n    if (host && host.publish) host.publish({\n      state: { day, lat },\n      title: \'How seasons work\',\n      inputs: { date: fmtDay(day), latitude: fmtLat(lat) },\n      results: { season: $(\'s-season\').textContent, noonSunHeight: $(\'s-alt\').textContent, daylight: len, sunDeclination: decl.toFixed(1) + \'\u00b0\' }\n    });\n  }\n\n  let playing = false, last = 0;\n  function tick(t) {\n    if (!playing) return;\n    if (t - last > 40) { model.day = (model.day + 2) % 365; last = t; render(); }\n    requestAnimationFrame(tick);\n  }\n  $(\'s-play\').addEventListener(\'click\', () => {\n    playing = !playing;\n    $(\'s-play\').textContent = playing ? \'Pause\' : \'Play\';\n    if (playing) requestAnimationFrame(tick);\n  });\n  $(\'s-day\').addEventListener(\'input\', (e) => { model.day = Number(e.target.value); render(); });\n  $(\'s-lat\').addEventListener(\'input\', (e) => { model.lat = Number(e.target.value); render(); });\n  render();\n</script>\n```\n\n**How to read it:**\n- **Left (orbit, seen from above):** the tilt of Earth\'s axis stays pointed the same way all year. In June the north end leans toward the Sun, and in December it leans away.\n- **Right (sunlight at noon):** the dot is your latitude. When your hemisphere leans toward the Sun, the light comes in steeper and more concentrated, and days are longer. That is summer.\n- **Edge cases to try:**\n  - Equinox: Mar 20 or Sep 22 gives about 12 hours of daylight everywhere.\n  - Southern latitudes: the seasons are flipped.\n  - Latitudes above about 67\u00b0 get 24 hours of daylight in summer, and no daylight with the Sun below the horizon in winter.\n  - 0\u00b0 (the equator) stays at about 12 hours all year.\n\nI haven\'t checked this in the browser yet. The visual only renders in a frontend build that supports inline HTML visuals.\n\n<!-- suggested-prompts\n\u2754 Why is Earth closest to the Sun in January if it\'s winter up north?\n\ud83d\uded1 Instead, make it a 3D-style orbit with Earth\'s shadow.\n\ud83d\ude80 Screenshot this visual in light and dark mode in the dev app.\n-->';
