export const presetList = [
  { key:'b90', name:'Boardings Top 10%', pct:0.90, rad:20, blu:15, mode:'boardings', transform: f=>Math.sqrt(f.total_rides), scale:'sqrt' },
  { key:'b75', name:'Boardings Top 25%', pct:0.75, rad:18, blu:12, mode:'boardings', transform: f=>Math.sqrt(f.total_rides), scale:'sqrt' },
  { key:'b50', name:'Boardings Median',     pct:0.50, rad:15, blu:10, mode:'boardings', transform: f=>Math.sqrt(f.total_rides), scale:'sqrt' },
  { key:'b25', name:'Boardings Bottom 25%', pct:0.25, rad:12, blu:8,  mode:'boardings', transform: f=>Math.sqrt(f.total_rides), scale:'sqrt' },
  { key:'b10', name:'Boardings Extreme Hubs',pct:0.99, rad:25, blu:20, mode:'boardings', transform: f=>Math.log10(f.total_rides+1), scale:'log' },
  { key:'c90', name:'Change Top 10%',       pct:0.90, rad:15, blu:12, mode:'change',    transform: f=>Math.abs(f.delta), scale:'normal' },
  { key:'c75', name:'Change Top 25%',       pct:0.75, rad:12, blu:10, mode:'change',    transform: f=>Math.abs(f.delta), scale:'normal' },
  { key:'c50', name:'Change Median',        pct:0.50, rad:10, blu:8,  mode:'change',    transform: f=>Math.abs(f.delta), scale:'normal' },
  { key:'c25', name:'Change Bottom 25%',    pct:0.25, rad:8,  blu:6,  mode:'change',    transform: f=>Math.abs(f.delta), scale:'normal' },
  { key:'c10', name:'Change Stable',        pct:0.10, rad:6,  blu:4,  mode:'change',    transform: f=>Math.abs(f.delta), scale:'normal' }
];

export function populatePresetDropdown(selectEl) {
  presetList.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.key; opt.textContent = p.name;
    selectEl.appendChild(opt);
  });
}

export function applyPresetSettings(key, features) {
  const p = presetList.find(x => x.key === key);
  if (!p) return {};
  const values = features.map(f => p.transform(f.properties)).sort((a,b)=>a-b);
  const maxVal = values[Math.floor(values.length * p.pct)] || 0.1;
  return { rad: p.rad, blu: p.blu, maxVal: +maxVal.toFixed(1), scale: p.scale };
}
