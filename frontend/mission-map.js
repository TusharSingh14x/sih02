// Route replay is deliberately separate from the shared engine simulation.
(function () {
  'use strict';
  const { DRDO_STATIONS, COMM_STATIONS, TRAJECTORY, ATTACK_TYPES } = window.MISSION_MAP_DATA;
  const $ = (id) => document.getElementById(id);
  const svg = $('map-svg');
  const NS = 'http://www.w3.org/2000/svg';
  const DURATION = 120;
  let projection, aircraft, flownPath, profileDot, profileGuide;
  let progress = 0, playing = !window.matchMedia('(prefers-reduced-motion: reduce)').matches, speed = 1, previousFrame = null;
  let lastUiFrame = 0;
  const layerGroups = {};
  const radians = (n) => n * Math.PI / 180;
  function distance(a, b) {
    const dlat = radians(b.lat - a.lat), dlng = radians(b.lng - a.lng);
    const h = Math.sin(dlat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dlng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  const cumulative = [0];
  for (let i = 1; i < TRAJECTORY.length; i++) cumulative.push(cumulative[i - 1] + distance(TRAJECTORY[i - 1], TRAJECTORY[i]));
  const totalKm = cumulative[cumulative.length - 1];
  function node(tag, attrs = {}, parent = svg) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => e.setAttribute(key, value));
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(id, value) { if ($(id)) $(id).textContent = value; }
  function project(lng, lat) {
    const b = projection.projection_bounds;
    return [(lng - b.lng_min) / (b.lng_max - b.lng_min) * b.view_w, (1 - (lat - b.lat_min) / (b.lat_max - b.lat_min)) * b.view_h];
  }
  function phase(i) { return ['Climb', 'Cruise', 'Cruise', 'Cruise', 'Descent', 'Descent', 'Approach'][i] || 'Recovery'; }
  function shortName(wp) { return wp.label.replace(/^WP-\d+\s*·\s*/, '').replace(/\s*\(.*\)$/, ''); }
  function interpolate(t) {
    const target = t * totalKm;
    let segIndex = 0;
    while (segIndex < TRAJECTORY.length - 2 && target >= cumulative[segIndex + 1]) segIndex++;
    const segFrac = Math.max(0, Math.min(1, (target - cumulative[segIndex]) / (cumulative[segIndex + 1] - cumulative[segIndex])));
    const a = TRAJECTORY[segIndex], b = TRAJECTORY[segIndex + 1];
    const heading = (Math.atan2(Math.sin(radians(b.lng - a.lng)) * Math.cos(radians(b.lat)), Math.cos(radians(a.lat)) * Math.sin(radians(b.lat)) - Math.sin(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.cos(radians(b.lng - a.lng))) * 180 / Math.PI + 360) % 360;
    return { t, segIndex, segFrac, lat: a.lat + (b.lat - a.lat) * segFrac, lng: a.lng + (b.lng - a.lng) * segFrac, alt_ft: a.alt_ft + (b.alt_ft - a.alt_ft) * segFrac, heading, playing, speed, elapsedSeconds: t * DURATION, distanceKm: target, totalKm };
  }
  window.missionMapClock = interpolate(0);
  function setPlaying(value) { playing = value; previousFrame = null; text('btn-replay-toggle', playing ? 'Pause' : progress >= 1 ? 'Replay' : 'Play'); $('btn-replay-toggle').setAttribute('aria-label', playing ? 'Pause route replay' : 'Play route replay'); updatePosition(); }
  function seek(t) { progress = Math.max(0, Math.min(1, Number(t) || 0)); previousFrame = null; if (progress >= 1) playing = false; updatePosition(); }
  window.missionReplay = { play() { if (progress >= 1) progress = 0; setPlaying(true); }, pause() { setPlaying(false); }, seek, setSpeed(value) { if ([.5, 1, 2, 4].includes(Number(value))) { speed = Number(value); $('replay-speed').value = String(speed); previousFrame = null; updatePosition(); } } };
  function showDetail(title, lines) {
    const card = $('detail-card'); card.replaceChildren();
    const heading = document.createElement('p'); heading.className = 'dc-title'; heading.textContent = title; card.appendChild(heading);
    lines.forEach((line) => { const p = document.createElement('p'); p.textContent = line; card.appendChild(p); });
  }
  function selectWaypoint(i) {
    const wp = TRAJECTORY[i];
    showDetail(wp.label, [wp.narrative, `Planned altitude: ${wp.alt_ft.toLocaleString()} ft · Route distance: ${Math.round(cumulative[i]).toLocaleString()} km`, `${wp.lat.toFixed(3)}° N, ${wp.lng.toFixed(3)}° E · Fictional waypoint`]);
    seek(cumulative[i] / totalKm); setPlaying(false);
  }
  function accessibleMarker(group, label, action) {
    group.setAttribute('class', 'map-marker'); group.setAttribute('role', 'button'); group.setAttribute('tabindex', '0'); group.setAttribute('aria-label', label);
    group.addEventListener('click', action);
    group.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } });
  }
  function renderMap() {
    node('rect', { x: 0, y: 0, width: 1000, height: 1000, fill: '#e5ebe4' });
    const grid = node('g', { stroke: '#cbd7cc', 'stroke-width': '.7' });
    for (let lat = 10; lat <= 35; lat += 5) { const [,y] = project(70, lat); node('line', { x1: 0, y1: y, x2: 1000, y2: y }, grid); }
    for (let lng = 70; lng <= 95; lng += 5) { const [x] = project(lng, 20); node('line', { x1: x, y1: 0, x2: x, y2: 1000 }, grid); }
    node('path', { d: projection.path, fill: '#f4f3e9', stroke: '#a6b4a4', 'stroke-width': '1.3' });
    const points = TRAJECTORY.map(wp => project(wp.lng, wp.lat));
    const routeD = 'M' + points.map(p => p.join(',')).join(' L');
    node('path', { d: routeD, fill: 'none', stroke: '#fffdf7', 'stroke-width': '6', 'stroke-linejoin': 'round' });
    node('path', { d: routeD, fill: 'none', stroke: '#9aa99b', 'stroke-width': '2', 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' });
    flownPath = node('path', { fill: 'none', stroke: '#496e55', 'stroke-width': '3', 'stroke-linejoin': 'round' });
    function stations(list, color, key) {
      const group = node('g', { id: `map-${key}` }); layerGroups[key] = group;
      list.forEach((s) => {
        const [x,y] = project(s.lng, s.lat); const g = node('g', {}, group);
        node('circle', { cx:x, cy:y, r:8, fill:'transparent' }, g);
        node('rect', { x:x-3, y:y-3, width:6, height:6, rx:1, fill:color, stroke:'#fff', 'stroke-width':1, class:'marker-dot' }, g);
        const label = node('text', { x:x+6, y:y-6, class:'map-label' }, g); label.textContent = s.city || s.name.replace('Ground Control Station ', 'GCS ');
        accessibleMarker(g, s.name, () => showDetail(s.name, s.type ? [`${s.city} · ${s.type.replace('_', ' ')}`, 'Public, approximate city location.'] : [s.note, 'Fictional ground station; no connection status is inferred.']));
      });
    }
    stations(COMM_STATIONS, '#547b6e', 'stations'); stations(DRDO_STATIONS, '#b38a45', 'labs');
    TRAJECTORY.forEach((wp, i) => {
      const [x,y] = points[i]; const g = node('g');
      node('circle', { cx:x, cy:y, r:9, fill:'transparent' }, g);
      node('circle', { cx:x, cy:y, r:4.5, fill:wp.isThreatZone ? '#b98242' : '#fcfbf7', stroke:wp.isThreatZone ? '#b98242' : '#58715e', 'stroke-width':1.5, class:'marker-dot' }, g);
      if (i < TRAJECTORY.length - 1) { const label = node('text', { x:x+8, y:y+12, class:'map-label' }, g); label.textContent = i === 0 ? 'Launch / recovery' : `WP ${i} · ${shortName(wp)}`; }
      accessibleMarker(g, `${wp.label}; inspect and move replay to waypoint`, () => selectWaypoint(i));
    });
    aircraft = node('g', { 'aria-hidden':'true' });
    node('circle', { r:10, fill:'#d2dfd0', opacity:'.8' }, aircraft);
    node('path', { d:'M0,-8 L5,6 L0,3 L-5,6 Z', fill:'#2c523a', stroke:'#fff', 'stroke-width':1.2 }, aircraft);
    setExtent(true); applyLayers(); $('map-load-status').hidden = true;
  }
  function setExtent(route) {
    if (!projection) return;
    if (route) {
      const pts = [...TRAJECTORY, ...COMM_STATIONS].map(p => project(p.lng, p.lat));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const minX = Math.min(...xs) - 55, minY = Math.min(...ys) - 60, w = Math.max(...xs) - minX + 70, h = Math.max(...ys) - minY + 70;
      svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
    } else svg.setAttribute('viewBox', '-30 -25 1060 1050');
    ['route','india'].forEach(key => { const selected = route === (key === 'route'); $(`btn-fit-${key}`).classList.toggle('active', selected); $(`btn-fit-${key}`).setAttribute('aria-pressed', selected); });
  }
  function applyLayers() {
    ['stations', 'labs'].forEach(key => { if (layerGroups[key]) layerGroups[key].style.display = $(`layer-${key}`).checked ? '' : 'none'; });
    svg.querySelectorAll('.map-label').forEach(label => { label.style.display = $('layer-labels').checked ? '' : 'none'; });
  }
  function renderItinerary() {
    const list = $('waypoint-list');
    TRAJECTORY.forEach((wp, i) => {
      const li = document.createElement('li'); const btn = document.createElement('button'); btn.type = 'button'; btn.dataset.waypoint = i;
      const number = document.createElement('span'); number.className = 'wp-number'; number.textContent = String(i).padStart(2,'0');
      const name = document.createElement('span'); name.className = 'wp-name'; name.textContent = shortName(wp);
      const meta = document.createElement('small'); meta.textContent = `${Math.round(cumulative[i]).toLocaleString()} km from launch`; name.appendChild(meta);
      const alt = document.createElement('span'); alt.className = 'wp-alt'; alt.textContent = `${wp.alt_ft.toLocaleString()} ft`;
      btn.append(number, name, alt); btn.addEventListener('click', () => selectWaypoint(i)); li.appendChild(btn); list.appendChild(li);
    });
  }
  const profileX = t => 46 + t * 760;
  const profileY = alt => 128 - alt / 16000 * 110;
  function renderProfile() {
    const profile = $('altitude-profile');
    [0,7000,14000].forEach(alt => {
      const y = profileY(alt); node('line', { x1:46, y1:y, x2:806, y2:y, stroke:'#dfe2d8', 'stroke-width':1 }, profile);
      const label = node('text', { x:0, y:y+3, fill:'#707b70', 'font-size':9 }, profile); label.textContent = alt ? `${alt/1000}k ft` : '0 ft';
    });
    const pts = TRAJECTORY.map((p,i) => [profileX(cumulative[i]/totalKm), profileY(p.alt_ft)]);
    node('path', { d:`M46,128 L${pts.map(p=>p.join(',')).join(' L')} L806,128 Z`, fill:'#e7ecdf' }, profile);
    node('path', { d:'M'+pts.map(p=>p.join(',')).join(' L'), fill:'none', stroke:'#58715e', 'stroke-width':2 }, profile);
    pts.forEach(([x,y],i) => { node('circle', {cx:x,cy:y,r:3,fill:'#fcfbf7',stroke:'#58715e'},profile); const t=node('text',{x,y:149,'text-anchor':'middle','font-size':9,fill:'#707b70'},profile);t.textContent=Math.round(cumulative[i]).toLocaleString(); });
    profileGuide = node('line', { y1:15,y2:128,stroke:'#496e55','stroke-width':1,'stroke-dasharray':'3 3' },profile);
    profileDot = node('circle',{r:4,fill:'#365640',stroke:'#fff','stroke-width':2},profile);
  }
  function timeString(seconds) { const whole = Math.floor(seconds); return `${String(Math.floor(whole/60)).padStart(2,'0')}:${String(whole%60).padStart(2,'0')}`; }
  function updatePosition() {
    const pos = interpolate(progress); window.missionMapClock = pos;
    if (projection && aircraft) {
      const [x,y] = project(pos.lng,pos.lat); aircraft.setAttribute('transform',`translate(${x} ${y}) rotate(${pos.heading})`);
      const pts = TRAJECTORY.slice(0,pos.segIndex+1).map(p=>project(p.lng,p.lat)); pts.push([x,y]); flownPath.setAttribute('d','M'+pts.map(p=>p.join(',')).join(' L'));
    }
    if (profileDot) { const x=profileX(progress), y=profileY(pos.alt_ft); profileDot.setAttribute('cx',x); profileDot.setAttribute('cy',y); profileGuide.setAttribute('x1',x); profileGuide.setAttribute('x2',x); }
    const altitude = `${Math.round(pos.alt_ft).toLocaleString()} ft`;
    text('route-total', `${Math.round(totalKm).toLocaleString()} km`); text('route-altitude', altitude); text('altitude-current', altitude);
    text('route-phase', progress >= 1 ? 'Recovery · Replay complete' : `${phase(pos.segIndex)} · Planned profile`);
    text('route-covered',`${Math.round(pos.distanceKm).toLocaleString()} km`); text('route-remaining',`${Math.round(totalKm-pos.distanceKm).toLocaleString()} km remaining · ${Math.round(progress*100)}%`);
    text('route-leg', progress >= 1 ? 'Recovered' : `WP ${pos.segIndex} → ${pos.segIndex+1}`); text('route-next',progress >= 1 ? 'Select Replay to fly again' : shortName(TRAJECTORY[pos.segIndex+1]));
    text('mission-clock',`${timeString(progress*DURATION)} / ${timeString(DURATION)}`); $('route-scrubber').value=String(Math.round(progress*1000));
    $('route-scrubber').setAttribute('aria-valuetext',`${Math.round(progress*100)} percent, ${altitude}`);
    text('btn-replay-toggle',playing ? 'Pause' : progress>=1 ? 'Replay' : 'Play'); $('btn-replay-toggle').setAttribute('aria-label',playing ? 'Pause route replay' : 'Play route replay');
    const activeIndex=progress>=1 ? TRAJECTORY.length-1 : pos.segIndex;
    $('waypoint-list').querySelectorAll('button').forEach((btn,i)=>{ if(i===activeIndex)btn.setAttribute('aria-current','step');else btn.removeAttribute('aria-current'); });
  }
  function tick(now) {
    if (previousFrame !== null && playing) { progress=Math.min(1,progress+(now-previousFrame)/1000/DURATION*speed); if(progress>=1)playing=false; }
    previousFrame=now;
    window.missionMapClock=interpolate(progress);
    if(now-lastUiFrame>80) { updatePosition();lastUiFrame=now; }
    requestAnimationFrame(tick);
  }
  $('btn-replay-toggle').addEventListener('click',()=>playing ? window.missionReplay.pause() : window.missionReplay.play());
  $('btn-replay-reset').addEventListener('click',()=>{seek(0);setPlaying(false);});
  $('route-scrubber').addEventListener('input',e=>seek(Number(e.target.value)/1000));
  $('replay-speed').addEventListener('change',e=>window.missionReplay.setSpeed(e.target.value));
  $('btn-fit-route').addEventListener('click',()=>setExtent(true)); $('btn-fit-india').addEventListener('click',()=>setExtent(false));
  ['stations','labs','labels'].forEach(key=>$(`layer-${key}`).addEventListener('change',applyLayers));
  document.addEventListener('visibilitychange',()=>{previousFrame=null;});

  // Show only confirmed simulator state; control mode never implies fault clearance.
  let activeFault = null, knownFault = false, pending = false, lastTelemetryAt = 0, connected = false, latest = null;
  let feedState = 'connecting';
  const attackByFault = type => ATTACK_TYPES.find(a=>a.faultType===type);
  const faultLabels = { nominal:'No fault detected', vibration_over:'Elevated vibration', vibration_spike:'Vibration spike', oil_starvation:'Low oil pressure', oil_leak:'Oil pressure loss', cht_overheat:'Cylinder overheating', egt_surge:'Exhaust temperature surge', thermal_shock:'Thermal stress', sensor_dropout:'Sensor signal loss', sensor_drift:'Sensor drift', sensor_integrity:'Sensor integrity', unknown:'Assessment unavailable' };
  const readable = value => faultLabels[value] || String(value || '—').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
  const percent = value => typeof value==='number' && Number.isFinite(value) ? `${Math.round(Math.max(0,Math.min(1,value))*100)}%` : '—';
  function setFeedback(message,error=false) { text('scenario-feedback',message);$('scenario-feedback').classList.toggle('error',error); }
  function renderScenario() {
    const fresh = connected && lastTelemetryAt && Date.now()-lastTelemetryAt<8000;
    $('attack-type-list').querySelectorAll('button').forEach(btn=>{btn.disabled=pending||!fresh; const active=knownFault&&btn.dataset.faultType===activeFault;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active);});
    $('btn-clear-attack').disabled=pending||!fresh||!knownFault||!activeFault;
    $('threat-banner').hidden=!knownFault||!activeFault;
    if(activeFault)text('threat-banner-text',`${fresh ? 'Injected fault active' : 'Last known injected fault'}: ${attackByFault(activeFault)?.label||readable(activeFault)}. Clear it explicitly to end the scenario.`);
  }
  function renderNarrative(data) {
    const mode=data.drl_action?.action_mode;
    let narration=activeFault ? `${attackByFault(activeFault)?.label||readable(activeFault)} remains injected. ` : 'No fault is currently injected. Baseline readings can still indicate wear. ';
    if(mode==='AUTONOMOUS_ACTION') narration+='The controller permits autonomous adjustment; this does not confirm that a fault has cleared.';
    else if(mode) narration+='The controller is holding or limiting action. Review the diagnosis in the drone console.';
    else narration+='Control mode is unavailable in this reading.';
    text('resp-narrative',narration);
  }
  function setFeedState(state) {
    feedState=state;
    const live=state==='live';$('resp-ws-status').classList.toggle('live',live);$('lm-ws-dot').classList.toggle('live',live);
    text('resp-ws-status',live?'Live':state==='stale'?'Stale':state==='offline'?'Reconnecting':'Connecting');
    text('lm-ws-label',live?'Receiving telemetry':state==='stale'?'No recent telemetry':state==='offline'?'Connection interrupted':'Waiting for telemetry');
    if(!live) { text('resp-narrative',latest?'Readings below are the last received values. Fault controls are unavailable until telemetry resumes.':'Waiting for a current engine reading.'); if(!pending)setFeedback('Fault controls become available when fresh telemetry is received.'); }
    renderScenario();
  }
  ATTACK_TYPES.forEach(atk=>{
    const btn=document.createElement('button');btn.type='button';btn.className='btn';btn.dataset.faultType=atk.faultType;btn.textContent=atk.label;btn.title=atk.description;btn.disabled=true;btn.setAttribute('aria-pressed','false');btn.addEventListener('click',()=>changeScenario(atk.faultType));$('attack-type-list').appendChild(btn);
  });
  async function changeScenario(faultType) {
    if(pending)return;
    pending=true;renderScenario();setFeedback(faultType?'Applying scenario…':'Clearing injected fault…');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('/api/simulate/inject',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({fault_type:faultType}),signal:controller.signal});
      if(response.status===401)throw new Error('Sign-in expired. Open the drone console to sign in again.');
      const result=await response.json().catch(()=>null);
      if(!response.ok||result?.success!==true||!Object.prototype.hasOwnProperty.call(result,'active_fault'))throw new Error(typeof result?.detail==='string'?result.detail:`The simulator did not confirm this request (HTTP ${response.status}).`);
      activeFault=result.active_fault;knownFault=true;
      setFeedback(activeFault?`Confirmed: ${attackByFault(activeFault)?.label||readable(activeFault)} is active.`:'Confirmed: injected fault cleared. Baseline wear may still be present.');
      if(latest)renderNarrative(latest);
    } catch(error) { setFeedback(error.name==='AbortError'?'Request timed out. Check the active fault indicator before trying again.':error.message,true); }
    finally { clearTimeout(timeout);pending=false;renderScenario(); }
  }
  $('btn-clear-attack').addEventListener('click',()=>changeScenario(null));
  function connectFeed() {
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(`${protocol}//${location.host}/ws/telemetry`);
    ws.onopen=()=>{connected=true;lastTelemetryAt=0;setFeedState('connecting');};
    ws.onclose=()=>{connected=false;setFeedState('offline');setTimeout(connectFeed,2000);};
    ws.onerror=()=>ws.close();
    ws.onmessage=event=>{
      let data;try{data=JSON.parse(event.data);}catch{return;}
      if(!data||typeof data!=='object'||(!('fault_archetype'in data)&&!('cycle'in data)))return;
      const wasLive=feedState==='live';latest=data;lastTelemetryAt=Date.now();setFeedState('live');
      if(!pending&&Object.prototype.hasOwnProperty.call(data,'active_injected_fault')) { const changed=!knownFault||activeFault!==data.active_injected_fault;activeFault=data.active_injected_fault;knownFault=true;if(changed)setFeedback(activeFault?`Current scenario: ${attackByFault(activeFault)?.label||readable(activeFault)}.`:'No injected fault. Select a scenario to test the response.'); }
      if(!wasLive&&!pending&&!$('scenario-feedback').classList.contains('error'))setFeedback(activeFault?'Telemetry restored. The injected fault remains active.':'Connected. Select a scenario to test the response.');
      text('resp-fault',readable(data.fault_archetype));
      const source=data.fault_assessment_source;
      text('resp-confidence',typeof data.fault_confidence==='number'?`${percent(data.fault_confidence)}${source?' · '+String(source).replace(/_/g,' '):''}`:source?String(source).replace(/_/g,' '):'Model assessment');
      text('resp-action-mode',data.drl_action?.action_mode?String(data.drl_action.action_mode).replace(/_/g,' ').toLowerCase().replace(/^./,c=>c.toUpperCase()):'—');
      text('resp-agreement',percent(data.fault_agreement_score));text('resp-trend',percent(data.trend_risk_score));text('lm-cycle',Number.isFinite(data.cycle)?`Cycle ${data.cycle.toLocaleString()}`:'Cycle —');
      renderScenario();renderNarrative(data);
    };
  }
  setInterval(()=>{if(connected&&lastTelemetryAt&&Date.now()-lastTelemetryAt>8000&&feedState!=='stale')setFeedState('stale');},2000);
  renderItinerary();renderProfile();updatePosition();requestAnimationFrame(tick);connectFeed();
  fetch('/static/assets/india_outline.json').then(response=>{if(!response.ok)throw new Error('Map unavailable');return response.json();}).then(data=>{projection=data;renderMap();updatePosition();}).catch(()=>{text('map-load-status','Map outline unavailable. Route metrics, playback and altitude profile are still available.');});
})();
