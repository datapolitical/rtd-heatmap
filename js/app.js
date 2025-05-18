import { presetList, populatePresetDropdown, applyPresetSettings } from './presets.js';

const map = L.map('map').setView([39.75, -105.0], 10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

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
      scaleSel     = document.getElementById('scaleType'),
      legend       = document.getElementById('legend'),
      valueTypeSel = document.getElementById('valueType'),
      lookbackSel = document.getElementById('lookbackSelect'),
      avgWindowNum = document.getElementById('avgWindow'),
      defaultBtn   = document.getElementById('defaultBtn'),
      presetSelect = document.getElementById('presetSelect');

let schedules = [], allFeatures = [], heatLayer, posLayer, negLayer;
let playing = false, playInterval, noDataControl = null;

// Load schedule index
fetch('sanitized_output/index.json')
  .then(r => r.json())
  .then(list => {
    schedules = list;
    scheduleSel.innerHTML = schedules.map(s=>`<option>${s}</option>`).join('');
    timeline.max = schedules.length - 1;
    return Promise.all(
      schedules.map(key =>
        fetch(`sanitized_output/rtd_${key}_Weekday.geojson`)
          .then(r=>r.json())
          .then(gj=>gj.features)
      )
    );
  })
  .then(arrays => {
    allFeatures = arrays;
    populatePresetDropdown(presetSelect);
    updateFrame(0);
  })
  .catch(console.error);

// Frame / play logic...
function updateFrame(i){
  i = Math.max(0, Math.min(schedules.length-1, i));
  timeline.value = i;
  scheduleSel.value = schedules[i];
  renderFrame(i);
}
playBtn.onclick = () => {
  if(!playing){
    playing = true; playBtn.textContent='❚❚ Pause';
    playInterval = setInterval(()=>updateFrame(+timeline.value+1),1000);
  } else {
    playing = false; playBtn.textContent='▶ Play'; clearInterval(playInterval);
  }
};
timeline.oninput = () => updateFrame(+timeline.value);
scheduleSel.onchange = () => updateFrame(schedules.indexOf(scheduleSel.value));

function computePoints(feats, isDelta, positive){
  const scale = scaleSel.value;
  return feats.reduce((pts,f)=>{
    const v = isDelta?f.properties.delta:f.properties.total_rides;
    if(isDelta){
      if(positive&&v<=0) return pts;
      if(!positive&&v>=0) return pts;
    }
    let w=Math.abs(v);
    if(scale==='sqrt') w=Math.sqrt(w);
    if(scale==='log')  w=Math.log10(w+1);
    pts.push([f.geometry.coordinates[1],f.geometry.coordinates[0],w]);
    return pts;
  },[]);
}

function renderFrame(idx){
  [heatLayer,posLayer,negLayer].forEach(l=>l&&map.removeLayer(l));
  if(noDataControl){ map.removeControl(noDataControl); noDataControl=null; }
  const feats = allFeatures[idx];
  if(!feats||feats.length===0){
    noDataControl=L.control({position:'topright'});
    noDataControl.onAdd=()=>{ const d=L.DomUtil.create('div','no-data'); d.textContent=`No data for ${schedules[idx]}`; return d; };
    noDataControl.addTo(map);
    return;
  }
  const rad=+radiusNum.value, blu=+blurNum.value, mx=+maxNum.value;
  if(mapTypeSel.value==='boardings'){
    heatLayer=L.heatLayer(computePoints(feats,false),{radius:rad,blur:blu,max:mx}).addTo(map);
    legend.innerHTML='<span style="background:red"></span> Boardings';
  } else {
    if(scaleSel.value!=='normal') scaleSel.value='normal';
    posLayer=L.heatLayer(computePoints(feats,true,true),{radius:rad,blur:blu,max:mx,gradient:{0.4:'pink',1:'red'}}).addTo(map);
    negLayer=L.heatLayer(computePoints(feats,true,false),{radius:rad,blur:blu,max:mx,gradient:{0.4:'lightblue',1:'blue'}}).addTo(map);
    legend.innerHTML='<span style="background:red"></span> Increase  <span style="background:blue"></span> Decrease';
  }
}

function bind(rng,num){
  rng.oninput=()=>{ num.value=rng.value; renderFrame(+timeline.value); };
  num.onchange=()=>{ rng.value=num.value; renderFrame(+timeline.value); };
}
bind(radiusRng,radiusNum); bind(blurRng,blurNum); bind(maxRng,maxNum);
mapTypeSel.onchange=()=>renderFrame(+timeline.value);
scaleSel.onchange=()=>renderFrame(+timeline.value);

defaultBtn.onclick=()=>{
  radiusRng.value=radiusNum.value=10;
  blurRng.value=blurNum.value=8;
  maxRng.value=maxNum.value=0.5;
  scaleSel.value=mapTypeSel.value==='boardings'?'sqrt':'normal';
  presetSelect.selectedIndex=0;
  renderFrame(+timeline.value);
};

presetSelect.onchange=()=>{
  const key=presetSelect.value, idx=+timeline.value, feats=allFeatures[idx];
  const {rad,blu,maxVal,scale} = applyPresetSettings(key,feats);
  radiusRng.value=radiusNum.value=rad;
  blurRng.value=blurNum.value=blu;
  maxRng.value=maxNum.value=maxVal;
  scaleSel.value=scale;
  renderFrame(idx);
};
