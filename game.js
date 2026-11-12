/* ============================================================================
 * game.js — Boucle de jeu, économie, construction, récolte, combat, IA
 * ========================================================================== */

import * as THREE from 'three';
import {
  MAP_SIZE, SPAWNS, CRYSTAL_FIELDS, HARVEST_LOAD, HARVEST_TIME, CRYSTAL_REGROW_MS,
  START_MONEY_OPTIONS, DIFFICULTY, FACTIONS, FACTION_ORDER, TEAM_COLORS,
  factionOf, buildingDef, unitDef, buildableList
} from './config.js';
import {
  createBuilding, createUnit, createCrystalField, createGroundTexture, createRock,
  createMoveMarker, createSelectionRing, createGhost, createScaffold, createHealthBar
} from './assets.js';
import { Network } from './network.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------- état */

const net = new Network();
const audio = new AudioEngine();

const units = new Map();       // id -> unité
const buildings = new Map();   // id -> bâtiment
const fields = new Map();      // id -> champ de cristaux
const selected = new Set();
const markers = [];
const tracers = [];

let players = [];
let myId = null;
let aiId = null;
let isHost = false;
let mode = 'lobby';
let money = 0;
let energyProd = 0;
let energyUse = 0;
let lowPower = false;
let entitySeq = 0;

let settings = { money: 5000, fog: true, ai: 'none' };

const profile = {
  name: localStorage.getItem('cac.name') || '',
  faction: localStorage.getItem('cac.faction') || 'atlantic',
  color: localStorage.getItem('cac.color') || FACTIONS.atlantic.color,
  colorTouched: localStorage.getItem('cac.colorTouched') === '1'
};

/* ------------------------------------------------------------------- three */

let scene, camera, renderer, raycaster, clock;
const decorRocks = [];
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const cam = {
  focus: new THREE.Vector3(0, 0, 0),
  dist: 58,
  targetDist: 58,
  pitch: THREE.MathUtils.degToRad(60)
};

const keys = new Set();
const pointer = { x: 0, y: 0, inside: false };
const drag = { active: false, startX: 0, startY: 0, moved: false };
let placement = null;   // { type, def, ghost, valid }

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
  scene.fog = new THREE.Fog(0x0a0e13, 150, 300);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);

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

  const groundMat = new THREE.MeshStandardMaterial({
    map: createGroundTexture(),
    roughness: 0.95,
    metalness: 0.05
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(MAP_SIZE, 0.2, MAP_SIZE)),
    new THREE.LineBasicMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0.55 })
  );
  edge.position.y = 0.1;
  scene.add(edge);

  // Rochers décoratifs (hors zones de base et de cristaux)
  for (let i = 0; i < 46; i++) {
    const x = (Math.random() - 0.5) * (MAP_SIZE - 8);
    const z = (Math.random() - 0.5) * (MAP_SIZE - 8);
    if (SPAWNS.some((s) => Math.hypot(s.x - x, s.z - z) < 16)) continue;
    if (CRYSTAL_FIELDS.some((f) => Math.hypot(f.x - x, f.z - z) < f.radius + 5)) continue;
    if (Math.hypot(x, z) < 12) continue;
    const rock = createRock();
    rock.position.set(x, 0, z);
    rock.rotation.y = Math.random() * Math.PI;
    scene.add(rock);
    decorRocks.push(rock);
  }

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  window.addEventListener('resize', onResize);
}

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

  const speed = 30 * (cam.dist / 58);
  let mx = 0;
  let mz = 0;

  if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp'))    mz -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown'))                      mz += 1;
  if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft'))  mx -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight'))                     mx += 1;

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
    if (e.code === 'Escape') {
      if (placement) cancelPlacement();
      else clearSelection();
    }

    if (mode === 'game' && /^Digit[1-9]$/.test(e.code)) {
      const n = e.code.slice(5);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); assignGroup(n); }
      else recallGroup(n);
    }

    if (mode === 'game' && (e.code === 'Delete' || e.code === 'Backspace')) {
      e.preventDefault();
      sellSelected();
    }
  });

  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    if (drag.active) updateDragBox(e);
    if (placement) updateGhost(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'game') return;

    if (e.button === 0) {
      if (placement) {
        tryPlace(e.clientX, e.clientY);
        return;
      }
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
      if (placement) { cancelPlacement(); return; }
      issueMoveOrder(e);
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag.active) return;
    drag.active = false;
    $('select-box').classList.add('hidden');
    if (mode !== 'game') return;

    if (drag.moved) boxSelect(e.shiftKey);
    else clickSelect(e.clientX, e.clientY, e.shiftKey);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (mode !== 'game') return;
    cam.targetDist = THREE.MathUtils.clamp(cam.targetDist * (1 + e.deltaY * 0.0012), 20, 200);
  }, { passive: false });

  // Minimap
  const mm = $('minimap');
  const jump = (ev) => {
    const r = mm.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * MAP_SIZE - MAP_SIZE / 2;
    const z = ((ev.clientY - r.top) / r.height) * MAP_SIZE - MAP_SIZE / 2;
    cam.focus.set(x, 0, z);
  };
  mm.addEventListener('pointerdown', (ev) => { jump(ev); mm.setPointerCapture(ev.pointerId); });
  mm.addEventListener('pointermove', (ev) => { if (ev.buttons & 1) jump(ev); });
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

function pickEntity(x, y) {
  raycaster.setFromCamera(ndcFromClient(x, y), camera);
  const meshes = [];
  for (const u of units.values()) meshes.push(u.mesh);
  for (const b of buildings.values()) meshes.push(b.mesh);

  const hits = raycaster.intersectObjects(meshes, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && !obj.userData.entityId) obj = obj.parent;
    if (obj) return obj.userData.entityId;
  }
  return null;
}

function clickSelect(x, y, additive) {
  const id = pickEntity(x, y);
  if (!additive) clearSelection();
  if (!id) return;

  const e = getEntity(id);
  if (!e || e.owner !== myId) return;

  if (additive && selected.has(id)) {
    selected.delete(id);
    if (e.ring) e.ring.visible = false;
  } else {
    selected.add(id);
    if (e.ring) e.ring.visible = true;
  }
  audio.sfx('select');
  refreshSelection();
}

function boxSelect(additive) {
  const box = $('select-box');
  const left = parseFloat(box.style.left) || 0;
  const top = parseFloat(box.style.top) || 0;
  const right = left + (parseFloat(box.style.width) || 0);
  const bottom = top + (parseFloat(box.style.height) || 0);

  if (!additive) clearSelection();

  const v = new THREE.Vector3();
  for (const u of units.values()) {
    if (u.owner !== myId) continue;
    v.set(u.x, 1, u.z).project(camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
      selected.add(u.id);
      if (u.ring) u.ring.visible = true;
    }
  }
  refreshSelection();
}

function sellBuilding(b) {
  if (!b || b.owner !== myId || b.type === 'cc') return;
  money += Math.round(b.def.cost * 0.5);
  removeEntity(b.id);
  audio.sfx('cash');
  toast(`${b.def.name} vendu.`);
  refreshSelection();
  updateHud();
  renderSidebar();
}

function sellSelected() {
  const list = [...selected].map(getEntity).filter((e) => e && e.kind === 'building' && e.type !== 'cc');
  if (!list.length) return;
  for (const b of list) sellBuilding(b);
}

const groups = new Map();

function assignGroup(n) {
  const ids = [...selected].filter((id) => units.has(id));
  if (!ids.length) return;
  groups.set(n, ids);
  toast(`Groupe ${n} : ${ids.length} unité(s).`);
}

function recallGroup(n) {
  const ids = groups.get(n);
  if (!ids || !ids.length) return;
  clearSelection();
  for (const id of ids) {
    const u = units.get(id);
    if (!u) continue;
    selected.add(id);
    if (u.ring) u.ring.visible = true;
  }
  refreshSelection();
  audio.sfx('select');
}

function clearSelection() {
  for (const id of selected) {
    const e = getEntity(id);
    if (e && e.ring) e.ring.visible = false;
  }
  selected.clear();
  refreshSelection();
}

function refreshSelection() {
  updateSelectionPanel();
  renderCommandPanel();
}

/* ------------------------------------------------------------------ entités */

function getEntity(id) {
  return units.get(id) || buildings.get(id) || null;
}

function colorOf(ownerId) {
  const p = players.find((x) => x.id === ownerId);
  return p ? p.color : '#8a94a6';
}

function factionOfOwner(ownerId) {
  const p = players.find((x) => x.id === ownerId);
  return p ? p.faction : 'atlantic';
}

function isLocal(ownerId) {
  return ownerId === myId || (isHost && ownerId === aiId);
}

function makeRing(radius, color) {
  const ring = createSelectionRing(color);
  ring.scale.setScalar(radius);
  ring.visible = false;
  return ring;
}

function addUnit({ id, type, owner, x, z, ry = 0, hp = null }) {
  if (units.has(id)) return units.get(id);

  const faction = factionOfOwner(owner);
  const def = unitDef(faction, type) || unitDef('atlantic', 'vanguard');
  const mesh = createUnit(def.shape, colorOf(owner), faction);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = ry;
  mesh.userData.entityId = id;

  const ring = makeRing(def.shape === 'infantry' || def.shape === 'infantry-at' ? 1.6 : 2.2, 0x8ef7b0);
  mesh.add(ring);

  const bar = createHealthBar();
  bar.rotation.x = -Math.PI / 2;
  bar.position.y = 2.4;
  bar.visible = false;
  mesh.add(bar);

  scene.add(mesh);

  const unit = {
    id, kind: 'unit', type, owner, faction, def, mesh, ring, bar,
    x, z, ry,
    hp: hp == null ? def.hp : hp,
    maxHp: def.hp,
    target: null,
    state: 'idle',
    cd: Math.random() * 0.5,
    carry: 0,
    fieldId: null,
    buildTarget: null,
    netPos: new THREE.Vector3(x, 0, z),
    netRot: ry,
    seenAt: performance.now()
  };
  units.set(id, unit);
  return unit;
}

function addBuilding({ id, type, owner, x, z, progress = 1, hp = null }) {
  if (buildings.has(id)) return buildings.get(id);

  const faction = factionOfOwner(owner);
  const def = buildingDef(faction, type) || buildingDef('atlantic', 'barracks');
  const mesh = createBuilding(def.shape, colorOf(owner), faction);
  mesh.position.set(x, 0, z);
  mesh.userData.entityId = id;

  const ring = makeRing(Math.max(def.w, def.d) * 0.62, 0x8ef7b0);
  mesh.add(ring);

  const bar = createHealthBar();
  bar.rotation.x = -Math.PI / 2;
  bar.position.y = def.h + 0.6;
  bar.visible = false;
  mesh.add(bar);

  const scaffold = createScaffold(def.w, def.h, def.d);
  mesh.add(scaffold);

  scene.add(mesh);

  const b = {
    id, kind: 'building', type, owner, faction, def, mesh, ring, bar, scaffold,
    x, z,
    hp: hp == null ? def.hp : hp,
    maxHp: def.hp,
    progress,
    built: progress >= 1,
    queue: [],
    cd: 0,
    seenAt: performance.now()
  };
  applyBuildVisual(b);
  buildings.set(id, b);
  return b;
}

function applyBuildVisual(b) {
  const p = Math.max(0.02, b.progress);
  b.mesh.scale.y = b.built ? 1 : 0.15 + 0.85 * p;
  b.scaffold.visible = !b.built;
}

function removeEntity(id) {
  const u = units.get(id);
  if (u) {
    scene.remove(u.mesh);
    disposeTree(u.mesh);
    units.delete(id);
    selected.delete(id);
    return;
  }
  const b = buildings.get(id);
  if (b) {
    scene.remove(b.mesh);
    disposeTree(b.mesh);
    buildings.delete(id);
    selected.delete(id);
    recomputeEnergy();
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

/* ------------------------------------------------------------------ économie */

function recomputeEnergy() {
  let prod = 0;
  let use = 0;
  for (const b of buildings.values()) {
    if (b.owner !== myId || !b.built) continue;
    const e = b.def.energy || 0;
    if (e > 0) prod += e;
    else use += -e;
  }
  energyProd = prod;
  energyUse = use;
  lowPower = use > prod;
  const el = $('low-power');
  if (el) el.classList.toggle('hidden', !lowPower);
}

function speedFactor(owner) {
  if (owner === myId) return lowPower ? 0.5 : 1;
  if (owner === aiId) return energyUseFor(aiId) > energyProdFor(aiId) ? 0.5 : 1;
  return 1;
}

/* -------------------------------------------------------------- construction */

function startPlacement(type) {
  const def = buildingDef(profile.faction, type);
  if (!def) return;
  if (money < def.cost) { toast('Fonds insuffisants.'); return; }

  cancelPlacement();
  const ghost = createGhost(def.shape, colorOf(myId), profile.faction);
  scene.add(ghost);
  placement = { type, def, ghost, valid: false, x: 0, z: 0 };
  $('hud').classList.add('placing');
}

function cancelPlacement() {
  if (!placement) return;
  scene.remove(placement.ghost);
  disposeTree(placement.ghost);
  placement = null;
  $('hud').classList.remove('placing');
}

function updateGhost(cx, cy) {
  const p = groundPoint(cx, cy);
  if (!p) return;
  const x = Math.round(p.x);
  const z = Math.round(p.z);
  placement.x = x;
  placement.z = z;
  placement.ghost.position.set(x, 0, z);
  placement.valid = canPlace(placement.def, x, z);
  placement.ghost.userData.setValid(placement.valid);
}

function canPlace(def, x, z) {
  const half = MAP_SIZE / 2 - 3;
  if (Math.abs(x) > half || Math.abs(z) > half) return false;

  for (const b of buildings.values()) {
    const pad = 1.2;
    if (Math.abs(b.x - x) < (b.def.w + def.w) / 2 + pad &&
        Math.abs(b.z - z) < (b.def.d + def.d) / 2 + pad) return false;
  }

  for (const f of fields.values()) {
    if (Math.hypot(f.def.x - x, f.def.z - z) < f.def.radius + Math.max(def.w, def.d) / 2) return false;
  }

  for (const s of SPAWNS) {
    if (Math.hypot(s.x - x, s.z - z) < 5) return false;
  }
  return true;
}

function tryPlace(cx, cy) {
  if (!placement) return;
  updateGhost(cx, cy);
  if (!placement.valid) { toast('Emplacement bloqué.'); return; }

  const { type, def, x, z } = placement;
  if (money < def.cost) { toast('Fonds insuffisants.'); cancelPlacement(); return; }

  money -= def.cost;
  placeBuilding(myId, type, x, z);
  cancelPlacement();
  audio.sfx('place');
  updateHud();
  renderSidebar();
}

function placeBuilding(owner, type, x, z) {
  const def = buildingDef(factionOfOwner(owner), type);
  const id = `${owner}:b${++entitySeq}`;
  return addBuilding({ id, type, owner, x, z, progress: 0, hp: def.hp * 0.15 });
}

function updateConstruction(b, dt) {
  if (b.built) return;

  // Pas d'unité de construction : le chantier avance seul, payé à la pose.
  const rate = (1 / b.def.time) * speedFactor(b.owner) * (b.owner === aiId ? aiSpeed() : 1);
  b.progress = Math.min(1, b.progress + rate * dt);
  b.hp = b.maxHp * (0.15 + 0.85 * b.progress);
  applyBuildVisual(b);

  if (b.progress >= 1) {
    b.built = true;
    b.hp = b.maxHp;
    applyBuildVisual(b);
    recomputeEnergy();
    if (b.owner === myId) { toast(`${b.def.name} opérationnel.`); audio.sfx('ready'); }

    if (b.def.freeUnit) spawnFromBuilding(b, b.def.freeUnit, true);
  }
}

/* ---------------------------------------------------------------- production */

function queueUnit(b, type) {
  const def = unitDef(b.faction, type);
  if (!def) return;
  if (money < def.cost) { toast('Fonds insuffisants.'); audio.sfx('error'); return; }
  if (b.queue.length >= 5) { toast('File de production pleine.'); audio.sfx('error'); return; }
  money -= def.cost;
  b.queue.push({ type, progress: 0 });
  updateHud();
}

function updateProduction(b, dt) {
  if (!b.built || !b.queue.length) return;
  const job = b.queue[0];
  const def = unitDef(b.faction, job.type);
  if (!def) { b.queue.shift(); return; }

  const rate = (1 / def.time) * speedFactor(b.owner) * (b.owner === aiId ? aiSpeed() : 1);
  job.progress += rate * dt;

  if (job.progress >= 1) {
    b.queue.shift();
    spawnFromBuilding(b, job.type, false);
  }
}

function spawnFromBuilding(b, type, free) {
  const def = unitDef(b.faction, type);
  if (!def) return;

  const a = Math.random() * Math.PI * 2;
  const r = Math.max(b.def.w, b.def.d) / 2 + 2.5;
  const lim = MAP_SIZE / 2 - 3;
  const x = THREE.MathUtils.clamp(b.x + Math.cos(a) * r, -lim, lim);
  const z = THREE.MathUtils.clamp(b.z + Math.sin(a) * r, -lim, lim);

  const id = `${b.owner}:u${++entitySeq}`;
  const u = addUnit({ id, type, owner: b.owner, x, z, ry: Math.atan2(-Math.cos(a), -Math.sin(a)) });

  if (b.rally) u.target = { x: b.rally.x, z: b.rally.z };
  if (free && b.owner === myId) toast(`${def.name} livré.`);
  return u;
}

/* ------------------------------------------------------------------- récolte */

function nearestField(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const f of fields.values()) {
    if (f.remaining <= 0) continue;
    const d = Math.hypot(f.def.x - x, f.def.z - z);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

function nearestRefinery(owner, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const b of buildings.values()) {
    if (b.owner !== owner || !b.built) continue;
    if (!b.def.freeUnit) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function updateCollector(u, dt) {
  if (u.state === 'idle') {
    const f = nearestField(u.x, u.z);
    if (!f) return;
    u.fieldId = f.def.id;
    u.state = 'toField';
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * f.def.radius * 0.7;
    u.target = { x: f.def.x + Math.cos(a) * r, z: f.def.z + Math.sin(a) * r };
    return;
  }

  if (u.state === 'toField') {
    const f = fields.get(u.fieldId);
    if (!f || f.remaining <= 0) { u.state = 'idle'; u.target = null; return; }
    if (!u.target) { u.state = 'idle'; return; }
    if (Math.hypot(u.x - u.target.x, u.z - u.target.z) < 1.2) {
      u.state = 'harvesting';
      u.harvestT = 0;
      u.target = null;
    }
    return;
  }

  if (u.state === 'harvesting') {
    u.harvestT += dt;
    if (u.harvestT < HARVEST_TIME) return;

    const f = fields.get(u.fieldId);
    if (!f || f.remaining <= 0) { u.state = 'idle'; return; }

    const amount = Math.min(HARVEST_LOAD, f.remaining);
    takeFromField(f, amount);
    u.carry = amount;
    u.state = 'toRefinery';

    const ref = nearestRefinery(u.owner, u.x, u.z);
    if (!ref) { u.state = 'idle'; return; }
    u.refineryId = ref.id;
    u.target = { x: ref.x + (ref.def.w / 2 + 1.5), z: ref.z + (ref.def.d / 2 + 1.5) };
    return;
  }

  if (u.state === 'toRefinery') {
    const ref = buildings.get(u.refineryId);
    if (!ref || !ref.built) { u.state = 'idle'; u.target = null; return; }
    if (!u.target) { u.state = 'idle'; return; }
    if (Math.hypot(u.x - u.target.x, u.z - u.target.z) < 1.6) {
      if (u.owner === myId) { money += u.carry; audio.sfx('cash'); }
      else if (isHost && u.owner === aiId) aiMoney += u.carry;
      u.carry = 0;
      u.state = 'idle';
      u.target = null;
    }
  }
}

function takeFromField(f, amount) {
  f.remaining = Math.max(0, f.remaining - amount);
  f.alive = Math.ceil((f.remaining / f.def.value) * f.def.crystals);
  f.group.userData.setAlive(f.alive);
  net.sendHarvest({ field: f.def.id, amount });
}

function applyHarvest(fieldId, amount) {
  const f = fields.get(fieldId);
  if (!f) return;
  f.remaining = Math.max(0, f.remaining - amount);
  f.alive = Math.ceil((f.remaining / f.def.value) * f.def.crystals);
  f.group.userData.setAlive(f.alive);
}

function updateFields(dt) {
  for (const f of fields.values()) {
    if (f.remaining <= 0 || f.remaining >= f.def.value) continue;
    f.regrowT += dt * 1000;
    if (f.regrowT >= CRYSTAL_REGROW_MS) {
      f.regrowT = 0;
      f.remaining = Math.min(f.def.value, f.remaining + f.def.value / f.def.crystals);
      f.alive = Math.ceil((f.remaining / f.def.value) * f.def.crystals);
      f.group.userData.setAlive(f.alive);
    }
  }
}

/* -------------------------------------------------------------------- combat */

function findTarget(u) {
  const range = u.def.range || 0;
  if (!range) return null;
  let best = null;
  let bestD = range;

  for (const e of units.values()) {
    if (e.owner === u.owner) continue;
    const d = Math.hypot(e.x - u.x, e.z - u.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  for (const e of buildings.values()) {
    if (e.owner === u.owner) continue;
    const d = Math.hypot(e.x - u.x, e.z - u.z) - Math.max(e.def.w, e.def.d) / 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function updateCombat(u, dt) {
  if (!u.def.dmg) return;
  u.cd -= dt;
  if (u.cd > 0) return;

  const target = findTarget(u);
  if (!target) return;

  u.cd = u.def.cd;
  u.ry = Math.atan2(target.x - u.x, target.z - u.z);
  u.mesh.rotation.y = u.ry;

  spawnTracer(u, target);
  if (performance.now() - lastShotSfx > 70) { lastShotSfx = performance.now(); audio.sfx('shot'); }

  if (isLocal(target.owner)) {
    applyDamage(target, u.def.dmg);
  } else {
    net.sendHit({ target: target.id, dmg: u.def.dmg });
  }
}

let lastShotSfx = 0;

function spawnTracer(from, to) {
  const a = new THREE.Vector3(from.x, 1.2, from.z);
  const b = new THREE.Vector3(to.x, 1.0, to.z);
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color: 0xffd166, transparent: true, opacity: 0.9
  }));
  scene.add(line);
  tracers.push({ line, life: 0.12 });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.12);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }
}

function applyDamage(entity, dmg) {
  entity.hp -= dmg;
  if (entity.hp <= 0) {
    if (entity.kind === 'unit' && entity.def.suicide) {
      for (const e of [...units.values(), ...buildings.values()]) {
        if (e.owner === entity.owner) continue;
        if (Math.hypot(e.x - entity.x, e.z - entity.z) < 6) applyDamage(e, 60);
      }
    }
    audio.sfx('explosion');
    removeEntity(entity.id);
  }
}

/* --------------------------------------------------------------- brouillard */

const FOG_RES = 384;
let fogCanvas, fogCtx, fogTex, fogMesh, exploredCanvas, exploredCtx, visCanvas, visCtx;

function setupFog() {
  fogCanvas = document.createElement('canvas');
  fogCanvas.width = fogCanvas.height = FOG_RES;
  fogCtx = fogCanvas.getContext('2d');

  exploredCanvas = document.createElement('canvas');
  exploredCanvas.width = exploredCanvas.height = FOG_RES;
  exploredCtx = exploredCanvas.getContext('2d');

  visCanvas = document.createElement('canvas');
  visCanvas.width = visCanvas.height = FOG_RES;
  visCtx = visCanvas.getContext('2d');

  fogTex = new THREE.CanvasTexture(fogCanvas);
  fogTex.colorSpace = THREE.SRGBColorSpace;

  fogMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE),
    new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false })
  );
  fogMesh.rotation.x = -Math.PI / 2;
  fogMesh.position.y = 0.5;
  fogMesh.renderOrder = 2;
  scene.add(fogMesh);
}

function worldToFog(x, z) {
  return [((x + MAP_SIZE / 2) / MAP_SIZE) * FOG_RES, ((z + MAP_SIZE / 2) / MAP_SIZE) * FOG_RES];
}

function drawSight(ctx, x, z, radius, alpha) {
  const [fx, fz] = worldToFog(x, z);
  const r = (radius / MAP_SIZE) * FOG_RES;
  const g = ctx.createRadialGradient(fx, fz, r * 0.55, fx, fz, r);
  g.addColorStop(0, `rgba(255,255,255,${alpha})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(fx, fz, r, 0, Math.PI * 2);
  ctx.fill();
}

function updateFog() {
  if (!settings.fog) { fogMesh.visible = false; return; }
  fogMesh.visible = true;

  visCtx.clearRect(0, 0, FOG_RES, FOG_RES);

  for (const u of units.values()) {
    if (u.owner !== myId) continue;
    drawSight(visCtx, u.x, u.z, u.def.sight || 14, 1);
    drawSight(exploredCtx, u.x, u.z, u.def.sight || 14, 1);
  }
  for (const b of buildings.values()) {
    if (b.owner !== myId) continue;
    const r = Math.max(b.def.w, b.def.d) / 2 + 20;
    drawSight(visCtx, b.x, b.z, r, 1);
    drawSight(exploredCtx, b.x, b.z, r, 1);
  }

  fogCtx.globalCompositeOperation = 'source-over';
  fogCtx.fillStyle = 'rgba(5,7,10,0.93)';
  fogCtx.fillRect(0, 0, FOG_RES, FOG_RES);

  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.globalAlpha = 0.62;
  fogCtx.drawImage(exploredCanvas, 0, 0);
  fogCtx.globalAlpha = 1;
  fogCtx.drawImage(visCanvas, 0, 0);
  fogCtx.globalCompositeOperation = 'source-over';

  fogTex.needsUpdate = true;
}

/** Révèle une zone autour de la base au démarrage (repères initiaux). */
function revealStartArea() {
  const cc = [...buildings.values()].find((b) => b.owner === myId && b.type === 'cc');
  if (!cc) return;
  drawSight(exploredCtx, cc.x, cc.z, 55, 1);
}

function isVisibleToMe(x, z, extra = 0) {
  if (!settings.fog) return true;
  for (const u of units.values()) {
    if (u.owner !== myId) continue;
    const r = (u.def.sight || 14) + extra;
    if ((u.x - x) ** 2 + (u.z - z) ** 2 < r * r) return true;
  }
  for (const b of buildings.values()) {
    if (b.owner !== myId) continue;
    const r = Math.max(b.def.w, b.def.d) / 2 + 20 + extra;
    if ((b.x - x) ** 2 + (b.z - z) ** 2 < r * r) return true;
  }
  return false;
}

function updateVisibility() {
  for (const u of units.values()) {
    if (u.owner === myId) { u.mesh.visible = true; continue; }
    u.mesh.visible = isVisibleToMe(u.x, u.z);
  }
  for (const b of buildings.values()) {
    if (b.owner === myId) { b.mesh.visible = true; continue; }
    b.mesh.visible = isVisibleToMe(b.x, b.z);
  }
  // Le décor dépasse du plan de brouillard : on le masque hors vision
  for (const r of decorRocks) {
    r.visible = isVisibleToMe(r.position.x, r.position.z, 4);
  }
  for (const f of fields.values()) {
    f.group.visible = isVisibleToMe(f.def.x, f.def.z, f.def.radius);
  }
}

/* ------------------------------------------------------------------ minimap */

let mmCtx = null;

function setupMinimap() {
  mmCtx = $('minimap').getContext('2d');
}

function drawMinimap() {
  if (!mmCtx) return;
  const S = 190;
  const k = S / MAP_SIZE;
  const px = (x) => (x + MAP_SIZE / 2) * k;

  mmCtx.fillStyle = '#0d1218';
  mmCtx.fillRect(0, 0, S, S);

  for (const f of fields.values()) {
    mmCtx.fillStyle = f.def.color;
    mmCtx.globalAlpha = 0.25 + 0.5 * (f.remaining / f.def.value);
    mmCtx.beginPath();
    mmCtx.arc(px(f.def.x), px(f.def.z), f.def.radius * k, 0, Math.PI * 2);
    mmCtx.fill();
  }
  mmCtx.globalAlpha = 1;

  for (const b of buildings.values()) {
    if (b.owner !== myId && !b.mesh.visible) continue;
    mmCtx.fillStyle = colorOf(b.owner);
    const w = Math.max(3, b.def.w * k);
    mmCtx.fillRect(px(b.x) - w / 2, px(b.z) - w / 2, w, w);
  }

  for (const u of units.values()) {
    if (u.owner !== myId && !u.mesh.visible) continue;
    mmCtx.fillStyle = colorOf(u.owner);
    mmCtx.beginPath();
    mmCtx.arc(px(u.x), px(u.z), 2, 0, Math.PI * 2);
    mmCtx.fill();
  }

  const halfW = cam.dist * 0.9;
  const halfH = cam.dist * 0.55;
  mmCtx.strokeStyle = 'rgba(255,255,255,0.55)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(
    px(cam.focus.x - halfW), px(cam.focus.z - halfH),
    halfW * 2 * k, halfH * 2 * k
  );
}

/* ---------------------------------------------------------------------- HUD */

function updateHud() {
  $('hud-money').textContent = Math.floor(money).toLocaleString('fr-FR');
  $('power-label').textContent = `${energyProd} / ${energyUse}`;
  const ratio = energyUse === 0 ? (energyProd > 0 ? 1 : 0) : Math.min(1, energyProd / energyUse);
  $('power-fill').style.height = `${Math.max(4, ratio * 100)}%`;
  $('power-fill').classList.toggle('bad', lowPower);
  $('hud-peers').textContent = `${net.gamePeerCount()} allié${net.gamePeerCount() > 1 ? 's' : ''}`;
  refreshSidebar();
}

function updateSelectionPanel() {
  const el = $('hud-selection');
  if (!el) return;
  if (!selected.size) { el.textContent = 'Aucune sélection'; return; }

  const counts = new Map();
  for (const id of selected) {
    const e = getEntity(id);
    if (!e) continue;
    counts.set(e.def.name, (counts.get(e.def.name) || 0) + 1);
  }
  el.textContent = [...counts.entries()].map(([l, n]) => `${n} × ${l}`).join(' · ');
}

function renderCommandPanel() {
  const panel = $('cmd-panel');
  panel.textContent = '';
  panel.classList.add('hidden');
  if (mode !== 'game' || !selected.size) return;

  const sel = [...selected].map(getEntity).filter(Boolean);
  const prod = sel.find((e) => e.kind === 'building' && e.built && e.def.produces && e.def.produces.length);
  if (prod) { renderProduceMenu(panel, prod); return; }

  const b = sel.find((e) => e.kind === 'building');
  if (b && sel.length === 1) { renderBuildingInfo(panel, b); return; }
}

function renderBuildingInfo(panel, b) {
  panel.classList.remove('hidden');
  const title = document.createElement('div');
  title.className = 'cmd-title';
  title.textContent = b.def.name;
  panel.appendChild(title);

  const info = document.createElement('div');
  info.className = 'cmd-desc';
  const bits = [`${Math.round(b.hp)} / ${b.maxHp} PV`];
  if (b.def.energy) bits.push(`${b.def.energy > 0 ? '+' : ''}${b.def.energy} ⚡`);
  if (!b.built) bits.push(`chantier ${Math.round(b.progress * 100)} %`);
  if (b.rally) bits.push('point de ralliement défini');
  info.textContent = bits.join(' · ');
  panel.appendChild(info);

  if (b.type !== 'cc') {
    const actions = document.createElement('div');
    actions.className = 'cmd-actions';
    const sell = document.createElement('button');
    sell.className = 'cmd-btn';
    sell.innerHTML = `<span class="cmd-name">Vendre</span><span class="cmd-cost">+$${Math.round(b.def.cost * 0.5).toLocaleString('fr-FR')}</span>`;
    sell.addEventListener('click', () => sellBuilding(b));
    actions.appendChild(sell);
    panel.appendChild(actions);
  }
}

/* ------------------------------------------------------- panneau de construction */

let sidebarButtons = new Map();

function renderSidebar() {
  const list = $('build-list');
  if (!list) return;
  list.textContent = '';
  sidebarButtons = new Map();
  if (mode !== 'game') return;

  for (const def of buildableList(profile.faction)) {
    const btn = document.createElement('button');
    btn.className = 'build-btn';
    btn.innerHTML = `
      <span class="b-name">${def.name}</span>
      <span class="b-cost">$${def.cost.toLocaleString('fr-FR')}</span>
      <span class="b-meta">${def.time}s${def.energy ? ` · ${def.energy > 0 ? '+' : ''}${def.energy}⚡` : ''} · ${def.desc || ''}</span>`;
    btn.addEventListener('click', () => { audio.sfx('click'); startPlacement(def.id); });
    list.appendChild(btn);
    sidebarButtons.set(def.id, { btn, def });
  }
  refreshSidebar();
}

function refreshSidebar() {
  for (const { btn, def } of sidebarButtons.values()) {
    btn.disabled = money < def.cost;
  }
}

function renderProduceMenu(panel, b) {
  panel.classList.remove('hidden');
  const title = document.createElement('div');
  title.className = 'cmd-title';
  title.textContent = b.def.name;

  if (b.queue.length) {
    const q = document.createElement('span');
    q.className = 'cmd-queue';
    q.textContent = `file : ${b.queue.map((j) => unitDef(b.faction, j.type).name).join(', ')}`;
    title.appendChild(q);
  }
  panel.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'cmd-grid';

  for (const type of b.def.produces) {
    const def = unitDef(b.faction, type);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.className = 'cmd-btn';
    btn.disabled = money < def.cost;
    btn.innerHTML = `
      <span class="cmd-name">${def.name}</span>
      <span class="cmd-cost">$${def.cost.toLocaleString('fr-FR')} · ${def.time}s</span>
      <span class="cmd-desc">${def.role || ''}</span>`;
    btn.addEventListener('click', () => { queueUnit(b, type); renderCommandPanel(); });
    grid.appendChild(btn);
  }
  panel.appendChild(grid);
}

let toastTimer = null;
function toast(message) {
  const el = $('toasts');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ----------------------------------------------------------------------- IA */

let aiMoney = 0;
let aiThink = 0;
let aiWave = [];
let aiAttacking = false;

function aiSpeed() {
  return (DIFFICULTY[settings.ai] || DIFFICULTY.normal).speed;
}

function aiFaction() {
  const p = players.find((x) => x.id === aiId);
  return p ? p.faction : 'eurasia';
}

function aiCount(type) {
  let n = 0;
  for (const b of buildings.values()) if (b.owner === aiId && b.type === type) n++;
  return n;
}

function aiFindSpot(def) {
  const cc = [...buildings.values()].find((b) => b.owner === aiId && b.type === 'cc');
  if (!cc) return null;
  for (let ring = 1; ring <= 5; ring++) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + ring * 0.4;
      const r = 8 + ring * 5;
      const x = Math.round(cc.x + Math.cos(a) * r);
      const z = Math.round(cc.z + Math.sin(a) * r);
      if (canPlace(def, x, z)) return { x, z };
    }
  }
  return null;
}

function aiBuild(type) {
  const def = buildingDef(aiFaction(), type);
  if (!def || aiMoney < def.cost) return false;
  const spot = aiFindSpot(def);
  if (!spot) return false;

  aiMoney -= def.cost;
  placeBuilding(aiId, type, spot.x, spot.z);
  return true;
}

function aiProduce(type) {
  const def = unitDef(aiFaction(), type);
  if (!def || aiMoney < def.cost) return false;

  for (const b of buildings.values()) {
    if (b.owner !== aiId || !b.built) continue;
    if (!b.def.produces || !b.def.produces.includes(type)) continue;
    if (b.queue.length >= 2) continue;
    aiMoney -= def.cost;
    b.queue.push({ type, progress: 0 });
    return true;
  }
  return false;
}

function energyProdFor(owner) {
  let p = 0;
  for (const b of buildings.values()) if (b.owner === owner && b.built && b.def.energy > 0) p += b.def.energy;
  return p;
}

function energyUseFor(owner) {
  let u = 0;
  for (const b of buildings.values()) if (b.owner === owner && b.built && b.def.energy < 0) u += -b.def.energy;
  return u;
}

function nearestEnemyBuilding(owner) {
  const mine = [...buildings.values()].filter((b) => b.owner === owner);
  if (!mine.length) return null;
  const origin = mine[0];
  let best = null;
  let bestD = Infinity;
  for (const b of buildings.values()) {
    if (b.owner === owner) continue;
    const d = Math.hypot(b.x - origin.x, b.z - origin.z);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}

function updateAI(dt) {
  if (!aiId || !isHost) return;
  aiThink -= dt;
  if (aiThink > 0) return;
  aiThink = (DIFFICULTY[settings.ai] || DIFFICULTY.normal).think;

  const faction = factionOf(aiFaction());
  const hasPower = faction.usesPower;
  const waveSize = (DIFFICULTY[settings.ai] || DIFFICULTY.normal).wave;
  const army = [...units.values()].filter((u) => u.owner === aiId && u.def.dmg);
  const collectors = [...units.values()].filter((u) => u.owner === aiId && u.def.role === 'récolte').length
    + [...buildings.values()]
      .filter((b) => b.owner === aiId)
      .reduce((n, b) => n + b.queue.filter((j) => j.type === 'collector').length, 0);

  // 1. Socle économique
  if (hasPower && aiCount('power') < 1) { if (aiBuild('power')) return; }
  if (aiCount('refinery') < 1) { if (aiBuild('refinery')) return; }
  if (aiCount('barracks') < 1) { if (aiBuild('barracks')) return; }

  // 2. Deuxième collecteur dès que la trésorerie le permet
  if (collectors < 2 && aiCount('refinery') > 0 && aiMoney > 1100) {
    if (aiProduce('collector')) return;
  }

  // 3. Infanterie en continu (seuil basé sur le coût réel)
  if (army.length < waveSize + 4) {
    const barracks = [...buildings.values()].find((b) => b.owner === aiId && b.type === 'barracks' && b.built);
    if (barracks) {
      const cheapest = barracks.def.produces
        .map((t) => ({ t, d: unitDef(aiFaction(), t) }))
        .filter((x) => x.d && x.d.cost <= aiMoney)
        .sort((a, b) => a.d.cost - b.d.cost)[0];
      if (cheapest && aiProduce(cheapest.t)) return;
    }
  }

  // 4. Industrie lourde quand la trésorerie le permet
  if (aiCount('factory') < 1 && aiMoney > 2000) { if (aiBuild('factory')) return; }
  if (hasPower && energyUseFor(aiId) > energyProdFor(aiId) && aiCount('power') < 3) {
    if (aiBuild('power')) return;
  }
  if (aiCount('turret') < 2 && aiMoney > 1200) { if (aiBuild('turret')) return; }
  if (aiCount('research') < 1 && aiMoney > 2400) { if (aiBuild('research')) return; }

  // 5. Véhicules
  const factory = [...buildings.values()].find((b) => b.owner === aiId && b.type === 'factory' && b.built);
  if (factory && aiMoney > 900) {
    const pick = factory.def.produces
      .map((t) => ({ t, d: unitDef(aiFaction(), t) }))
      .filter((x) => x.d && x.d.cost <= aiMoney)
      .sort((a, b) => b.d.cost - a.d.cost)[0];
    if (pick) aiProduce(pick.t);
  }

  const elapsed = performance.now() - matchStart;
  if (!aiAttacking && (army.length >= waveSize || (elapsed > 150000 && army.length >= 3))) {
    aiAttacking = true;
    aiWave = army;
    const target = nearestEnemyBuilding(aiId);
    if (target) {
      for (const u of army) {
        u.target = { x: target.x + (Math.random() - 0.5) * 8, z: target.z + (Math.random() - 0.5) * 8 };
        u.state = 'attack';
      }
    }
  }

  if (aiAttacking) {
    const alive = aiWave.filter((u) => units.has(u.id));
    if (alive.length < 2) {
      aiAttacking = false;
      aiWave = [];
    } else {
      const target = nearestEnemyBuilding(aiId);
      if (target) {
        for (const u of alive) {
          if (!u.target) u.target = { x: target.x + (Math.random() - 0.5) * 10, z: target.z + (Math.random() - 0.5) * 10 };
        }
      }
    }
  }
}

/* -------------------------------------------------------------- déplacements */

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function updateUnits(dt) {
  for (const u of units.values()) {
    if (!isLocal(u.owner)) {
      const k = 1 - Math.exp(-dt * 14);
      u.mesh.position.lerp(u.netPos, k);
      u.mesh.rotation.y = lerpAngle(u.mesh.rotation.y, u.netRot, k);
      u.x = u.mesh.position.x;
      u.z = u.mesh.position.z;
      continue;
    }

    if (u.def.role === 'récolte') updateCollector(u, dt);

    if (u.target) {
      const dx = u.target.x - u.x;
      const dz = u.target.z - u.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.4) {
        u.target = null;
        if (u.state === 'attack') u.state = 'idle';
      } else {
        const step = Math.min(dist, u.def.speed * dt);
        u.x += (dx / dist) * step;
        u.z += (dz / dist) * step;
        u.ry = lerpAngle(u.ry, Math.atan2(dx, dz), 1 - Math.exp(-dt * 10));
      }
    }

    const lim = MAP_SIZE / 2 - 2;
    u.x = THREE.MathUtils.clamp(u.x, -lim, lim);
    u.z = THREE.MathUtils.clamp(u.z, -lim, lim);
    u.mesh.position.set(u.x, 0, u.z);
    u.mesh.rotation.y = u.ry;

    updateCombat(u, dt);
  }
}

function updateBuildings(dt) {
  for (const b of buildings.values()) {
    if (!isLocal(b.owner)) continue;
    updateConstruction(b, dt);
    updateProduction(b, dt);
  }
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
    out.push({
      x: center.x + (c - (cols - 1) / 2) * spacing,
      z: center.z + (r - (rows - 1) / 2) * spacing
    });
  }
  return out;
}

function issueMoveOrder(e) {
  if (!selected.size) return;
  const point = groundPoint(e.clientX, e.clientY);
  if (!point) return;

  // Bâtiment de production seul sélectionné : clic droit = point de ralliement
  const sel = [...selected].map(getEntity).filter(Boolean);
  if (sel.length === 1 && sel[0].kind === 'building' && sel[0].built &&
      sel[0].def.produces && sel[0].def.produces.length) {
    sel[0].rally = { x: point.x, z: point.z };
    addMarker(point.x, point.z);
    audio.sfx('click');
    toast('Point de ralliement défini.');
    return;
  }

  const ids = [...selected].filter((id) => units.has(id));
  if (!ids.length) return;

  const targets = formation(point, ids.length);
  ids.forEach((id, i) => {
    const u = units.get(id);
    if (!u || u.owner !== myId) return;
    u.target = targets[i];
    u.state = 'move';
    u.buildTarget = null;
  });

  addMarker(point.x, point.z);
  audio.sfx('click');
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

/* -------------------------------------------------------------- synchronisation */

const r2 = (n) => Math.round(n * 100) / 100;
let syncAcc = 0;

function broadcastState() {
  if (!net.inGame) return;
  const e = [];

  for (const u of units.values()) {
    if (!isLocal(u.owner)) continue;
    e.push([u.id, 0, u.type, u.owner, r2(u.x), r2(u.z), r2(u.ry), Math.round(u.hp), u.maxHp, 1, 1]);
  }
  for (const b of buildings.values()) {
    if (!isLocal(b.owner)) continue;
    e.push([b.id, 1, b.type, b.owner, r2(b.x), r2(b.z), 0, Math.round(b.hp), b.maxHp, r2(b.progress), b.built ? 1 : 0]);
  }

  if (e.length) net.sendEnts({ e });
}

function onRemoteEnts(data) {
  const now = performance.now();
  for (const row of data.e) {
    if (!Array.isArray(row) || row.length < 11) continue;
    const [id, kind, type, owner, x, z, ry, hp, maxHp, progress, built] = row;
    if (isLocal(owner)) continue;

    if (kind === 0) {
      let u = units.get(id);
      if (!u) u = addUnit({ id, type, owner, x, z, ry, hp });
      u.netPos.set(x, 0, z);
      u.netRot = ry;
      u.hp = hp;
      u.seenAt = now;
    } else {
      let b = buildings.get(id);
      if (!b) b = addBuilding({ id, type, owner, x, z, progress, hp });
      b.hp = hp;
      b.progress = progress;
      b.built = !!built;
      applyBuildVisual(b);
      b.seenAt = now;
    }
  }
}

let matchStart = 0;

function sweepRemote() {
  const now = performance.now();
  if (now - matchStart < 6000) return;
  for (const [id, u] of units) {
    if (isLocal(u.owner)) continue;
    if (now - u.seenAt > 2500) removeEntity(id);
  }
  for (const [id, b] of buildings) {
    if (isLocal(b.owner)) continue;
    if (now - b.seenAt > 2500) removeEntity(id);
  }
}

/* ------------------------------------------------------------------- partie */

function beginMatch(roster, cfg) {
  players = roster.slice();
  settings = Object.assign({ money: 5000, fog: true, ai: 'none' }, cfg || {});
  myId = net.selfId;
  isHost = !!(net.myRoom && net.myRoom.isHost);
  mode = 'game';

  $('lobby').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('hud').classList.remove('hidden');

  const me = players.find((p) => p.id === myId) || players[0];
  if (me) {
    $('hud-name').textContent = me.name;
    $('hud-faction').textContent = factionOf(me.faction).name;
    $('hud-dot').style.background = me.color;
  }

  for (const def of CRYSTAL_FIELDS) {
    const group = createCrystalField(def);
    scene.add(group);
    fields.set(def.id, { def, group, remaining: def.value, alive: def.crystals, regrowT: 0 });
  }

  if (settings.ai !== 'none' && isHost) {
    aiId = `ai:${net.selfId}`;
    aiMoney = settings.money * DIFFICULTY[settings.ai].money;
  }

  players.forEach((p, i) => spawnBase(p, i));

  money = settings.money;

  const myIndex = Math.max(0, players.findIndex((p) => p.id === myId));
  const sp = SPAWNS[myIndex % SPAWNS.length];
  cam.focus.set(sp.x, 0, sp.z);
  cam.dist = cam.targetDist = 58;

  matchStart = performance.now();
  revealStartArea();
  net.enterGame(net.myRoom ? net.myRoom.code : 'solo');
  recomputeEnergy();
  renderSidebar();
  updateHud();
  refreshSelection();
  toast(`Partie lancée — ${settings.money.toLocaleString('fr-FR')} $ de départ.`);
}

function spawnBase(player, index) {
  const sp = SPAWNS[index % SPAWNS.length];
  addBuilding({ id: `${player.id}:cc`, type: 'cc', owner: player.id, x: sp.x, z: sp.z, progress: 1 });
}

function backToLobby() {
  mode = 'lobby';
  net.leaveGame();

  for (const id of [...units.keys()]) removeEntity(id);
  for (const id of [...buildings.keys()]) removeEntity(id);
  for (const f of fields.values()) { scene.remove(f.group); disposeTree(f.group); }
  fields.clear();
  units.clear();
  buildings.clear();
  selected.clear();
  players = [];
  aiId = null;
  aiWave = [];
  aiAttacking = false;

  for (const m of markers) scene.remove(m);
  markers.length = 0;

  $('hud').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  renderSidebar();
  refreshSelection();
}

/* ------------------------------------------------------------------- lobby */

function saveProfile() {
  localStorage.setItem('cac.name', profile.name);
  localStorage.setItem('cac.faction', profile.faction);
  localStorage.setItem('cac.color', profile.color);
  localStorage.setItem('cac.colorTouched', profile.colorTouched ? '1' : '0');
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
    const f = factionOf(p.faction);
    meta.textContent = `${f.name} · ${f.tagline}`;
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
  $('settings-panel').classList.toggle('hidden', !room.isHost);
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

  $('btn-start').addEventListener('click', () => {
    const s = readSettings();
    // L'IA doit figurer dans le roster envoyé à tous les clients
    if (s.ai !== 'none' && net.myRoom && !net.myRoom.players.some((p) => p.isAI)) {
      const used = new Set(net.myRoom.players.map((p) => p.faction));
      const f = ['eurasia', 'shadow', 'atlantic'].find((x) => !used.has(x)) || 'eurasia';
      net.myRoom.players.push({
        id: `ai:${net.selfId}`,
        name: `IA ${DIFFICULTY[s.ai].label}`,
        faction: f,
        color: '#ef4444',
        isAI: true
      });
    }
    net.startGame(s);
  });

  $('btn-leave').addEventListener('click', () => {
    net.leaveRoom();
    backToLobby();
  });

  const netSelect = $('in-net');
  const currentNet = new URLSearchParams(location.search).get('net') === 'torrent' ? 'torrent' : 'mqtt';
  netSelect.value = currentNet;
  netSelect.addEventListener('change', () => {
    const url = new URL(location.href);
    if (netSelect.value === 'torrent') url.searchParams.set('net', 'torrent');
    else url.searchParams.delete('net');
    location.href = url.toString();
  });

  renderProfile();
  saveProfile();
}

/* ------------------------------------------------------------ réglages audio */

function setupAudioUI() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('cac.audio') || '{}'); } catch (e) { saved = {}; }

  if (typeof saved.music === 'number') audio.musicVol = saved.music;
  if (typeof saved.sfx === 'number') audio.sfxVol = saved.sfx;
  if (typeof saved.musicOn === 'boolean') audio.musicOn = saved.musicOn;
  if (typeof saved.sfxOn === 'boolean') audio.sfxOn = saved.sfxOn;

  const vm = $('vol-music');
  const vs = $('vol-sfx');
  vm.value = Math.round(audio.musicVol * 100);
  vs.value = Math.round(audio.sfxVol * 100);

  const sync = () => {
    $('mute-music').textContent = audio.musicOn ? '🔊' : '🔇';
    $('mute-music').classList.toggle('off', !audio.musicOn);
    $('mute-sfx').textContent = audio.sfxOn ? '🔊' : '🔇';
    $('mute-sfx').classList.toggle('off', !audio.sfxOn);
  };

  const save = () => localStorage.setItem('cac.audio', JSON.stringify({
    music: audio.musicVol, sfx: audio.sfxVol, musicOn: audio.musicOn, sfxOn: audio.sfxOn
  }));

  vm.addEventListener('input', () => { audio.setMusicVolume(vm.value / 100); save(); });
  vs.addEventListener('input', () => { audio.setSfxVolume(vs.value / 100); save(); });
  $('mute-music').addEventListener('click', () => { audio.setMusicOn(!audio.musicOn); sync(); save(); });
  $('mute-sfx').addEventListener('click', () => { audio.setSfxOn(!audio.sfxOn); sync(); save(); });

  const open = () => { audio.init(); $('settings-modal').classList.remove('hidden'); };
  $('btn-settings-lobby').addEventListener('click', open);
  $('btn-settings-hud').addEventListener('click', open);
  $('btn-close-settings').addEventListener('click', () => $('settings-modal').classList.add('hidden'));

  // Politique navigateur : l'audio ne démarre qu'après un geste utilisateur
  const unlock = () => { audio.init(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);

  sync();
}

function readSettings() {
  return {
    money: parseInt($('set-money').value, 10) || 5000,
    fog: $('set-fog').checked,
    ai: $('set-ai').value
  };
}

function createRoom(isPrivate) {
  if (!profile.name) {
    toast('Choisissez un pseudo avant de créer un salon.');
    $('in-name').focus();
    return;
  }
  net.profile = { name: profile.name, faction: profile.faction, color: profile.color };
  net.createRoom(net.profile, isPrivate);
}

/* ------------------------------------------------------------------- boucle */

let hudAcc = 0;
let fogAcc = 0;
let mmAcc = 0;
let sweepAcc = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  updateCamera(dt);

  if (mode === 'game') {
    updateBuildings(dt);
    updateUnits(dt);
    updateFields(dt);
    updateMarkers(dt);
    updateTracers(dt);
    updateAI(dt);

    syncAcc += dt;
    if (syncAcc >= 0.1) { syncAcc = 0; broadcastState(); }

    fogAcc += dt;
    if (fogAcc >= 0.2) { fogAcc = 0; updateFog(); updateVisibility(); }

    mmAcc += dt;
    if (mmAcc >= 0.15) { mmAcc = 0; drawMinimap(); }

    hudAcc += dt;
    if (hudAcc >= 0.25) { hudAcc = 0; updateHud(); }

    sweepAcc += dt;
    if (sweepAcc >= 1) { sweepAcc = 0; sweepRemote(); }
  }

  renderer.render(scene, camera);
}

/* -------------------------------------------------------------------- boot */

async function boot() {
  setupThree();
  setupFog();
  setupMinimap();
  setupInput();
  bindLobby();
  setupAudioUI();

  net.on('rooms', renderRooms);
  net.on('roster', showWaiting);
  net.on('start', (data) => beginMatch(data.players, data.settings));
  net.on('ents', onRemoteEnts);
  net.on('order', (data) => addMarker(data.x, data.z));
  net.on('harvest', (data) => applyHarvest(data.field, data.amount));
  net.on('hit', (data) => {
    const target = getEntity(data.target);
    if (target && isLocal(target.owner)) applyDamage(target, data.dmg);
  });
  net.on('gamePeers', () => updateHud());
  net.on('joinFailed', (msg) => toast(msg));
  net.on('closed', (msg) => { toast(msg); backToLobby(); });

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
  audio,
  units,
  buildings,
  fields,
  cam,
  get selected() { return [...selected]; },
  get players() { return players; },
  get money() { return money; },
  get scene() { return scene; },
  get settings() { return settings; }
};

boot();
