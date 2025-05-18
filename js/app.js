const map=L.map('map').setView([39.75,-105],10);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);

// DOM
const playBtn=document.getElementById('playBtn');
const timeline=document.getElementById('timeline');
const scheduleSel=document.getElementById('scheduleSelect');
const compareSel=document.getElementById('compareSelect');
const compareWrapper=document.getElementById('compareWrapper');
const mapTypeSel=document.getElementById('mapType');
const valueSel=document.getElementById('valueType');
const radiusR=document.getElementById('radius'),radiusN=document.getElementById('radiusNum');
const blurR=document.getElementById('blur'),blurN=document.getElementById('blurNum');
const maxR=document.getElementById('max'),maxN=document.getElementById('maxNum');
const scaleSel=document.getElementById('scaleType');
const legend=document.getElementById('legend');
const advBtn=document.getElementById('toggleAdvanced');
const advPanel=document.getElementById('advancedControls');

let schedules=[],allFeatures=[],heatLayer,posLayer,negLayer,playing=false,playInt,current=0;

// Advanced toggle
let advOpen=true;
advBtn.onclick=()=>{advOpen=!advOpen;advPanel.style.display=advOpen?'flex':'none';advBtn.textContent=advOpen?'Advanced ▾':'Advanced ▸';};

// Bind twins
[[radiusR,radiusN],[blurR,blurN],[maxR,maxN]].forEach(([r,n])=>{
  r.oninput=()=>{n.value=r.value;render(current)};
  n.onchange=()=>{r.value=n.value;render(current)};
});

// Load schedules list
fetch('sanitized_output/index.json').then(r=>r.json()).then(list=>{
  schedules=list;
  scheduleSel.innerHTML=compareSel.innerHTML=schedules.map(s=>`<option>${s}</option>`).join('');
  timeline.max=schedules.length-1;
  return Promise.all(schedules.map(key=>fetch(`sanitized_output/rtd_${key}_Weekday.geojson`).then(r=>r.json()).then(g=>g.features)));
}).then(data=>{
  allFeatures=data;
  render(0);
});

// Playback
playBtn.onclick=()=>{
  if(!playing){
    playInt=setInterval(()=>render((current+1)%schedules.length),1000);
    playBtn.textContent='❚❚ Pause';
  }else{
    clearInterval(playInt);
    playBtn.textContent='▶ Play';
  }
  playing=!playing;
};
timeline.oninput=()=>render(+timeline.value);
scheduleSel.onchange=()=>render(schedules.indexOf(scheduleSel.value));
mapTypeSel.onchange=()=>{compareWrapper.style.display=mapTypeSel.value==='change'?'inline-flex':'none';render(current);};
valueSel.onchange=()=>render(current);
scaleSel.onchange=()=>render(current);

function scale(v){
  const s=scaleSel.value;
  if(s==='sqrt')return Math.sqrt(v);
  if(s==='log')return Math.log10(v+1);
  return v;
}
function pts(features,field,pos=null){
  return features.reduce((a,f)=>{
    let v=f.properties[field]||0;
    if(pos!==null){
      if(pos&&v<=0)return a;
      if(!pos&&v>=0)return a;
      v=Math.abs(v);
    }
    a.push([f.geometry.coordinates[1],f.geometry.coordinates[0],scale(v)]);
    return a;
  },[]);
}
function render(idx){
  current=idx;
  scheduleSel.value=schedules[idx];
  timeline.value=idx;
  [heatLayer,posLayer,negLayer].forEach(l=>l&&map.removeLayer(l));

  const rad=+radiusN.value,blu=+blurN.value,mx=+maxN.value;
  const mode=mapTypeSel.value,val=valueSel.value;
  const feats=allFeatures[idx];

  if(mode==='change'){
    const back=allFeatures[compareSel.selectedIndex];
    const deltas=feats.map(f=>{
      const prev=back.find(p=>p.properties.stop_id===f.properties.stop_id);
      const delta=(f.properties.boardings||0)-(prev?.properties.boardings||0);
      return{geometry:f.geometry,properties:{...f.properties,delta}};
    });
    posLayer=L.heatLayer(pts(deltas,'delta',true),{radius:rad,blur:blu,max:mx,gradient:{0.4:'pink',1:'red'}}).addTo(map);
    negLayer=L.heatLayer(pts(deltas,'delta',false),{radius:rad,blur:blu,max:mx,gradient:{0.4:'lightblue',1:'blue'}}).addTo(map);
    legend.innerHTML='<span style="background:red"></span> Increase <span style="background:blue"></span> Decrease';
    return;
  }

  const field=val;
  heatLayer=L.heatLayer(pts(feats,field),{radius:rad,blur:blu,max:mx}).addTo(map);
  legend.innerHTML=`<span style="background:red"></span> ${field}`;
}
