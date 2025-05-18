// ─────────────────────────────────────────────
// RTD Heatmap – main logic (ES-module)
// ─────────────────────────────────────────────

// Map init
const map = L.map('map').setView([39.75, -105], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap'
}).addTo(map);

// DOM handles
const playBtn      = document.getElementById('playBtn');
const timeline     = document.getElementById('timeline');
const scheduleSel  = document.getElementById('scheduleSelect');
const compareSel   = document.getElementById('compareSelect');
const compareWrapper = document.getElementById('compareWrapper');
const mapTypeSel   = document.getElementById('mapType');
const valueSel     = document.getElementById('valueType');
const radiusR      = document.getElementById('radius');
const radiusN      = document.getElementById('radiusNum');
const blurR        = document.getElementById('blur');
const blurN        = document.getElementById('blurNum');
const maxR         = document.getElementById('max');
const maxN         = document.getElementById('maxNum');
const scaleSel     = document.getElementById('scaleType');
const legend       = document.getElementById('legend');
const advBtn       = document.getElementById('toggleAdvanced');
const advPanel     = document.getElementById('advancedControls');

// Data holders
let schedules = [];
let allFeatures = [];     // array of [ Feature[] ]
let heatLayer, posLayer, negLayer;
let current = 0;
let playing = false;
let playInt  = null;

// ─────────────────────────────────────────────
// Advanced-mode toggle
// ─────────────────────────────────────────────
let advOpen = true;
advBtn.onclick = () => {
  advOpen = !advOpen;
  advPanel.style.display = advOpen ? 'flex' : 'none';
  advBtn.classList.toggle('active', advOpen);
};

// ─────────────────────────────────────────────
// Helper: keep range + number in sync
// ─────────────────────────────────────────────
[[radiusR, radiusN], [blurR, blurN], [maxR, maxN]].forEach(([range, num]) => {
  range.oninput  = () => { num.value = range.value; render(current); };
  num.onchange   = () => { range.value = num.value; render(current); };
});

// ─────────────────────────────────────────────
// Load schedule list & GeoJSONs
// ─────────────────────────────────────────────
fetch('sanitized_output/index.json')
  .then(r => r.json())
  .then(list => {
    schedules = list;
    scheduleSel.innerHTML = compareSel.innerHTML =
      schedules.map(s => `<option>${s}</option>`).join('');
    timeline.max = schedules.length - 1;

    // Fetch all GeoJSON files
    return Promise.all(
      schedules.map(key =>
        fetch(`sanitized_output/rtd_${key}_Weekday.geojson`)
          .then(r => r.json())
          .then(gj => gj.features)
      )
    );
  })
  .then(results => {
    allFeatures = results;
    render(0);
  });

// ─────────────────────────────────────────────
// Playback controls
// ─────────────────────────────────────────────
playBtn.onclick = () => {
  if (!playing) {
    playInt = setInterval(() => {
      render((current + 1) % schedules.length);
    }, 1000);
    playBtn.textContent = '❚❚ Pause';
  } else {
    clearInterval(playInt);
    playBtn.textContent = '▶ Play';
  }
  playing = !playing;
};

timeline.oninput     = () => render(+timeline.value);
scheduleSel.onchange = () => render(schedules.indexOf(scheduleSel.value));
scaleSel.onchange    = () => render(current);
valueSel.onchange    = () => render(current);

// ─────────────────────────────────────────────
// View-mode handler  (Boardings ↔ Change)
// ─────────────────────────────────────────────
mapTypeSel.onchange = () => {
  const isChange = mapTypeSel.value === 'change';

  // Show / hide the look-back dropdown
  compareWrapper.style.display = isChange ? 'inline-flex' : 'none';

  // 🔄 Repopulate both selects when we expose Change view
  if (isChange) {
    scheduleSel.innerHTML = compareSel.innerHTML =
      schedules.map(s =>
        `<option${s === schedules[current] ? ' selected' : ''}>${s}</option>`
      ).join('');

    // default 1-year (≈3 schedules) look-back
    compareSel.selectedIndex = Math.max(0, current - 3);
  }
  render(current);
};

// ─────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────
function scaleVal(v) {
  if (scaleSel.value === 'sqrt') return Math.sqrt(v);
  if (scaleSel.value === 'log')  return Math.log10(v + 1);
  return v;
}

function toHeatPoints(features, field, positive = null) {
  return features.reduce((pts, f) => {
    let v = f.properties[field] || 0;
    if (positive !== null) {
      if (positive && v <= 0) return pts;
      if (!positive && v >= 0) return pts;
      v = Math.abs(v);
    }
    pts.push([f.geometry.coordinates[1], f.geometry.coordinates[0], scaleVal(v)]);
    return pts;
  }, []);
}

// ─────────────────────────────────────────────
// Core renderer
// ─────────────────────────────────────────────
function render(idx) {
  current = idx;
  scheduleSel.value = schedules[idx];
  timeline.value    = idx;

  [heatLayer, posLayer, negLayer].forEach(l => l && map.removeLayer(l));

  const features = allFeatures[idx];
  if (!features) return;

  const rad = +radiusN.value,
        blu = +blurN.value,
        mx  = +maxN.value;

  // ── Change view ──
  if (mapTypeSel.value === 'change') {
    const backIdx = compareSel.selectedIndex;
    const back    = allFeatures[backIdx];
    const deltas  = features.map(f => {
      const prev = back?.find(p => p.properties.stop_id === f.properties.stop_id);
      const delta = (f.properties.boardings || 0) - (prev?.properties.boardings || 0);
      return { geometry: f.geometry, properties: { ...f.properties, delta } };
    });

    posLayer = L.heatLayer(toHeatPoints(deltas, 'delta', true),  {
      radius: rad, blur: blu, max: mx,
      gradient: { 0.4: 'pink', 1: 'red' }
    }).addTo(map);
    negLayer = L.heatLayer(toHeatPoints(deltas, 'delta', false), {
      radius: rad, blur: blu, max: mx,
      gradient: { 0.4: 'lightblue', 1: 'blue' }
    }).addTo(map);

    legend.innerHTML = '<span style="background:red"></span> Increase '
                     + '<span style="background:blue"></span> Decrease';
    return;
  }

  // ── Boardings / Alightings / Total ──
  const field = valueSel.value;
  heatLayer = L.heatLayer(toHeatPoints(features, field), {
    radius: rad, blur: blu, max: mx
  }).addTo(map);

  legend.innerHTML = `<span style="background:red"></span> ${field}`;
}
