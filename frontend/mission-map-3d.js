// A shared-clock flight profile. Every leg uses the same linear interpolation
// as the map; altitude is deliberately exaggerated, not a terrain model.
(function () {
  'use strict';

  const container = document.getElementById('flight-profile-3d');
  const data = window.MISSION_MAP_DATA;
  if (!container || !data || !Array.isArray(data.TRAJECTORY) || data.TRAJECTORY.length < 2) return;
  const route = data.TRAJECTORY;
  const status = document.getElementById('flight-render-status');
  const profileButton = document.getElementById('btn-view-profile');
  const planButton = document.getElementById('btn-view-globe');
  const resetButton = document.getElementById('btn-reset-camera');
  const maxAltitude = Math.max(1000, ...route.map(p => p.alt_ft));
  let frame = 0;
  let renderer = null;
  let disposed = false;

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function clockPosition() {
    const clock = window.missionMapClock;
    if (clock && Number.isFinite(clock.lat) && Number.isFinite(clock.lng) && Number.isFinite(clock.alt_ft)) return clock;
    return { ...route[0], t: 0, segIndex: 0, segFrac: 0 };
  }

  // A readable altitude chart remains available when the CDN, GPU or WebGL
  // context is unavailable. This never prevents the map/replay from running.
  function renderFallback() {
    cancelAnimationFrame(frame);
    disposed = true;
    container.replaceChildren();
    setStatus('3D unavailable · showing altitude profile');
    [profileButton, planButton, resetButton].forEach(button => {
      if (button) button.disabled = true;
    });
    const ns = 'http://www.w3.org/2000/svg';
    function svgEl(name, attrs, content) {
      const element = document.createElementNS(ns, name);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      if (content) element.textContent = content;
      return element;
    }
    const svg = svgEl('svg', { viewBox: '0 0 960 350', width: '100%', height: '100%', role: 'img', 'aria-label': 'Flight altitude by route waypoint, synchronized with mission replay' });
    svg.style.background = '#f3f2ec';
    const x = i => 82 + i / (route.length - 1) * 810;
    const y = alt => 285 - alt / maxAltitude * 220;
    [0, maxAltitude / 2, maxAltitude].forEach(alt => {
      svg.appendChild(svgEl('line', { x1: 78, y1: y(alt), x2: 900, y2: y(alt), stroke: '#d5d8cc', 'stroke-width': 1 }));
      svg.appendChild(svgEl('text', { x: 65, y: y(alt) + 4, fill: '#687267', 'text-anchor': 'end', 'font-size': 12, 'font-family': 'sans-serif' }, `${Math.round(alt).toLocaleString()} ft`));
    });
    svg.appendChild(svgEl('polyline', { points: route.map((p, i) => `${x(i)},${y(p.alt_ft)}`).join(' '), fill: 'none', stroke: '#547a61', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    route.forEach((p, i) => {
      svg.appendChild(svgEl('circle', { cx: x(i), cy: y(p.alt_ft), r: 4, fill: p.isThreatZone ? '#ae6441' : '#547a61' }));
      svg.appendChild(svgEl('text', { x: x(i), y: 315, fill: '#687267', 'text-anchor': 'middle', 'font-size': 12, 'font-family': 'sans-serif' }, `WP ${i}`));
    });
    const marker = svgEl('circle', { cx: x(0), cy: y(0), r: 7, fill: '#243f2e', stroke: '#fcfbf7', 'stroke-width': 3 });
    svg.appendChild(marker);
    container.appendChild(svg);
    function updateFallback() {
      const clock = clockPosition();
      const segment = Math.max(0, Math.min(route.length - 2, Number(clock.segIndex) || 0));
      const fraction = Math.max(0, Math.min(1, Number(clock.segFrac) || 0));
      marker.setAttribute('cx', x(segment + fraction));
      marker.setAttribute('cy', y(clock.alt_ft));
      frame = requestAnimationFrame(updateFallback);
    }
    updateFallback();
  }

  if (typeof THREE === 'undefined') {
    renderFallback();
    return;
  }

  try {
    const colors = { paper: 0xf3f2ec, ground: 0xeaece2, grid: 0xd2d7c9, axis: 0x899584, planned: 0x8e9e8c, route: 0x436f52, caution: 0xb77545, text: '#52634f' };
    const centerLat = (Math.min(...route.map(p => p.lat)) + Math.max(...route.map(p => p.lat))) / 2;
    const centerLng = (Math.min(...route.map(p => p.lng)) + Math.max(...route.map(p => p.lng))) / 2;
    const longitudeScale = Math.cos(centerLat * Math.PI / 180);
    const geographicSpan = Math.max(
      (Math.max(...route.map(p => p.lng)) - Math.min(...route.map(p => p.lng))) * longitudeScale,
      Math.max(...route.map(p => p.lat)) - Math.min(...route.map(p => p.lat))
    );
    const horizontalScale = 10 / Math.max(geographicSpan, 0.1);
    const altitudeScale = 2.6 / maxAltitude;
    function project(lng, lat, altitude = 0) {
      return new THREE.Vector3((lng - centerLng) * longitudeScale * horizontalScale, altitude * altitudeScale, -(lat - centerLat) * horizontalScale);
    }
    const points = route.map(p => project(p.lng, p.lat, p.alt_ft));
    const bounds = new THREE.Box3().setFromPoints(points);
    const minX = bounds.min.x - 0.8, maxX = bounds.max.x + 0.8;
    const minZ = bounds.min.z - 0.8, maxZ = bounds.max.z + 0.8;
    const groundWidth = maxX - minX, groundDepth = maxZ - minZ;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.paper);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'pan-y';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Interactive 3D mission route. Drag to orbit; use arrow keys to rotate, plus or minus to zoom, and Home to reset.');
    container.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xadb69f, 0.95));
    const sunlight = new THREE.DirectionalLight(0xffffff, 0.55);
    sunlight.position.set(-3, 8, 4);
    scene.add(sunlight);

    const base = new THREE.Mesh(new THREE.PlaneGeometry(groundWidth, groundDepth), new THREE.MeshLambertMaterial({ color: colors.ground, side: THREE.DoubleSide }));
    base.rotation.x = -Math.PI / 2;
    base.position.set((minX + maxX) / 2, -0.025, (minZ + maxZ) / 2);
    scene.add(base);

    function line(list, color, opacity = 1, dashed = false) {
      const material = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.10, gapSize: 0.075 }) : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
      const result = new THREE.Line(new THREE.BufferGeometry().setFromPoints(list), material);
      if (dashed) result.computeLineDistances();
      return result;
    }
    function label(text, position, size = 0.21, color = colors.text) {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.width = 320;
      canvas.height = 64;
      context.font = '500 28px -apple-system, BlinkMacSystemFont, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = color;
      context.fillText(text, 160, 32);
      const texture = new THREE.CanvasTexture(canvas);
      texture.encoding = THREE.sRGBEncoding;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
      sprite.position.copy(position);
      sprite.scale.set(size * 5, size, 1);
      return sprite;
    }
    function dot(position, color, radius = 0.045) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshLambertMaterial({ color }));
      mesh.position.copy(position);
      return mesh;
    }
    function segment(start, end, color, radius) {
      const direction = end.clone().sub(start);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), new THREE.MeshLambertMaterial({ color }));
      mesh.position.copy(start).add(end).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      return mesh;
    }

    // Geographic grid, at full-degree intervals. The plane is a coordinate
    // reference only: no fabricated terrain or geographic boundary is drawn.
    for (let lng = Math.floor(Math.min(...route.map(p => p.lng))); lng <= Math.ceil(Math.max(...route.map(p => p.lng))); lng += 2) {
      const x = project(lng, centerLat).x;
      if (x < minX || x > maxX) continue;
      scene.add(line([new THREE.Vector3(x, 0, minZ), new THREE.Vector3(x, 0, maxZ)], colors.grid));
      scene.add(label(`${lng}° E`, new THREE.Vector3(x, 0.025, maxZ + 0.22), 0.17));
    }
    for (let lat = Math.floor(Math.min(...route.map(p => p.lat))); lat <= Math.ceil(Math.max(...route.map(p => p.lat))); lat += 2) {
      const z = project(centerLng, lat).z;
      if (z < minZ || z > maxZ) continue;
      scene.add(line([new THREE.Vector3(minX, 0, z), new THREE.Vector3(maxX, 0, z)], colors.grid));
      scene.add(label(`${lat}° N`, new THREE.Vector3(maxX + 0.35, 0.025, z), 0.17));
    }
    scene.add(line([new THREE.Vector3(minX + 0.3, 0.02, minZ + 1), new THREE.Vector3(minX + 0.3, 0.02, minZ + 0.35)], colors.axis));
    scene.add(label('N', new THREE.Vector3(minX + 0.3, 0.08, minZ + 0.12), 0.22));

    const profileGroup = new THREE.Group();
    const planGroup = new THREE.Group();
    scene.add(profileGroup, planGroup);
    const groundPoints = points.map(p => new THREE.Vector3(p.x, 0.025, p.z));
    scene.add(line(groundPoints, colors.planned, 0.75, true));
    const flownSegments = [], flownGroundSegments = [];
    for (let i = 0; i < points.length - 1; i++) {
      profileGroup.add(segment(points[i], points[i + 1], colors.planned, 0.020));
      planGroup.add(segment(groundPoints[i], groundPoints[i + 1], colors.planned, 0.020));
      const completed = segment(points[i], points[i + 1], colors.route, 0.032);
      const completedGround = segment(groundPoints[i], groundPoints[i + 1], colors.route, 0.032);
      profileGroup.add(completed);
      planGroup.add(completedGround);
      flownSegments.push(completed);
      flownGroundSegments.push(completedGround);
    }
    route.forEach((waypoint, i) => {
      // Launch/recovery share a location, so use one legible label there.
      if (i === route.length - 1 && points[i].distanceTo(points[0]) < 0.01) return;
      const color = waypoint.isThreatZone ? colors.caution : colors.route;
      const caption = i === 0 ? 'Launch / recovery' : `WP ${i}`;
      const top = points[i];
      const bottom = groundPoints[i];
      profileGroup.add(line([bottom, top], colors.axis, 0.5, true));
      profileGroup.add(dot(top, color, 0.052));
      profileGroup.add(label(caption, top.clone().add(new THREE.Vector3(0, i % 2 ? 0.23 : 0.37, 0)), 0.2));
      planGroup.add(dot(bottom, color, 0.055));
      planGroup.add(label(caption, bottom.clone().add(new THREE.Vector3(0, 0.14, -0.20)), 0.21));
    });
    const axisX = minX + 0.1, axisZ = maxZ - 0.2;
    profileGroup.add(line([new THREE.Vector3(axisX, 0, axisZ), new THREE.Vector3(axisX, 2.85, axisZ)], colors.axis));
    [0, maxAltitude / 2, maxAltitude].forEach(altitude => {
      const y = altitude * altitudeScale;
      profileGroup.add(line([new THREE.Vector3(axisX - 0.07, y, axisZ), new THREE.Vector3(axisX + 0.12, y, axisZ)], colors.axis));
      profileGroup.add(label(`${Math.round(altitude).toLocaleString()} ft`, new THREE.Vector3(axisX - 0.5, y + 0.07, axisZ), 0.18));
    });
    (data.COMM_STATIONS || []).forEach((station, i) => {
      const p = project(station.lng, station.lat, 0);
      if (p.x < minX || p.x > maxX || p.z < minZ || p.z > maxZ) return;
      scene.add(dot(p, colors.caution, 0.045));
      scene.add(label(`GCS ${i + 1}`, p.clone().add(new THREE.Vector3(0, 0.06, 0.22)), 0.16, '#8c633a'));
    });

    // A small aircraft silhouette points along the active leg, including its
    // climb/descent component, instead of spinning independently of replay.
    const aircraft = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.26);
    shape.lineTo(0.05, 0.035);
    shape.lineTo(0.25, -0.07);
    shape.lineTo(0.25, -0.12);
    shape.lineTo(0.05, -0.075);
    shape.lineTo(0.045, -0.18);
    shape.lineTo(0.10, -0.22);
    shape.lineTo(-0.10, -0.22);
    shape.lineTo(-0.045, -0.18);
    shape.lineTo(-0.05, -0.075);
    shape.lineTo(-0.25, -0.12);
    shape.lineTo(-0.25, -0.07);
    shape.lineTo(-0.05, 0.035);
    shape.closePath();
    const silhouette = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: 0x23442f, side: THREE.DoubleSide }));
    silhouette.rotation.x = Math.PI / 2;
    aircraft.add(silhouette);
    scene.add(aircraft);
    const groundMarker = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.115, 28), new THREE.MeshBasicMaterial({ color: colors.route, side: THREE.DoubleSide }));
    groundMarker.rotation.x = -Math.PI / 2;
    scene.add(groundMarker);
    const altitudeGuide = line([new THREE.Vector3(), new THREE.Vector3()], colors.caution, 0.8);
    profileGroup.add(altitudeGuide);

    let mode = 'profile';
    let yaw = 0.35, elevation = 0.62, distance = 12;
    let userAdjusted = false;
    const target = new THREE.Vector3(0, 1.0, 0);
    function moveCamera() {
      const horizontal = Math.cos(elevation) * distance;
      camera.position.set(target.x + Math.sin(yaw) * horizontal, target.y + Math.sin(elevation) * distance, target.z + Math.cos(yaw) * horizontal);
      camera.lookAt(target);
      camera.updateMatrixWorld();
    }
    function fitCamera() {
      target.set((minX + maxX) / 2, mode === 'profile' ? 1.1 : 0, (minZ + maxZ) / 2);
      distance = 12;
      moveCamera();
      const outward = camera.position.clone().sub(target).normalize();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const tanV = Math.tan(camera.fov * Math.PI / 360);
      const tanH = tanV * camera.aspect;
      let required = 0;
      [minX - 0.55, maxX + 0.65].forEach(x => [minZ - 0.3, maxZ + 0.45].forEach(z => [0, mode === 'profile' ? 3.15 : 0.2].forEach(y => {
        const delta = new THREE.Vector3(x, y, z).sub(target);
        const depth = delta.dot(outward);
        required = Math.max(required, Math.abs(delta.dot(right)) / tanH + depth, Math.abs(delta.dot(up)) / tanV + depth);
      })));
      distance = Math.max(5, required * 1.12);
      moveCamera();
    }
    function resetView() {
      yaw = mode === 'profile' ? 0.35 : 0;
      elevation = mode === 'profile' ? 0.62 : Math.PI / 2 - 0.001;
      userAdjusted = false;
      fitCamera();
    }
    function setView(nextMode) {
      mode = nextMode === 'plan' || nextMode === 'globe' ? 'plan' : 'profile';
      profileGroup.visible = mode === 'profile';
      planGroup.visible = mode === 'plan';
      if (profileButton) {
        profileButton.classList.toggle('btn-primary', mode === 'profile');
        profileButton.setAttribute('aria-pressed', String(mode === 'profile'));
      }
      if (planButton) {
        planButton.classList.toggle('btn-primary', mode === 'plan');
        planButton.setAttribute('aria-pressed', String(mode === 'plan'));
      }
      setStatus(mode === 'profile' ? '3D profile · altitude exaggerated' : 'Ground plan · north up');
      resetView();
    }
    if (profileButton) profileButton.addEventListener('click', () => setView('profile'));
    if (planButton) planButton.addEventListener('click', () => setView('plan'));
    if (resetButton) resetButton.addEventListener('click', resetView);

    let drag = null;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
      if (mode !== 'profile' || event.button !== 0 || event.pointerType === 'touch') return;
      drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      yaw -= (event.clientX - drag.x) * 0.007;
      elevation = Math.max(0.16, Math.min(1.48, elevation + (event.clientY - drag.y) * 0.006));
      drag.x = event.clientX;
      drag.y = event.clientY;
      userAdjusted = true;
      moveCamera();
    });
    function endDrag() { drag = null; canvas.style.cursor = mode === 'profile' ? 'grab' : 'default'; }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('wheel', event => {
      // Scroll the document normally until the user deliberately focuses the
      // plot. This keeps the long mission page usable on trackpads/mobile.
      if (document.activeElement !== canvas) return;
      event.preventDefault();
      distance = Math.max(4, Math.min(60, distance * Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0015)));
      userAdjusted = true;
      moveCamera();
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const key = event.key;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(key)) return;
      event.preventDefault();
      if (key === 'Home') { resetView(); return; }
      if (key === '+' || key === '=') distance = Math.max(4, distance * 0.9);
      else if (key === '-') distance = Math.min(60, distance * 1.1);
      else if (mode === 'profile') {
        if (key === 'ArrowLeft') yaw -= 0.12;
        if (key === 'ArrowRight') yaw += 0.12;
        if (key === 'ArrowUp') elevation = Math.min(1.48, elevation + 0.1);
        if (key === 'ArrowDown') elevation = Math.max(0.16, elevation - 0.1);
      }
      userAdjusted = true;
      moveCamera();
    });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      renderFallback();
    }, { once: true });

    function resize() {
      if (disposed) return;
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 280);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      if (!userAdjusted) fitCamera();
    }
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    else window.addEventListener('resize', resize);
    resize();
    setView('profile');

    function updateFlown(segments, sourcePoints, index, fraction) {
      segments.forEach((mesh, i) => {
        const amount = i < index ? 1 : i === index ? fraction : 0;
        mesh.visible = amount > 0.0001;
        mesh.scale.y = Math.max(amount, 0.0001);
        mesh.position.copy(sourcePoints[i]).lerp(sourcePoints[i + 1], amount / 2);
      });
    }
    function animate() {
      if (disposed) return;
      const clock = clockPosition();
      const index = Math.max(0, Math.min(points.length - 2, Math.floor(Number(clock.segIndex) || 0)));
      const fraction = Math.max(0, Math.min(1, Number(clock.segFrac) || 0));
      const position = project(clock.lng, clock.lat, clock.alt_ft);
      aircraft.position.copy(position);
      aircraft.position.y = (mode === 'profile' ? position.y : 0) + 0.085;
      const direction = points[index + 1].clone().sub(points[index]);
      if (mode === 'plan') direction.y = 0;
      if (direction.lengthSq() > 0) aircraft.lookAt(aircraft.position.clone().add(direction));
      groundMarker.position.set(position.x, 0.035, position.z);
      const guidePositions = altitudeGuide.geometry.attributes.position;
      guidePositions.setXYZ(0, position.x, 0.04, position.z);
      guidePositions.setXYZ(1, position.x, position.y, position.z);
      guidePositions.needsUpdate = true;
      altitudeGuide.geometry.computeBoundingSphere();
      updateFlown(flownSegments, points, index, fraction);
      updateFlown(flownGroundSegments, groundPoints, index, fraction);
      if (!document.hidden && container.clientWidth > 0) renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    }
    window.missionFlightProfile = {
      reset: resetView,
      setView,
      getState: () => ({ mode, altitudeExaggerated: true, aircraft: aircraft.position.toArray(), camera: camera.position.toArray(), segment: clockPosition().segIndex })
    };
    animate();
    window.addEventListener('pagehide', () => {
      disposed = true;
      cancelAnimationFrame(frame);
      if (resizeObserver) resizeObserver.disconnect();
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (object.material.map) object.material.map.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
    }, { once: true });
  } catch (error) {
    if (renderer) renderer.dispose();
    renderFallback();
    console.warn('Flight profile unavailable:', error.message);
  }
})();
