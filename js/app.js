// js/app.js
import { presetList, populatePresetDropdown, applyPresetSettings } from './presets.js';

// ——— Map & controls setup —————————————————————————————
const map = L.map('map').setView([39.75, -105.0], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

const playBtn      = document.getElementById('playBtn'),
      timeline     = document.getElementById('timeline'),
      periodSelect = document.getElementById('periodSelect'),
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

let stopsMeta = {},
    indexList = [],
    periods = [],
    framesByPeriod = {},
    featuresCache = {},    // file → [ [lat,lon,w], ... ]
    deltaCache    = {},    // "fileA|fileB" → [ [lat,lon,delta], ... ]
    currentPeriod = null,
    heatLayer, posLayer, negLayer,
    playing = false, playInt, noDataControl = null;

// link range + number
function bind(rangeEl, numEl) {
  rangeEl.oninput = () => { numEl.value = rangeEl.value; updateStage(+timeline.value); };
  numEl.onchange  = () => { rangeEl.value = numEl.value; updateStage(+timeline.value); };
}

// ——— Load stops metadata —————————————————————————————
fetch('sanitized_output/stops_metadata.json')
  .then(r => r.json())
  .then(obj => stopsMeta = obj)
  .catch(e => console.error('Loading stops metadata failed:', e));

// ——— Load index and build period dropdown ———————————————————
fetch('sanitized_output/index.json')
  .then(r => r.json())
  .then(list => {
    indexList = list.filter(e => e.file.startsWith('heat_'));
    indexList.forEach(e => { e.period = e.file.split('_')[2]; });
    indexList.forEach(e => {
      (framesByPeriod[e.period] = framesByPeriod[e.period] || [])
        .push({ date: e.date, file: e.file });
    });
    periods = Object.keys(framesByPeriod).sort();
    periodSelect.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
    periodSelect.onchange = () => switchPeriod(periodSelect.value);
    switchPeriod(periods[0]);
  })
  .catch(e => console.error('Loading index failed:', e));

// ——— Switch to a given period ————————————————————————
function switchPeriod(period) {
  currentPeriod = period;
  const frames = framesByPeriod[period].sort((a,b) => a.date.localeCompare(b.date));
  scheduleSel.innerHTML = frames
    .map((f,i) => `<option value="${i}">${f.date}</option>`)
    .join('');
  timeline.max = frames.length - 1;
  featuresCache = {};
  deltaCache = {};
  updateStage(0);
  // preload the first two frames and their delta
  preloadFrame(0);
  preloadFrame(1);
  preloadDelta(0, 1);
}

// ——— Lazy‐load & parse one frame ——————————————————————
function loadFrame(i) {
  const frames = framesByPeriod[currentPeriod].sort((a,b)=>a.date.localeCompare(b.date));
  const frame = frames[i];
  if (!frame) return Promise.resolve([]);
  if (featuresCache[frame.file]) return Promise.resolve(featuresCache[frame.file]);

  return fetch(`sanitized_output/${frame.file}`)
    .then(r => r.json())
    .then(entries => {
      const pts = entries.map(({id,w}) => {
        const loc = stopsMeta[id] || {};
        return [loc.lat, loc.lon, w];
      }).filter(p => p[0] != null);
      featuresCache[frame.file] = pts;
      return pts;
    })
    .catch(() => {
      featuresCache[frame.file] = [];
      return [];
    });
}

// ——— Preload a frame ——————————————————————————————
function preloadFrame(i) {
  loadFrame(i).catch(() => {});
}

// ——— Preload a delta between two frames ———————————————————
function preloadDelta(i, j) {
  const frames = framesByPeriod[currentPeriod].sort((a,b)=>a.date.localeCompare(b.date));
  const fi = frames[i], fj = frames[j];
  if (!fi || !fj) return;
  const key = `${fi.file}|${fj.file}`;
  if (deltaCache[key]) return;

  Promise.all([loadFrame(i), loadFrame(j)]).then(([prevPts, currPts]) => {
    deltaCache[key] = computeDelta(currPts, prevPts);
  });
}

// ——— Compute delta between two frames —————————————————————
function computeDelta(curr, prev) {
  const mapPrev = new Map(prev.map(p => [p[0] + ',' + p[1], p[2]]));
  return curr.map(([lat,lon,w]) => [lat, lon, w - (mapPrev.get(lat+','+lon) || 0)]);
}

// ——— Render one frame with smooth transition ————————————
function renderStage(i) {
  const oldLayers = [heatLayer, posLayer, negLayer];
  if (noDataControl) { map.removeControl(noDataControl); noDataControl = null; }

  const sorted = framesByPeriod[currentPeriod].sort((a,b)=>a.date.localeCompare(b.date));
  loadFrame(i).then(currPts => {
    if (!currPts.length) {
      noDataControl = L.control({position:'topright'});
      noDataControl.onAdd = () => {
        const d = L.DomUtil.create('div','no-data');
        d.textContent = `No data: ${currentPeriod} ${sorted[i].date}`;
        return d;
      };
      return noDataControl.addTo(map);
    }

    const draw = pts => {
      transitionLayers(pts, oldLayers);
      // preload adjacent frames & deltas
      preloadFrame(i+1);
      preloadFrame(i-1);
      preloadDelta(i, i+1);
      preloadDelta(i+1, i+2);
    };

    if (mapTypeSel.value === 'change' && i > 0) {
      const key = `${sorted[i-1].file}|${sorted[i].file}`;
      if (deltaCache[key]) {
        draw(deltaCache[key]);
      } else {
        Promise.all([loadFrame(i-1), loadFrame(i)]).then(([prevPts, pts]) => {
          const d = computeDelta(pts, prevPts);
          deltaCache[key] = d;
          draw(d);
        });
      }
    } else {
      draw(currPts);
    }
  });
}

// ——— Add new layers then remove the old ones ——————————
function transitionLayers(pts, oldLayers) {
  const { rad, blu, maxVal, scale } = applyPresetSettings(presetSelect.value, pts);

  let newHeat, newPos;
  if (mapTypeSel.value === 'change') {
    const pos = pts.filter(p => p[2] > 0);
    const neg = pts.filter(p => p[2] < 0).map(p => [p[0], p[1], Math.abs(p[2])]);
    newHeat = L.heatLayer(pos,    { radius: rad, blur: blu, max: maxVal, scale, gradient:{0.4:'blue',0.65:'lime',1:'red'} }).addTo(map);
    newPos  = L.heatLayer(neg,    { radius: rad, blur: blu, max: maxVal, scale }).addTo(map);
  } else {
    newHeat = L.heatLayer(pts, { radius: rad, blur: blu, max: maxVal, scale }).addTo(map);
  }

  oldLayers.forEach(l => l && map.removeLayer(l));
  heatLayer = newHeat;
  posLayer  = newPos;
}

// ——— UI wiring —————————————————————————————————————
function updateStage(i) {
  timeline.value = i;
  scheduleSel.value = i;
  renderStage(i);
}

playBtn.onclick = () => {
  if (!playing) {
    playing = true;
    playBtn.textContent = '■';
    playInt = setInterval(() => updateStage(+timeline.value + 1), 1000);
  } else {
    playing = false;
    playBtn.textContent = '▶';
    clearInterval(playInt);
  }
};
timeline.oninput     = () => updateStage(+timeline.value);
scheduleSel.onchange = () => updateStage(+scheduleSel.value);
mapTypeSel.onchange  = () => renderStage(+timeline.value);
bind(radiusRng, radiusNum);
bind(blurRng, blurNum);
bind(maxRng, maxNum);
scaleSel.onchange    = () => renderStage(+timeline.value);
presetSelect.onchange= () => renderStage(+timeline.value);

// initialize presets dropdown
populatePresetDropdown(presetSelect);
