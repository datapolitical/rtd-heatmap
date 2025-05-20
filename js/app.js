// js/app.js
import { presetList, populatePresetDropdown, applyPresetSettings } from './presets.js';

// Initialize map
const map = L.map('map').setView([39.75, -105.0], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

// UI elements
const playBtn      = document.getElementById('playBtn'),
      timeline     = document.getElementById('timeline'),
      scheduleSel  = document.getElementById('scheduleSelect'),
      mapTypeSel   = document.getElementById('mapType'),
      radiusRng    = document.getElementById('radius'),
      blurRng      = document.getElementById('blur'),
      maxRng       = document.getElementById('max'),
      radiusNum    = document.getElementById('radiusNum'),
      blurNum      = document.getElementById('blurNum'),
      maxNum       = document.getElementById('maxNum'),
      scaleSel     = document.getElementById('scale'),
      presetSelect = document.getElementById('presetSelect');

let frames = [],        // array of { schedule_key, date, file }
    allFeatures = [],   // array of [lat, lon, weight] arrays
    heatLayer, posLayer, negLayer,
    playing = false,
    playInt,
    noDataControl = null;

// Helper to link a range + number input
function bind(rangeEl, numEl) {
  rangeEl.oninput = () => { numEl.value = rangeEl.value; renderFrame(+timeline.value); };
  numEl.onchange  = () => { rangeEl.value = numEl.value; renderFrame(+timeline.value); };
}

// 1) Load stops metadata
let stopsMeta = {};
fetch('sanitized_output/stops_metadata.json')
  .then(r => r.ok ? r.json() : Promise.reject('stops_metadata.json not found'))
  .then(obj => {
    stopsMeta = obj;
    console.log('✔ Loaded stops metadata:', Object.keys(stopsMeta).length, 'stops');
  })
  .catch(err => console.error('❌ Error loading stops metadata:', err));

// 2) Load index and heat data
Promise.all([
  fetch('sanitized_output/index.json').then(r => {
    if (!r.ok) throw new Error(`index.json ${r.status}`);
    return r.json();
  })
])
.then(([list]) => {
  // filter only heat files
  frames = list
    .filter(e => e.file.startsWith('heat_'))
    .map(e => ({ schedule_key: e.schedule_key, date: e.date, file: e.file }));
  if (!frames.length) throw new Error('No heat_*.json entries in index.json');

  // populate UI
  scheduleSel.innerHTML = frames
    .map((f,i) => `<option value="${i}">${f.schedule_key} ${f.date}</option>`)
    .join('');
  timeline.max = frames.length - 1;

  // fetch heat entries
  return Promise.all(
    frames.map(f =>
      fetch(`sanitized_output/${f.file}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    )
  );
})
.then(arrays => {
  // arrays[i] is an array of { id, w }
  allFeatures = arrays.map(entries =>
    entries
      .map(({id, w}) => {
        const loc = stopsMeta[id] || {};
        return [ loc.lat, loc.lon, w ];
      })
      .filter(pt => typeof pt[0] === 'number' && typeof pt[1] === 'number')
  );

  console.log('✔ Prepared allFeatures, sample counts:', allFeatures.map(a => a.length));

  populatePresetDropdown(presetSelect);

  // seed controls so frame 0 shows immediately
  const { rad, blu, maxVal } = applyPresetSettings(presetSelect.value, allFeatures[0]);
  radiusRng.value = radiusNum.value = rad;
  blurRng.value   = blurNum.value   = blu;
  maxRng.value    = maxNum.value    = maxVal;

  updateFrame(0);
})
.catch(err => console.error('❌ Error loading heatmap data:', err));

// Draw a single frame
function renderFrame(idx) {
  [heatLayer, posLayer, negLayer].forEach(l => l && map.removeLayer(l));
  if (noDataControl) { map.removeControl(noDataControl); noDataControl = null; }

  const pts = allFeatures[idx] || [];
  if (!pts.length) {
    noDataControl = L.control({ position: 'topright' });
    noDataControl.onAdd = () => {
      const d = L.DomUtil.create('div', 'no-data');
      d.textContent = `No data for ${frames[idx].schedule_key} ${frames[idx].date}`;
      return d;
    };
    return noDataControl.addTo(map);
  }

  const isDelta = mapTypeSel.value === 'change';
  const { rad, blu, maxVal, scale } = applyPresetSettings(presetSelect.value, pts);

  if (isDelta) {
    const pos = pts.filter(p => p[2] > 0);
    const neg = pts.filter(p => p[2] < 0).map(p => [p[0], p[1], Math.abs(p[2])]);
    heatLayer = L.heatLayer(pos,    { radius: rad, blur: blu, max: maxVal, scale, gradient: {0.4:'blue',0.65:'lime',1:'red'} }).addTo(map);
    posLayer  = L.heatLayer(neg,    { radius: rad, blur: blu, max: maxVal, scale }).addTo(map);
  } else {
    heatLayer = L.heatLayer(pts, { radius: rad, blur: blu, max: maxVal, scale }).addTo(map);
  }
}

// Update UI + map for a given frame index
function updateFrame(i) {
  i = Math.max(0, Math.min(frames.length - 1, i));
  timeline.value = i;
  scheduleSel.value = i;
  renderFrame(i);
}

// Wire up controls
playBtn.onclick      = () => {
  if (!playing) {
    playing = true;
    playBtn.textContent = '■';
    playInt = setInterval(() => updateFrame(+timeline.value + 1), 1000);
  } else {
    playing = false;
    playBtn.textContent = '▶';
    clearInterval(playInt);
  }
};
timeline.oninput     = () => updateFrame(+timeline.value);
scheduleSel.onchange = () => updateFrame(+scheduleSel.value);
mapTypeSel.onchange  = () => renderFrame(+timeline.value);
bind(radiusRng, radiusNum);
bind(blurRng, blurNum);
bind(maxRng, maxNum);
scaleSel.onchange    = () => renderFrame(+timeline.value);
presetSelect.onchange= () => renderFrame(+timeline.value);
