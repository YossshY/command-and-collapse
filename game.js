/* ============================================================================
 * game.js — Boucle de jeu, caméra stratégique, sélection, ordres, rendu 3D
 * ========================================================================== */

import * as THREE from 'three';
import {
  MAP_SIZE, FACTIONS, TEAM_COLORS, UNIT_SPECS,
  createUnit, createGroundTexture, createMoveMarker, createSelectionRing
} from './assets.js';
import { Network } from './network.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------- état */

const net = new Network();

const units = new Map();          // id -> unité
const selected = new Set();       // ids sélectionnés
const markers = [];               // marqueurs d'ordre actifs
let players = [];                 // roster de la partie
let myId = null;
let mode = 'lobby';               // 'lobby' | 'game'
let syncAcc = 0;
let hudAcc = 0;

const profile = {
  name: localStorage.getItem('cac.name') || '',
  faction: localStorage.getItem('cac.faction') || 'usa',
  color: localStorage.getItem('cac.color') || FACTIONS.usa.color,
  colorTouched: localStorage.getItem('cac.colorTouched') === '1'
};

const SPAWNS = [
  { x: -32, z: -32 },
  { x:  32, z:  32 },
  { x:  32, z: -32 },
  { x: -32, z:  32 }
];

/* ------------------------------------------------------------------- three */

let scene, camera, renderer, raycaster, clock;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cam = {
  focus: new THREE.Vector3(0, 0, 0),
  dist: 48,
  targetDist: 48,
  pitch: THREE.MathUtils.degToRad(60)   // 60° : vue stratégique façon Generals
};

const keys = new Set();
const pointer = { x: 0, y: 0, inside: false };
const drag = { active: false, startX: 0, startY: 0, moved: false };

function setupThree() {
  const canvas = $('scene');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0e13);
  scene.fog = new THREE.Fog(0x0a0e13, 140, 280);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);

  // Éclairage
  scene.add(new THREE.HemisphereLight(0x9fc4e8, 0x2a3038, 1.15));

  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.position.set(45, 70, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // Terrain
  const groundMat = new THREE.MeshStandardMaterial({
    map: createGroundTexture(),
    roughness: 0.95,
    metalness: 0.05
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Liseré de bord de carte
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(MAP_SIZE, 0.2, MAP_SIZE)),
    new THREE.LineBasicMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0.55 })
  );
  edge.position.y = 0.1;
  scene.add(edge);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  window.addEventListener('resize', onResize);
}

/**
 * Environnement PBR minimal (dégradé ciel/sol) : sans lui, les matériaux
 * métalliques rendent noirs. Généré à la volée, aucun asset externe.
 */
function makeEnvironment(rendererRef) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, '#9dc0e0');
  grad.addColorStop(0.48, '#4a5c70');
  grad.addColorStop(0.52, '#2a323c');
  grad.addColorStop(1, '#10141a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(rendererRef);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* ------------------------------------------------------------------ caméra */

function updateCamera(dt) {
  if (mode === 'lobby') {
    const t = performance.now() * 0.0002;
    const r = 80;
    camera.position.set(Math.cos(t) * r, 54, Math.sin(t) * r);
    camera.lookAt(0, 0, 0);
    return;
  }

  const speed = 26 * (cam.dist / 48);
  let mx = 0;
  let mz = 0;

  if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp'))    mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown'))                      mz += 1;
  if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft'))  mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight'))                     mx += 1;

  // Défilement par les bords de l'écran
  if (pointer.inside) {
    const m = 24;
    if (pointer.x < m) mx -= 1;
    if (pointer.x > window.innerWidth - m) mx += 1;
    if (pointer.y < m) mz -= 1;
    if (pointer.y > window.innerHeight - m) mz += 1;
  }

  if (mx || mz) {
    const len = Math.hypot(mx, mz) || 1;
    cam.focus.x += (mx / len) * speed * dt;
    cam.focus.z += (mz / len) * speed * dt;
  }

  const lim = MAP_SIZE / 2 - 4;
  cam.focus.x = THREE.MathUtils.clamp(cam.focus.x, -lim, lim);
  cam.focus.z = THREE.MathUtils.clamp(cam.focus.z, -lim, lim);

  cam.dist += (cam.targetDist - cam.dist) * Math.min(1, dt * 9);

  const height = Math.sin(cam.pitch) * cam.dist;
  const back = Math.cos(cam.pitch) * cam.dist;
  camera.position.set(cam.focus.x, height, cam.focus.z + back);
  camera.lookAt(cam.focus.x, 0, cam.focus.z);
}

/* ------------------------------------------------------------------ entrées */

function setupInput() {
  const canvas = $('scene');

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    keys.add(e.code);
    if (e.code === 'Escape') clearSelection();
    if (e.code === 'KeyB' && mode === 'game') spawnDozer();
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    if (drag.active) updateDragBox(e);
  });

  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'game') return;
    if (e.button === 0) {
      drag.active = true;
      drag.moved = false;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      const box = $('select-box');
      box.style.left = `${e.clientX}px`;
      box.style.top = `${e.clientY}px`;
      box.style.width = '0px';
      box.style.height = '0px';
    } else if (e.button === 2) {
      issueMoveOrder(e);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag.active) return;
    drag.active = false;
    $('select-box').classList.add('hidden');
    if (mode !== 'game') return;

    if (drag.moved) {
      boxSelect(e.shiftKey);
    } else {
      clickSelect(e.clientX, e.clientY, e.shiftKey);
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mode !== 'game') return;
    cam.targetDist = THREE.MathUtils.clamp(cam.targetDist * (1 + e.deltaY * 0.0012), 18, 110);
  }, { passive: false });
}

function updateDragBox(e) {
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.moved = true;

  const box = $('select-box');
  box.classList.remove('hidden');
  box.style.left = `${Math.min(drag.startX, e.clientX)}px`;
  box.style.top = `${Math.min(drag.startY, e.clientY)}px`;
  box.style.width = `${Math.abs(dx)}px`;
  box.style.height = `${Math.abs(dy)}px`;
}

/* --------------------------------------------------------------- sélection */

function ndcFromClient(x, y) {
  return new THREE.Vector2(
    (x / window.innerWidth) * 2 - 1,
    -(y / window.innerHeight) * 2 + 1
  );
}

function groundPoint(x, y) {
  raycaster.setFromCamera(ndcFromClient(x, y), camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(groundPlane, p) ? p : null;
}

function pickUnit(x, y) {
  raycaster.setFromCamera(ndcFromClient(x, y), camera);
  const meshes = [];
  for (const u of units.values()) meshes.push(u.mesh);

  const hits = raycaster.intersectObjects(meshes, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData.unitId) obj = obj.parent;
    if (obj) return obj.userData.unitId;
  }
  return null;
}

function clickSelect(x, y, additive) {
  const id = pickUnit(x, y);
  if (!additive) clearSelection();
  if (!id) return;

  const unit = units.get(id);
  if (!unit || unit.owner !== myId) return;

  if (additive && selected.has(id)) {
    selected.delete(id);
    unit.ring.visible = false;
  } else {
    selected.add(id);
    unit.ring.visible = true;
  }
  updateSelectionPanel();
}

function boxSelect(additive) {
  const box = $('select-box');
  const rect = {
    left: parseFloat(box.style.left) || 0,
    top: parseFloat(box.style.top) || 0,
    right: (parseFloat(box.style.left) || 0) + (parseFloat(box.style.width) || 0),
    bottom: (parseFloat(box.style.top) || 0) + (parseFloat(box.style.height) || 0)
  };

  if (!additive) clearSelection();

  const v = new THREE.Vector3();
  for (const unit of units.values()) {
    if (unit.owner !== myId) continue;
    v.copy(unit.mesh.position);
    v.y += 1;
    v.project(camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (sx >= rect.left && sx <= rect.right && sy >= rect.top && sy <= rect.bottom) {
      selected.add(unit.id);
      unit.ring.visible = true;
    }
  }
  updateSelectionPanel();
}

function clearSelection() {
  for (const id of selected) {
    const unit = units.get(id);
    if (unit) unit.ring.visible = false;
  }
  selected.clear();
  updateSelectionPanel();
}

function updateSelectionPanel() {
  const el = $('hud-selection');
  if (!el) return;
  if (!selected.size) {
    el.textContent = 'Aucune unité sélectionnée';
    return;
  }
  const counts = new Map();
  for (const id of selected) {
    const unit = units.get(id);
    if (!unit) continue;
    counts.set(unit.spec.label, (counts.get(unit.spec.label) || 0) + 1);
  }
  el.textContent = [...counts.entries()].map(([label, n]) => `${n} × ${label}`).join(' · ');
}

/* ------------------------------------------------------------------- ordres */

function formation(center, count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacing = 3.4;
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    out.push(new THREE.Vector3(
      center.x + (c - (cols - 1) / 2) * spacing,
      0,
      center.z + (r - (rows - 1) / 2) * spacing
    ));
  }
  return out;
}

function issueMoveOrder(e) {
  if (!selected.size) return;
  const point = groundPoint(e.clientX, e.clientY);
  if (!point) return;

  const ids = [...selected];
  const targets = formation(point, ids.length);

  ids.forEach((id, i) => {
    const unit = units.get(id);
    if (!unit || unit.owner !== myId) return;
    unit.target = targets[i];
  });

  addMarker(point.x, point.z);
  net.sendOrder({ ids, x: point.x, z: point.z });
}

function addMarker(x, z) {
  const marker = createMoveMarker();
  marker.position.set(x, 0.06, z);
  scene.add(marker);
  markers.push(marker);
}

function updateMarkers(dt) {
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    m.userData.life += dt;
    const t = m.userData.life;
    m.scale.setScalar(1 + Math.sin(t * 9) * 0.08);
    m.children.forEach((c) => { c.material.opacity = Math.max(0, 0.9 - t * 0.7); });
    if (t > 1.3) {
      scene.remove(m);
      m.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      markers.splice(i, 1);
    }
  }
}

/* ------------------------------------------------------------------- unités */

function colorOf(ownerId) {
  const p = players.find((x) => x.id === ownerId);
  return p ? p.color : '#8a94a6';
}

function addUnit({ id, type, owner, x, z, ry = 0 }) {
  if (units.has(id)) return units.get(id);

  const spec = UNIT_SPECS[type] || UNIT_SPECS.tank;
  const mesh = createUnit(type, colorOf(owner));
  mesh.position.set(x, 0, z);
  mesh.rotation.y = ry;
  mesh.userData.unitId = id;

  const ring = createSelectionRing(0x8ef7b0);
  ring.scale.setScalar(spec.radius * 1.2);
  ring.visible = false;
  mesh.add(ring);

  scene.add(mesh);

  const unit = {
    id, type, owner, mesh, ring, spec,
    speed: spec.speed,
    target: null,
    netPos: new THREE.Vector3(x, 0, z),
    netRot: ry
  };
  units.set(id, unit);
  return unit;
}

function spawnPlayerUnits(player, index) {
  const sp = SPAWNS[index % SPAWNS.length];
  const face = Math.atan2(-sp.x, -sp.z);

  addUnit({ id: `${player.id}:cc`, type: 'cc', owner: player.id, x: sp.x, z: sp.z, ry: face });

  for (let i = 0; i < 2; i++) {
    addUnit({
      id: `${player.id}:tank:${i}`,
      type: 'tank',
      owner: player.id,
      x: sp.x + (i === 0 ? -5 : 5),
      z: sp.z + 7,
      ry: face
    });
  }
}

function spawnDozer() {
  const cc = [...units.values()].find((u) => u.owner === myId && u.type === 'cc');
  if (!cc) return;

  const id = `${myId}:dozer:${Date.now().toString(36)}`;
  addUnit({
    id,
    type: 'dozer',
    owner: myId,
    x: cc.mesh.position.x + 6,
    z: cc.mesh.position.z + 6,
    ry: 0
  });
  broadcastState();
  toast('Bulldozer sorti du centre de commandement.');
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function updateUnits(dt) {
  for (const unit of units.values()) {
    // Unités distantes : interpolation vers la dernière transformée reçue
    if (unit.owner !== myId) {
      const k = 1 - Math.exp(-dt * 14);
      unit.mesh.position.lerp(unit.netPos, k);
      unit.mesh.rotation.y = lerpAngle(unit.mesh.rotation.y, unit.netRot, k);
      continue;
    }

    if (!unit.target) continue;

    const dx = unit.target.x - unit.mesh.position.x;
    const dz = unit.target.z - unit.mesh.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.25) {
      unit.target = null;
      continue;
    }

    const step = Math.min(dist, unit.speed * dt);
    unit.mesh.position.x += (dx / dist) * step;
    unit.mesh.position.z += (dz / dist) * step;
    unit.mesh.rotation.y = lerpAngle(unit.mesh.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
  }
}

function updateSpinners(dt) {
  for (const unit of units.values()) {
    const spin = unit.mesh.userData.spin;
    if (spin) spin.rotation.y += dt * 1.1;
  }
}

/* -------------------------------------------------------------- synchronisation */

const r2 = (n) => Math.round(n * 100) / 100;

function broadcastState() {
  if (!net.inGame) return;
  const payload = [];
  for (const unit of units.values()) {
    if (unit.owner !== myId) continue;
    payload.push([
      unit.id,
      r2(unit.mesh.position.x),
      r2(unit.mesh.position.z),
      r2(unit.mesh.rotation.y),
      unit.type,
      unit.owner
    ]);
  }
  if (payload.length) net.sendUnits(payload);
}

function onRemoteUnits(list) {
  for (const entry of list) {
    if (!Array.isArray(entry) || entry.length < 6) continue;
    const [id, x, z, ry, type, owner] = entry;
    if (owner === myId) continue;

    let unit = units.get(id);
    if (!unit) unit = addUnit({ id, type, owner, x, z, ry });

    unit.netPos.set(x, 0, z);
    unit.netRot = ry;
  }
}

/* ------------------------------------------------------------------- partie */

function beginMatch(roster, seed) {
  players = roster;
  myId = net.selfId;
  mode = 'game';

  $('lobby').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('hud').classList.remove('hidden');

  const me = players.find((p) => p.id === myId) || players[0];
  if (me) {
    $('hud-name').textContent = me.name;
    $('hud-faction').textContent = (FACTIONS[me.faction] || FACTIONS.usa).name;
    $('hud-dot').style.background = me.color;
  }

  players.forEach((p, i) => spawnPlayerUnits(p, i));

  const myIndex = Math.max(0, players.findIndex((p) => p.id === myId));
  const sp = SPAWNS[myIndex % SPAWNS.length];
  cam.focus.set(sp.x, 0, sp.z);
  cam.dist = cam.targetDist = 48;

  net.enterGame(net.myRoom ? net.myRoom.code : 'solo');
  updateSelectionPanel();
  toast(`Partie lancée (graine ${seed}). Bonne chance, commandant.`);
}

function backToLobby() {
  mode = 'lobby';
  net.leaveGame();

  for (const unit of units.values()) {
    scene.remove(unit.mesh);
    unit.mesh.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }
  units.clear();
  selected.clear();
  players = [];

  for (const m of markers) scene.remove(m);
  markers.length = 0;

  $('hud').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  updateSelectionPanel();
}

/* ---------------------------------------------------------------------- HUD */

function updateHud() {
  let mine = 0;
  for (const unit of units.values()) if (unit.owner === myId) mine++;
  $('hud-units').textContent = `${mine} unité${mine > 1 ? 's' : ''}`;
  $('hud-peers').textContent = `${net.gamePeerCount()} allié${net.gamePeerCount() > 1 ? 's' : ''}`;
  $('hud-net').textContent = net.inGame ? 'P2P actif' : 'connexion…';
  $('hud-net').classList.toggle('ok', net.inGame);
}

let toastTimer = null;
function toast(message) {
  const el = $('toasts');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}

/* ------------------------------------------------------------------- lobby */

function saveProfile() {
  localStorage.setItem('cac.name', profile.name);
  localStorage.setItem('cac.faction', profile.faction);
  localStorage.setItem('cac.color', profile.color);
  localStorage.setItem('cac.colorTouched', profile.colorTouched ? '1' : '0');
  // Le profil courant est aussi celui envoyé aux autres pairs (création ET join)
  net.profile = { name: profile.name, faction: profile.faction, color: profile.color };
}

function renderProfile() {
  document.querySelectorAll('.faction').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.faction === profile.faction);
  });
  document.querySelectorAll('.swatch').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === profile.color);
  });
}

function renderRooms(rooms) {
  const list = $('room-list');
  $('room-count').textContent = String(rooms.length);
  list.textContent = '';

  if (!rooms.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Aucune partie annoncée pour le moment. Créez la vôtre.';
    list.appendChild(p);
    return;
  }

  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'room';

    const main = document.createElement('div');
    main.className = 'room-main';

    const title = document.createElement('strong');
    title.textContent = `Salon de ${room.hostName}`;
    main.appendChild(title);

    const sub = document.createElement('small');
    const names = (room.players || []).map((p) => p.name).join(', ');
    sub.textContent = `${(room.players || []).length}/${room.max || 4} joueurs · ${names}`;
    main.appendChild(sub);

    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Rejoindre';
    btn.addEventListener('click', () => net.joinRoom(room.code));

    row.appendChild(main);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function showWaiting(room) {
  $('lobby').classList.add('hidden');
  $('waiting').classList.remove('hidden');

  $('wait-code').textContent = room.code;
  $('wait-sub').textContent = room.isPrivate
    ? 'Salon privé — partagez ce code pour inviter vos amis.'
    : 'Salon public — visible par tous les joueurs connectés.';

  const ul = $('wait-players');
  ul.textContent = '';

  room.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'player';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.color;

    const info = document.createElement('div');
    info.className = 'player-info';

    const name = document.createElement('strong');
    name.textContent = p.name + (p.id === room.host ? ' (hôte)' : '');
    info.appendChild(name);

    const meta = document.createElement('small');
    meta.textContent = `${(FACTIONS[p.faction] || FACTIONS.usa).name} · ${(FACTIONS[p.faction] || FACTIONS.usa).tagline}`;
    info.appendChild(meta);

    const slot = document.createElement('span');
    slot.className = 'slot';
    slot.textContent = `#${i + 1}`;

    li.appendChild(dot);
    li.appendChild(info);
    li.appendChild(slot);
    ul.appendChild(li);
  });

  for (let i = room.players.length; i < 4; i++) {
    const li = document.createElement('li');
    li.className = 'player empty-slot';
    li.textContent = 'En attente d’un joueur…';
    ul.appendChild(li);
  }

  $('btn-start').classList.toggle('hidden', !room.isHost);
  $('btn-start').disabled = room.players.length < 1;
}

function bindLobby() {
  const nameInput = $('in-name');
  nameInput.value = profile.name;
  nameInput.addEventListener('input', () => {
    profile.name = nameInput.value.trim().slice(0, 16);
    saveProfile();
  });

  document.querySelectorAll('.faction').forEach((btn) => {
    btn.addEventListener('click', () => {
      profile.faction = btn.dataset.faction;
      if (!profile.colorTouched) profile.color = FACTIONS[profile.faction].color;
      saveProfile();
      renderProfile();
    });
  });

  const colorsEl = $('colors');
  for (const color of TEAM_COLORS) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.color = color;
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      profile.color = color;
      profile.colorTouched = true;
      saveProfile();
      renderProfile();
    });
    colorsEl.appendChild(btn);
  }

  $('btn-create').addEventListener('click', () => createRoom(false));
  $('btn-private').addEventListener('click', () => createRoom(true));

  $('btn-join-code').addEventListener('click', () => {
    const code = $('in-code').value.trim().toUpperCase();
    if (code) net.joinRoom(code);
  });

  $('in-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join-code').click();
  });

  $('btn-start').addEventListener('click', () => net.startGame());

  // Choix de la stratégie de signalisation (rechargement avec ?net=)
  const netSelect = $('in-net');
  const currentNet = new URLSearchParams(location.search).get('net') === 'torrent' ? 'torrent' : 'mqtt';
  netSelect.value = currentNet;
  netSelect.addEventListener('change', () => {
    const url = new URL(location.href);
    if (netSelect.value === 'torrent') url.searchParams.set('net', 'torrent');
    else url.searchParams.delete('net');
    location.href = url.toString();
  });

  $('btn-leave').addEventListener('click', () => {
    net.leaveRoom();
    backToLobby();
  });

  renderProfile();
  saveProfile();
}

function createRoom(isPrivate) {
  if (!profile.name) {
    toast('Choisissez un pseudo avant de créer un salon.');
    $('in-name').focus();
    return;
  }
  net.profile = {
    name: profile.name,
    faction: profile.faction,
    color: profile.color
  };
  net.createRoom(net.profile, isPrivate);
}

/* ------------------------------------------------------------------- boucle */

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);

  if (mode === 'game') {
    updateUnits(dt);
    updateMarkers(dt);
    updateSpinners(dt);

    syncAcc += dt;
    if (syncAcc >= 0.1) {
      syncAcc = 0;
      broadcastState();
    }

    hudAcc += dt;
    if (hudAcc >= 0.25) {
      hudAcc = 0;
      updateHud();
    }
  } else {
    updateSpinners(dt);
  }

  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  setupThree();
  setupInput();
  bindLobby();

  net.on('rooms', renderRooms);
  net.on('roster', showWaiting);
  net.on('start', (data) => beginMatch(data.players, data.seed));
  net.on('units', onRemoteUnits);
  net.on('order', (data) => addMarker(data.x, data.z));
  net.on('gamePeers', () => updateHud());
  net.on('joinFailed', (msg) => toast(msg));
  net.on('closed', (msg) => {
    toast(msg);
    backToLobby();
  });

  animate();

  try {
    await net.init();
    $('boot').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    $('net-mode').textContent = net.strategy === 'torrent' ? 'BitTorrent' : 'MQTT';
  } catch (err) {
    console.error(err);
    $('boot').textContent = `Impossible de joindre le réseau P2P : ${err.message}`;
  }
}

/* Point d'entrée de débogage : window.CAC.units, window.CAC.net, … */
window.CAC = {
  net,
  units,
  cam,
  get selected() { return [...selected]; },
  get players() { return players; },
  get scene() { return scene; }
};

boot();
