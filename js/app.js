// js/app.js

// 0) Monkey-patch canvas to suppress the will-read-frequently warning
const _origGetCtx = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function(type, options) {
  if (type === '2d') {
    const opts = Object.assign({}, options, { willReadFrequently: true });
    return _origGetCtx.call(this, type, opts);
  }
  return _origGetCtx.call(this, type, options);
};

document.addEventListener('DOMContentLoaded', () => {
  let stopsMetadata = {};
  let scheduleKeys = [];
  let currentIdx = 0;
  let gap = 1;
  let playTimer = null;

  let map, heatLayer, routeLayer;

  // 1) Load metadata & index.json
  Promise.all([
    fetch('sanitized_output/stops_metadata.json').then(r => r.json()),
    fetch('sanitized_output/index.json').then(r => r.json())
  ]).then(([stopsObj, idx]) => {
    Object.entries(stopsObj).forEach(([id, stop]) => {
      stopsMetadata[id] = stop;
    });
    scheduleKeys = idx.map(d => d.schedule_key);
    setupControls();
    initMap();
  });

  // 2) UI wiring
  function setupControls() {
    const selA = document.getElementById('selA');
    const selB = document.getElementById('selB');
    const modeRadios = document.getElementsByName('mode');
    const gapInput = document.getElementById('gap');
    const slider = document.getElementById('slider');
    const playBtn = document.getElementById('play');

    // populate selectors
    scheduleKeys.forEach((key, i) => {
      selA.add(new Option(key, i));
      selB.add(new Option(key, i));
    });

    // gap control
    gapInput.value = gap;
    gapInput.addEventListener('change', () => {
      gap = Math.max(1, Math.min(scheduleKeys.length - 1, +gapInput.value));
      gapInput.value = gap;
      renderFrame();
    });

    // mode toggle
    modeRadios.forEach(r => r.addEventListener('change', () => {
      if (getMode() === 'heat') {
        selA.disabled = true;
        selA.value = 0;
        slider.min = 0;
        slider.max = scheduleKeys.length - 1;
        slider.value = currentIdx;
      } else {
        selA.disabled = false;
        slider.min = gap;
        slider.max = scheduleKeys.length - 1;
        slider.value = currentIdx + gap;
      }
      renderFrame();
    }));

    // selA / selB changes
    selA.addEventListener('change', () => {
      currentIdx = +selA.value;
      renderFrame();
    });
    selB.addEventListener('change', () => {
      const b = +selB.value;
      currentIdx = b - gap;
      selA.value = currentIdx;
      renderFrame();
    });

    // slider changes
    slider.addEventListener('input', () => {
      const mode = getMode();
      const v = +slider.value;
      if (mode === 'heat') {
        currentIdx = v;
        selB.value = v;
      } else {
        selB.value = v;
        currentIdx = v - gap;
        selA.value = currentIdx;
      }
      renderFrame();
    });

    // play/pause
    playBtn.addEventListener('click', () => {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
        playBtn.textContent = 'Play';
      } else {
        playBtn.textContent = 'Pause';
        playTimer = setInterval(() => {
          const mode = getMode();
          if (mode === 'heat') {
            currentIdx = (currentIdx + 1) % scheduleKeys.length;
            selB.value = currentIdx;
            slider.value = currentIdx;
          } else {
            currentIdx++;
            if (currentIdx + gap >= scheduleKeys.length) currentIdx = 0;
            selA.value = currentIdx;
            selB.value = currentIdx + gap;
            slider.value = currentIdx + gap;
          }
          renderFrame();
        }, 1000);
      }
    });

    // initial defaults
    selA.value = 0;
    selB.value = gap;
    slider.min = gap;
    slider.max = scheduleKeys.length - 1;
    slider.value = gap;
  }

  function getMode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  // 3) Initialize Leaflet map & layers
  function initMap() {
    map = L.map('map').setView([39.7392, -104.9903], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    heatLayer = L.heatLayer([], { radius: 25, blur: 15 }).addTo(map);
    routeLayer = L.geoJSON(null, {
      style: { color: '#0078A8', weight: 2, opacity: 0.7 }
    }).addTo(map);

    // draw static network once
    fetch('sanitized_output/shapes.topo.json')
      .then(r => r.json())
      .then(topo => {
        const geo = topojson.feature(topo, topo.objects.shapes);
        routeLayer.addData(geo);
      });

    renderFrame();
  }

  // 4) Render based on mode
  function renderFrame() {
    heatLayer.setLatLngs([]);
    routeLayer.clearLayers();

    // always redraw network
    fetch('sanitized_output/shapes.topo.json')
      .then(r => r.json())
      .then(topo => {
        const geo = topojson.feature(topo, topo.objects.shapes);
        routeLayer.addData(geo);
      });

    const mode = getMode();
    if (mode === 'heat') {
      loadHeat(scheduleKeys[currentIdx]);
    } else {
      loadDelta(scheduleKeys[currentIdx], scheduleKeys[currentIdx + gap]);
    }
  }

  // 5a) Load raw boardings heat
  function loadHeat(key) {
    fetch(`sanitized_output/heat_${key}_Weekday.json`)
      .then(r => r.json())
      .then(points => {
        const latlngs = points
          .map(({id, w}) => {
            const s = stopsMetadata[id];
            if (!s || s.stop_lat == null || s.stop_lon == null) return null;
            return [s.stop_lat, s.stop_lon, w];
          })
          .filter(p => Array.isArray(p) && p.length === 3);
        heatLayer.setLatLngs(latlngs);
      });
  }

  // 5b) Load delta heat between A and B
  function loadDelta(a, b) {
    Promise.all([
      fetch(`sanitized_output/heat_${a}_Weekday.json`).then(r => r.json()),
      fetch(`sanitized_output/heat_${b}_Weekday.json`).then(r => r.json())
    ]).then(([ptsA, ptsB]) => {
      const mapA = {};
      ptsA.forEach(({id, w}) => { mapA[id] = w; });
      const latlngs = ptsB
        .map(({id, w}) => {
          const s = stopsMetadata[id];
          if (!s || s.stop_lat == null || s.stop_lon == null) return null;
          return [s.stop_lat, s.stop_lon, Math.abs(w - (mapA[id] || 0))];
        })
        .filter(p => Array.isArray(p) && p.length === 3);
      heatLayer.setLatLngs(latlngs);
    });
  }
});
