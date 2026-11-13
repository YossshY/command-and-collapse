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
  createMoveMarker, createSelectionRing, createGhost, createScaffold,
  createBar, setBar
} from './assets.js';
import { Network } from './network.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);

/* Détection tactile : pilote le rendu allégé et les commandes au doigt */
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const IS_PHONE = IS_TOUCH && Math.min(screen.width, screen.height) < 820;

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
let paused = false;
let money = 0;
let energyProd = 0;
let energyUse = 0;
let lowPower = false;
let entitySeq = 0;

let settings = { money: 5000, fog: true, ai: 'none', alwaysBars: true };

const profile = {
  name: localStorage.getItem('cac.name') || '',
  faction: localStorage.getItem('cac.faction') || 'atlantic',
  color: localStorage.getItem('cac.color') || FACTIONS.atlantic.color,
  colorTouched: localStorage.getItem('cac.colorTouched') === '1'
};

/* ------------------------------------------------------------------- three */

let scene, camera, renderer, raycaster, clock, sunLight;
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
let pendingCommand = null;   // 'attackMove' en attente d'un clic

function setupThree() {
  const canvas = $('scene');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_PHONE ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !IS_PHONE;   // ombres coupées sur téléphone
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb9a583);
  scene.fog = new THREE.Fog(0xc0ac86, 230, 520);
  scene.environment = makeEnvironment(renderer);
  scene.environmentIntensity = 0.55;

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);

  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x6b5a42, 1.5));

  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  sunLight = sun;
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
    map: createGroundTexture(IS_PHONE ? 1024 : 2048),
    roughness: 0.95,
    metalness: 0.05,
    envMapIntensity: 0.12      // sans ça l'env map dessine un halo autour de la caméra
  });
  // Jupe de sable : la carte ne flotte plus dans le vide
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE * 6, MAP_SIZE * 6),
    new THREE.MeshStandardMaterial({ color: 0x9c8768, roughness: 1, metalness: 0, envMapIntensity: 0.05 })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.y = -0.08;
  skirt.receiveShadow = true;
  scene.add(skirt);

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
  const rockCount = IS_PHONE ? 22 : 46;
  for (let i = 0; i < rockCount; i++) {
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
  updateOrientationHint();
}

/** Bandeau « paysage » : uniquement en jeu, sur tactile, en portrait */
let rotateDismissed = false;
function updateOrientationHint() {
  const el = $('rotate-hint');
  if (!el) return;
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  el.classList.toggle('hidden', !(mode === 'game' && IS_TOUCH && portrait) || rotateDismissed);
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

  if (pointer.inside && !IS_TOUCH) {
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

  // Le volume d'ombre suit la vue : sinon tout le sol hors du cadre devient noir
  if (sunLight) {
    const R = Math.max(80, cam.dist * 1.35);
    const sc = sunLight.shadow.camera;
    if (sc.right !== R) {
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
      sc.far = R * 3;
      sc.updateProjectionMatrix();
    }
    sunLight.position.set(cam.focus.x + 45, 70, cam.focus.z + 30);
    sunLight.target.position.set(cam.focus.x, 0, cam.focus.z);
    sunLight.target.updateMatrixWorld();
  }

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

    if (e.code === 'Escape' && paused) { setPaused(false); return; }

    // Raccourcis de construction : la lettre affichée sur la carte de l'onglet courant
    if (mode === 'game' && !paused && !placement && !e.ctrlKey && !e.metaKey && !e.altKey && e.key) {
      const k = e.key.toUpperCase();
      if (k.length === 1) {
        const ref = gridRefs.find((r) => r.hotkey === k);
        if (ref) { e.preventDefault(); ref.el.click(); return; }
      }
    }

    if (e.code === 'KeyP' || e.code === 'Space') {
      if (mode === 'game') { e.preventDefault(); togglePause(); }
      return;
    }

    if (paused) return;

    keys.add(e.code);
    if (e.code === 'Escape') {
      if (pendingCommand) { pendingCommand = null; toast('Ordre annulé.'); }
      else if (placement) cancelPlacement();
      else clearSelection();
    }

    // Ordres tactiques (X/C/H : A et S sont pris par la caméra ZQSD)
    if (mode === 'game' && !placement) {
      if (e.code === 'KeyX') {
        if (selected.size) { pendingCommand = 'attackMove'; toast('Attaque-mobile : cliquez une destination.'); }
        return;
      }
      if (e.code === 'KeyC') {
        for (const id of selected) {
          const u = units.get(id);
          if (u && u.owner === myId) orderStop(u);
        }
        if (selected.size) toast('Halte.');
        return;
      }
      if (e.code === 'KeyB') {
        centerOnBase();
        return;
      }
      if (e.code === 'KeyH') {
        for (const id of selected) {
          const u = units.get(id);
          if (u && u.owner === myId) { u.mode = MODE.GUARD; u.home = { x: u.x, z: u.z }; u.target = null; }
        }
        if (selected.size) toast('Garde sur place.');
        return;
      }
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
    if (e.pointerType === 'touch') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    if (drag.active) updateDragBox(e);
    if (placement) updateGhost(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    if (mode !== 'game') return;

    if (e.button === 0) {
      if (pendingCommand) { issuePendingCommand(e.clientX, e.clientY); return; }
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
    if (e.pointerType === 'touch') return;
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

  /* -------- Commandes tactiles (mobile / tablette) */
  const touch = {
    mode: null,          // 'pan' | 'pinch'
    x: 0, y: 0,          // dernier point touché
    startX: 0, startY: 0,
    dist: 0,
    moved: false,
    fired: false,
    timer: null
  };

  const clearTouchTimer = () => {
    if (touch.timer) { clearTimeout(touch.timer); touch.timer = null; }
  };

  // Appui long : équivalent du clic droit (déplacement / assaut)
  const longPress = (x, y) => {
    if (mode !== 'game' || placement) return;
    touch.fired = true;
    if (navigator.vibrate) navigator.vibrate(18);
    issueMoveOrder({ clientX: x, clientY: y });
  };

  canvas.addEventListener('touchstart', (e) => {
    if (mode !== 'game') return;
    e.preventDefault();
    pointer.inside = false;   // pas de défilement au bord au doigt

    if (e.touches.length >= 2) {
      clearTouchTimer();
      touch.mode = 'pinch';
      touch.moved = true;
      const [a, b] = e.touches;
      touch.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      return;
    }

    const t = e.touches[0];
    touch.mode = 'pan';
    touch.x = touch.startX = t.clientX;
    touch.y = touch.startY = t.clientY;
    touch.moved = false;
    touch.fired = false;
    clearTouchTimer();
    touch.timer = setTimeout(() => longPress(touch.startX, touch.startY), 420);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (mode !== 'game') return;
    e.preventDefault();

    if (touch.mode === 'pinch' && e.touches.length >= 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (touch.dist > 0 && d > 0) {
        cam.targetDist = THREE.MathUtils.clamp(cam.targetDist * (touch.dist / d), 18, 170);
      }
      touch.dist = d;
      return;
    }

    if (touch.mode !== 'pan' || e.touches.length !== 1) return;
    const t = e.touches[0];

    if (!touch.moved && Math.hypot(t.clientX - touch.startX, t.clientY - touch.startY) > 10) {
      touch.moved = true;
      clearTouchTimer();
    }
    if (touch.fired) return;

    if (touch.moved) {
      // Le décor suit le doigt
      const k = cam.dist * 0.0013;
      cam.focus.x -= (t.clientX - touch.x) * k;
      cam.focus.z -= (t.clientY - touch.y) * k / Math.sin(cam.pitch);
    }

    touch.x = t.clientX;
    touch.y = t.clientY;
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (mode !== 'game') return;
    e.preventDefault();
    clearTouchTimer();

    // Un doigt qui se pose pendant qu'un autre est déjà là : on continue
    if (e.touches.length > 0) return;

    const wasTap = !touch.moved && !touch.fired;
    touch.mode = null;

    if (wasTap) {
      if (pendingCommand) { issuePendingCommand(touch.startX, touch.startY); return; }
      if (placement) { tryPlace(touch.startX, touch.startY); return; }
      clickSelect(touch.startX, touch.startY, false);
    }
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

/** Coordonnées écran d'une entité (projection propre, matrices resynchronisées) */
function projectToScreen(e) {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const v = new THREE.Vector3(e.x, (e.alt || 0) + 1, e.z).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v.y * 0.5 + 0.5) * window.innerHeight
  };
}

/** Raycast exact : renvoie l'entité sous le pixel, ou null */
function pickAt(x, y) {
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

/* Anneaux de sondage pour le doigt : une unité fait 7 px à zoom moyen */
const PICK_RINGS = [12, 22, 32, 44];
const PICK_OFFSETS = [];
for (const r of PICK_RINGS) {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    PICK_OFFSETS.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
}

/**
 * Sélection avec tolérance : au doigt (radius > 0), si le pixel exact ne touche
 * rien on sonde autour et on garde l'entité la plus proche du doigt.
 */
function pickEntity(x, y, radius = 0) {
  const exact = pickAt(x, y);
  if (exact || radius <= 0) return exact;

  let best = null;
  let bestD = Infinity;

  for (const [dx, dy] of PICK_OFFSETS) {
    if (Math.hypot(dx, dy) > radius) continue;
    const id = pickAt(x + dx, y + dy);
    if (!id || id === best) continue;

    const e = getEntity(id);
    if (!e) continue;

    const p = projectToScreen(e);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = id; }
  }

  return best;
}

/* Double-clic / double-tap : sélectionne tous les frères du même type à l'écran */
let lastClick = { t: 0, x: 0, y: 0, id: null };

function clickSelect(x, y, additive) {
  const id = pickEntity(x, y, IS_TOUCH ? 34 : 0);

  const now = performance.now();
  const isDouble = now - lastClick.t < 340
    && Math.hypot(x - lastClick.x, y - lastClick.y) < 26
    && id && id === lastClick.id;
  lastClick = { t: now, x, y, id };

  if (!additive) clearSelection();
  if (!id) return;

  const e = getEntity(id);
  if (!e || e.owner !== myId) return;

  // Double appui : tout le même modèle visible à l'écran
  if (isDouble && e.kind === 'unit') {
    let n = 0;
    for (const u of units.values()) {
      if (u.owner !== myId || u.def.name !== e.def.name) continue;
      selected.add(u.id);
      if (u.ring) u.ring.visible = true;
      n++;
    }
    if (n > 1) toast(`${n} × ${e.def.name}`);
    audio.sfx('select');
    refreshSelection();
    return;
  }

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
  renderBuildGrid();
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
  renderBuildGrid();
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

  const isAir = def.shape === 'aircraft';
  const alt = isAir ? 9 : 0;

  const ring = makeRing(def.shape === 'infantry' || def.shape === 'infantry-at' ? 1.6 : 2.2, 0x8ef7b0);
  ring.position.y = -alt + 0.15;
  mesh.add(ring);

  // Avions : ombre portée au sol pour garder la lisibilité
  if (isAir) {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -alt + 0.07;
    mesh.add(shadow);
  }

  const small = def.shape === 'infantry' || def.shape === 'infantry-at';
  const barW = small ? 1.25 : 1.9;
  const barY = small ? 1.75 : 2.35;

  const bar = createBar({ width: barW, height: 0.18 });
  bar.position.y = barY;
  bar.visible = false;
  mesh.add(bar);

  // Collecteurs : barre de cargaison / progression de récolte
  let carryBar = null;
  if (def.role === 'récolte') {
    carryBar = createBar({ width: barW, height: 0.09, color: 0xfbbf24 });
    carryBar.position.y = barY - 0.24;
    carryBar.visible = false;
    mesh.add(carryBar);
  }

  scene.add(mesh);

  const unit = {
    id, kind: 'unit', type, owner, faction, def, mesh, ring, bar, carryBar,
    alt, y: isAir ? 1.4 : 0, landed: isAir,
    pad: isAir ? { x, z } : null, orbit: 0,
    ammoMax: isAir ? (def.ammo || AMMO_MAX) : 0, ammo: isAir ? (def.ammo || AMMO_MAX) : 0,
    loiterPoint: null, rearmT: 0,
    mode: MODE.GUARD, home: { x, z }, dest: null, orderTarget: null,
    x, z, ry,
    hp: hp == null ? def.hp : hp,
    maxHp: def.hp,
    target: null,
    state: 'idle',
    cd: Math.random() * 0.5,
    carry: 0,
    carryMax: HARVEST_LOAD,
    harvestT: 0,
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

  const bar = createBar({ width: Math.max(def.w, def.d) * 0.78, height: 0.3 });
  bar.position.y = def.h + 0.9;
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
  renderBuildGrid();
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

  // Un aéronef est rattaché à l'aérodrome qui l'a produit
  if (u.alt) {
    u.pad = { x: b.x, z: b.z };
    u.home = { x: b.x, z: b.z };
  }

  if (b.rally) orderMove(u, b.rally.x, b.rally.z, false);
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
  // Ordre manuel en cours : on attend l'arrivée avant de reprendre le cycle
  if (u.state === 'move') {
    if (!u.target) { u.state = 'idle'; u.fieldId = null; }
    return;
  }

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

function findTarget(u, explicitRange) {
  const range = explicitRange || u.def.range || 0;
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

/** Ramène un angle dans [-π, π] */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Oriente le fût vers la cible sans toucher au châssis.
 * Un char en mouvement garde son cap et pivote seulement sa tourelle.
 */
function aimTurret(u, dt) {
  const turret = u.mesh.userData && u.mesh.userData.turret;
  if (!turret) return;

  let t = u.orderTarget ? getEntity(u.orderTarget) : null;
  if (t && Math.hypot(t.x - u.x, t.z - u.z) > (u.def.range || 0) * 1.25) t = null;
  if (!t) t = findTarget(u, (u.def.range || 8) * 1.15);

  if (t) {
    const want = wrapAngle(Math.atan2(t.x - u.x, t.z - u.z) - u.ry);
    turret.rotation.y += wrapAngle(want - turret.rotation.y) * Math.min(1, dt * 9);
  } else {
    // Sans cible le fût revient dans l'axe du châssis
    turret.rotation.y += wrapAngle(-turret.rotation.y) * Math.min(1, dt * 2.5);
  }
}

function updateCombat(u, dt) {
  if (!u.def.dmg) return;
  aimTurret(u, dt);
  if (u.alt && u.ammo <= 0) return;   // plus de munitions : il rentre se réarmer
  u.cd -= dt;
  if (u.cd > 0) return;

  // La cible désignée à la main passe avant l'acquisition automatique
  let target = null;
  if (u.orderTarget) {
    const t = getEntity(u.orderTarget);
    if (t && Math.hypot(t.x - u.x, t.z - u.z) <= (u.def.range || 0)) target = t;
  }
  if (!target) target = findTarget(u);
  if (!target) return;

  u.cd = u.def.cd;
  if (u.alt) u.ammo -= 1;

  // Un aéronef garde son cap de vol ; un blindé à tourelle ne pivote que son fût
  const hasTurret = u.mesh.userData && u.mesh.userData.turret;
  if (!u.alt && !hasTurret) {
    u.ry = Math.atan2(target.x - u.x, target.z - u.z);
    u.mesh.rotation.y = u.ry;
  }

  spawnTracer(u, target, u.alt ? u.alt + 1 : 1.2);
  if (performance.now() - lastShotSfx > 70) { lastShotSfx = performance.now(); audio.sfx('shot'); }

  if (isLocal(target.owner)) {
    applyDamage(target, u.def.dmg);
  } else {
    net.sendHit({ target: target.id, dmg: u.def.dmg });
  }
}

let lastShotSfx = 0;

function spawnTracer(from, to, fromY = 1.2) {
  const a = new THREE.Vector3(from.x, fromY, from.z);
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

  // Un aéronef posé décolle dès qu'il est touché
  if (entity.kind === 'unit' && entity.alt && entity.landed) entity.landed = false;

  // Une unité en garde riposte (poursuite limitée) au lieu de rester passive
  if (entity.hp > 0 && entity.kind === 'unit' && entity.mode === MODE.GUARD) {
    entity.mode = MODE.GUARD_RETALIATE;
    entity.home = { x: entity.x, z: entity.z };
  }

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
    r.visible = isVisibleToMe(r.position.x, r.position.z, 0);
  }
  for (const f of fields.values()) {
    f.group.visible = isVisibleToMe(f.def.x, f.def.z, 0);
  }
}

/* ------------------------------------------------------------------ minimap */

let mmCtx = null;
let mmMask = null;
let mmMaskCtx = null;

function setupMinimap() {
  mmCtx = $('minimap').getContext('2d');
  mmMask = document.createElement('canvas');
  mmMask.width = 200;
  mmMask.height = 200;
  mmMaskCtx = mmMask.getContext('2d');
}

function drawMinimap() {
  if (!mmCtx) return;
  const S = 200;
  const k = S / MAP_SIZE;
  const px = (x) => (x + MAP_SIZE / 2) * k;

  // Sol sable
  mmCtx.fillStyle = '#6b5a42';
  mmCtx.fillRect(0, 0, S, S);

  // Routes des bases vers le centre
  mmCtx.strokeStyle = 'rgba(42, 36, 28, 0.55)';
  mmCtx.lineWidth = 2.5;
  for (const sp of SPAWNS) {
    mmCtx.beginPath();
    mmCtx.moveTo(px(sp.x), px(sp.z));
    mmCtx.lineTo(S / 2, S / 2);
    mmCtx.stroke();
  }
  mmCtx.fillStyle = 'rgba(42, 36, 28, 0.45)';
  mmCtx.beginPath();
  mmCtx.arc(S / 2, S / 2, 14 * k + 4, 0, Math.PI * 2);
  mmCtx.fill();

  // Quadrillage tactique
  mmCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  mmCtx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const q = (S / 6) * i;
    mmCtx.beginPath(); mmCtx.moveTo(q, 0); mmCtx.lineTo(q, S); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(0, q); mmCtx.lineTo(S, q); mmCtx.stroke();
  }

  // Zones non explorées
  if (settings.fog && exploredCanvas && mmMaskCtx) {
    mmMaskCtx.globalCompositeOperation = 'source-over';
    mmMaskCtx.fillStyle = '#080b0f';
    mmMaskCtx.fillRect(0, 0, S, S);
    mmMaskCtx.globalCompositeOperation = 'destination-out';
    mmMaskCtx.drawImage(exploredCanvas, 0, 0, S, S);
    mmCtx.drawImage(mmMask, 0, 0);
  }

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
  mmCtx.strokeStyle = 'rgba(79, 216, 236, 0.85)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(
    px(cam.focus.x - halfW), px(cam.focus.z - halfH),
    halfW * 2 * k, halfH * 2 * k
  );
}

/* ---------------------------------------------------------------------- HUD */

/* ------------------------------------------------------- barres d'état 3D */

const _camQ = new THREE.Quaternion();
const _parQ = new THREE.Quaternion();

/** Oriente une barre face à la caméra, quelle que soit la rotation du parent. */
function faceBar(bar, parent) {
  parent.getWorldQuaternion(_parQ);
  _parQ.invert();
  bar.quaternion.copy(_parQ.multiply(camera.quaternion));
}

/** Vert > 60 %, orange 30-60 %, rouge < 30 % — comme dans C&C. */
function hpColor(ratio) {
  if (ratio > 0.6) return 0x4ade80;
  if (ratio > 0.3) return 0xfbbf24;
  return 0xf87171;
}

function updateBars() {
  const always = settings.alwaysBars !== false;

  for (const u of units.values()) {
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 0;
    // Les barres ennemies n'apparaissent que si l'unité est touchée ou sélectionnée
    const show = (always && isLocal(u.owner)) || selected.has(u.id) || ratio < 0.999;
    u.bar.visible = show;
    if (show) {
      setBar(u.bar, ratio, hpColor(ratio));
      faceBar(u.bar, u.mesh);
    }

    if (u.carryBar) {
      let p = 0;
      let col = 0xfbbf24;
      if (u.state === 'harvesting') {
        p = Math.min(1, u.harvestT / HARVEST_TIME);
        col = 0x38bdf8;
      } else if (u.state === 'toRefinery') {
        p = u.carry / u.carryMax;
        col = 0xfbbf24;
      }
      const showCarry = p > 0.002 && (always || selected.has(u.id) || u.state === 'harvesting');
      u.carryBar.visible = showCarry;
      if (showCarry) {
        setBar(u.carryBar, p, col);
        faceBar(u.carryBar, u.mesh);
      }
    }
  }

  for (const b of buildings.values()) {
    const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 0;
    const building = !b.built;
    const show = building || (always && isLocal(b.owner)) || selected.has(b.id) || ratio < 0.999;
    b.bar.visible = show;
    if (!show) continue;

    if (building) setBar(b.bar, b.progress, 0xfbbf24);
    else setBar(b.bar, ratio, hpColor(ratio));

    // Le bâtiment en construction est mis à l'échelle : on compense sur la barre
    b.bar.scale.y = 1 / Math.max(0.05, b.mesh.scale.y);
    faceBar(b.bar, b.mesh);
  }
}

function updateHud() {
  const cash = Math.floor(money);
  $('hud-money').textContent = cash.toLocaleString('fr-FR');

  const resMoney = $('res-money');
  if (resMoney) resMoney.classList.toggle('low', cash < 300);

  $('power-label').textContent = `${energyProd}/${energyUse}`;
  const ratio = energyUse === 0 ? (energyProd > 0 ? 1 : 0) : Math.min(1, energyProd / energyUse);
  $('power-fill').style.height = `${Math.max(2, ratio * 100)}%`;
  $('power-fill').classList.toggle('bad', lowPower);
  $('power-mini').classList.toggle('alert', lowPower);

  const pv = $('power-value');
  if (pv) pv.textContent = `${Math.round(ratio * 100)}%`;

  const netTag = $('hud-net');
  if (netTag) netTag.textContent = net.strategy === 'torrent' ? 'P2P DIRECT' : 'RELAIS MQTT';

  $('hud-peers').textContent = `${net.gamePeerCount()} allié${net.gamePeerCount() > 1 ? 's' : ''}`;
  refreshBuildGrid();
  renderBuildBar();
}

const STATE_LABEL = {
  idle: 'au repos',
  move: 'en mouvement',
  attack: 'au combat',
  toField: 'vers le gisement',
  harvesting: 'récolte en cours',
  toRefinery: 'retour raffinerie'
};

function cssHp(ratio) {
  if (ratio > 0.6) return '#4ade80';
  if (ratio > 0.3) return '#fbbf24';
  return '#f87171';
}

function hpBarHtml(ratio) {
  return `<div class="sel-bar"><i style="width:${(Math.max(0, Math.min(1, ratio)) * 100).toFixed(1)}%;background:${cssHp(ratio)}"></i></div>`;
}

function singleEntityHtml(e) {
  const ratio = e.maxHp ? e.hp / e.maxHp : 0;
  const rows = [];

  if (e.kind === 'unit') {
    if (e.def.dmg) rows.push(['Dégâts', e.def.dmg]);
    if (e.def.range) rows.push(['Portée', `${e.def.range} m`]);
    if (e.def.speed) rows.push(['Vitesse', e.def.speed]);
    if (e.def.role) rows.push(['Rôle', e.def.role]);
    if (e.def.role === 'récolte') {
      rows.push(['Cargaison', `${Math.round(e.carry)} / ${e.carryMax} $`]);
      rows.push(['État', STATE_LABEL[e.state] || e.state]);
    } else {
      if (e.ammoMax) rows.push(['Munitions', `${Math.max(0, e.ammo)} / ${e.ammoMax}`]);
      rows.push(['Ordre', MODE_LABEL[e.mode] || e.mode]);
    }
  } else {
    if (e.def.energy) rows.push(['Énergie', `${e.def.energy > 0 ? '+' : ''}${e.def.energy} ⚡`]);
    if (!e.built) rows.push(['Chantier', `${Math.round(e.progress * 100)} %`]);
    if (e.queue && e.queue.length) {
      const job = e.queue[0];
      const d = unitDef(e.faction, job.type);
      rows.push(['En cours', `${d ? d.name : job.type} — ${Math.round(job.progress * 100)} %`]);
      if (e.queue.length > 1) rows.push(['File', `${e.queue.length - 1} en attente`]);
    }
    if (e.rally) rows.push(['Ralliement', 'défini']);
  }

  return `
    <div class="sel-head">${e.def.name}</div>
    <div class="sel-body">
      <div class="sel-portrait">${icon(e.def.shape)}</div>
      <div class="sel-info">
        ${hpBarHtml(ratio)}
        <div class="sel-hp">${Math.ceil(e.hp)} / ${e.maxHp} PV</div>
        <div class="sel-stats">${rows.map(([k, v]) => `<span><b>${k}</b> ${v}</span>`).join('')}</div>
      </div>
    </div>`;
}

function updateSelectionPanel() {
  const el = $('hud-selection');
  if (!el) return;

  const ents = [...selected].map(getEntity).filter(Boolean);
  if (!ents.length) {
    el.innerHTML = '<div class="sel-empty">Aucune sélection</div>';
    el.classList.add('is-empty');
    return;
  }
  el.classList.remove('is-empty');

  if (ents.length === 1) {
    el.innerHTML = singleEntityHtml(ents[0]);
    return;
  }

  const counts = new Map();
  let hp = 0;
  let maxHp = 0;
  for (const e of ents) {
    counts.set(e.def.name, (counts.get(e.def.name) || 0) + 1);
    hp += e.hp;
    maxHp += e.maxHp;
  }
  const ratio = maxHp ? hp / maxHp : 0;

  el.innerHTML = `
    <div class="sel-head">${ents.length} unités sélectionnées</div>
    <div class="sel-body">
      <div class="sel-portrait">${icon(ents[0].def.shape)}</div>
      <div class="sel-info">
        ${hpBarHtml(ratio)}
        <div class="sel-hp">${Math.ceil(hp)} / ${maxHp} PV</div>
        <div class="sel-stats">${[...counts.entries()].map(([l, n]) => `<span><b>${n} ×</b> ${l}</span>`).join('')}</div>
      </div>
    </div>`;
}

/* ------------------------------------------- barre de chantiers (bas d'écran) */

let buildBarSig = '';
let buildBarRefs = [];

function renderBuildBar() {
  const el = $('build-bar');
  if (!el) return;

  if (mode !== 'game') {
    el.classList.add('hidden');
    el.textContent = '';
    buildBarSig = '';
    buildBarRefs = [];
    return;
  }

  const items = [];
  for (const b of buildings.values()) {
    if (b.owner !== myId) continue;

    if (!b.built) {
      items.push({
        key: `${b.id}:c`, kind: 'Chantier', name: b.def.name,
        p: b.progress, color: '#fbbf24', extra: ''
      });
    } else if (b.queue && b.queue.length) {
      const job = b.queue[0];
      const def = unitDef(b.faction, job.type);
      items.push({
        key: `${b.id}:p`, kind: 'Production',
        name: def ? def.name : job.type,
        p: job.progress, color: '#38bdf8',
        extra: b.queue.length > 1 ? `+${b.queue.length - 1}` : ''
      });
    }
  }

  if (!items.length) {
    el.classList.add('hidden');
    el.textContent = '';
    buildBarSig = '';
    buildBarRefs = [];
    return;
  }

  el.classList.remove('hidden');
  const sig = items.map((i) => `${i.key}|${i.name}|${i.extra}`).join('~');

  if (sig !== buildBarSig) {
    buildBarSig = sig;
    el.textContent = '';
    buildBarRefs = [];

    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'bb-row';
      row.innerHTML = `
        <span class="bb-kind">${it.kind}</span>
        <span class="bb-name">${it.name}${it.extra ? ` <em>${it.extra}</em>` : ''}</span>
        <span class="bb-track"><i></i></span>
        <span class="bb-pct">0 %</span>`;
      el.appendChild(row);
      buildBarRefs.push({
        fill: row.querySelector('.bb-track i'),
        pct: row.querySelector('.bb-pct')
      });
    }
  }

  for (let i = 0; i < items.length; i++) {
    const ref = buildBarRefs[i];
    if (!ref) continue;
    const pct = Math.max(0, Math.min(1, items[i].p));
    ref.fill.style.width = `${(pct * 100).toFixed(1)}%`;
    ref.fill.style.background = items[i].color;
    ref.pct.textContent = `${Math.round(pct * 100)} %`;
  }
}

/* --------------------------------------------------- icônes SVG (inline) */

const ICONS = {
  power: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  refinery: '<path d="M12 2s-7 8-7 13a7 7 0 0 0 14 0c0-5-7-13-7-13z"/>',
  barracks: '<path d="M12 2 20 5v7c0 5-8 10-8 10S4 17 4 12V5z"/>',
  factory: '<path d="M3 21V9l5 3V9l5 3V5h5v16z"/>',
  airfield: '<path d="M2 13 22 4l-7 9 7 7z"/>',
  research: '<path d="M9 2h6v6l4 10a2 2 0 0 1-2 3H7a2 2 0 0 1-2-3l4-10z"/>',
  turret: '<circle cx="12" cy="12" r="3"/><rect x="11" y="2" width="2" height="5"/><rect x="11" y="17" width="2" height="5"/><rect x="2" y="11" width="5" height="2"/><rect x="17" y="11" width="5" height="2"/>',
  patriot: '<path d="M12 2l4 9v5l-4 6-4-6v-5z"/>',
  collector: '<path d="M3 8h11l4 4v5H3z"/><circle cx="7" cy="19" r="2"/><circle cx="15" cy="19" r="2"/>',
  infantry: '<circle cx="12" cy="5" r="3"/><path d="M6 22v-6l6-3 6 3v6"/>',
  'infantry-at': '<circle cx="12" cy="5" r="3"/><path d="M6 22v-6l6-3 6 3v6"/><rect x="16" y="6" width="6" height="2" rx="1"/>',
  tank: '<rect x="3" y="10" width="14" height="7" rx="1"/><rect x="17" y="12" width="5" height="3"/><circle cx="7" cy="19" r="2"/><circle cx="14" cy="19" r="2"/>',
  'tank-heavy': '<rect x="2" y="9" width="16" height="8" rx="1"/><rect x="18" y="11" width="4" height="4"/><circle cx="6" cy="19" r="2"/><circle cx="14" cy="19" r="2"/>',
  buggy: '<path d="M3 14h12l3-4h3v7H3z"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>',
  artillery: '<path d="M3 18h12v3H3z"/><path d="M6 18l8-12 3 2-8 10z"/>',
  aircraft: '<path d="M12 2c1 0 1.5 1 1.5 2.5V9l7 4v2l-7-2v4l2.5 2v1.5L12 19l-4 1.5V19L10.5 17v-4l-7 2v-2l7-4V4.5C10.5 3 11 2 12 2z"/>',
  'truck-bomb': '<path d="M3 8h10v8H3z"/><path d="M13 11h4l3 3v2h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="16" cy="18" r="2"/>',
  structures: '<path d="M3 21V8l6-4 6 4v13z"/><path d="M15 21V11l6 3v7z"/>',
  defense: '<path d="M12 2 20 5v7c0 5-8 10-8 10S4 17 4 12V5z"/><rect x="11" y="8" width="2" height="7"/>',
  cc: '<path d="M3 21V9l9-6 9 6v12z"/><rect x="10" y="13" width="4" height="8"/>'
};

function icon(name) {
  const path = ICONS[name] || ICONS.structures;
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>`;
}

/* ------------------------------------- grille de construction (façon Generals) */

let gridCat = 'structures';
let gridRefs = [];

/* ---------------------------------------------------------- infobulle de case */

/** Ce bâtiment construit-il déjà cette unité ? */
function hasProducer(type) {
  for (const b of buildings.values()) {
    if (b.owner === myId && b.built && (b.def.produces || []).includes(type)) return true;
  }
  return false;
}

/** Contenu de l'infobulle, recalculé à chaque survol (l'état du jeu évolue) */
function buildTip(it) {
  const d = it.def;
  const lines = [
    ['Coût', `${d.cost.toLocaleString('fr-FR')} $`],
    ['Temps', `${d.time} s`]
  ];

  if (d.hp) lines.push(['Points de vie', `${d.hp}`]);
  if (d.energy) lines.push(['Énergie', `${d.energy > 0 ? '+' : ''}${d.energy} ⚡`]);
  if (d.defense) lines.push(['Défense', `${d.defense.dmg} dégâts · ${d.defense.range} m`]);
  if (d.dmg && !d.defense) lines.push(['Dégâts', `${d.dmg}`]);
  if (d.range && !d.defense) lines.push(['Portée', `${d.range} m`]);
  if (d.speed) lines.push(['Vitesse', `${d.speed}`]);
  if (d.role) lines.push(['Rôle', d.role]);
  if (it.kind === 'unit' && it.fromName) lines.push(['Produit par', it.fromName]);

  let warn = '';
  if (money < d.cost) {
    warn = `Il manque ${Math.ceil(d.cost - money).toLocaleString('fr-FR')} $.`;
  } else if (it.kind === 'unit' && !hasProducer(it.type)) {
    warn = `Aucun bâtiment ne produit cette unité — construis ${it.fromName}.`;
  }

  return `
    <h4>${d.name}</h4>
    ${lines.map(([k, v]) => `<div class="tip-line"><span>${k}</span><b>${v}</b></div>`).join('')}
    ${d.desc ? `<div class="tip-desc">${d.desc}</div>` : ''}
    ${warn ? `<div class="tip-warn">${warn}</div>` : '<div class="tip-key">Clic : lancer</div>'}`;
}

function showCellTip(el) {
  const box = $('cell-tip');
  if (!box || !el._item || IS_TOUCH) return;

  box.innerHTML = buildTip(el._item);
  box.classList.remove('hidden');

  const r = el.getBoundingClientRect();
  const w = box.offsetWidth || 246;
  const h = box.offsetHeight || 150;

  let left = r.left - w - 10;
  if (left < 8) left = r.right + 10;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;

  const top = Math.min(Math.max(8, r.top + r.height / 2 - h / 2), window.innerHeight - h - 8);

  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}

function hideCellTip() {
  const box = $('cell-tip');
  if (box) box.classList.add('hidden');
}

function makeCell(it, onClick, hpRatio = 0) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'build-cell';
  el.setAttribute('aria-label', it.def.name);
  el._item = it;
  el._hotkey = HOTKEY[it.type] || '';
  el.innerHTML = `
    ${el._hotkey ? `<span class="bc-key">${el._hotkey}</span>` : ''}
    <span class="bc-icon">${icon(it.iconName)}</span>
    <span class="bc-name">${it.def.name}</span>
    <span class="bc-meta">$${it.def.cost.toLocaleString('fr-FR')} <span>· ${it.def.time}s</span></span>
    <span class="bc-fill" style="height:0"></span>
    <span class="bc-pct"></span>
    <span class="bc-queue"></span>
    ${hpRatio > 0 ? `<span class="bc-hp"><i style="width:${Math.round(hpRatio * 100)}%"></i></span>` : ''}`;

  el.addEventListener('click', onClick);
  el.addEventListener('mouseenter', () => showCellTip(el));
  el.addEventListener('mouseleave', hideCellTip);

  return {
    el,
    fill: el.querySelector('.bc-fill'),
    pct: el.querySelector('.bc-pct'),
    queue: el.querySelector('.bc-queue')
  };
}

/* Touches de construction : évite ZQSD/WASD (caméra) et X/C/H/B (ordres) */
const HOTKEY = {
  power: 'P', refinery: 'R', barracks: 'E', factory: 'U', airfield: 'F', research: 'I',
  turret: 'T', patriot: 'K',
  vanguard: 'V', javelin: 'J',
  collector: 'L', lynx: 'Y', paladin: 'O', helios: 'G',
  wraith: 'N', faucon: 'M'
};

const TABS = [
  ['structures', 'Bâtiments', 'structures', 'Bât.'],
  ['defense', 'Défense', 'defense', 'Déf.'],
  ['infantry', 'Infanterie', 'infantry', 'Inf.'],
  ['vehicles', 'Véhicules', 'tank', 'Véh.'],
  ['air', 'Aviation', 'aircraft', 'Air']
];

function unitCat(def) {
  if (def.shape === 'aircraft') return 'air';
  if (def.shape === 'infantry' || def.shape === 'infantry-at') return 'infantry';
  return 'vehicles';
}

/** Unités produisibles par la faction, avec le bâtiment qui les fabrique. */
function producibleUnits(factionId) {
  const f = factionOf(factionId);
  const out = [];
  const seen = new Set();

  for (const [bid, bdef] of Object.entries(f.buildings)) {
    for (const t of (bdef.produces || [])) {
      if (seen.has(t)) continue;
      seen.add(t);
      const udef = f.units[t];
      if (!udef) continue;
      out.push({ type: t, def: udef, from: bid, fromName: bdef.name });
    }
  }
  return out;
}

/** Contenu d'un onglet : bâtiments ou unités. */
function tabItems(cat) {
  if (cat === 'structures' || cat === 'defense') {
    return buildableList(profile.faction)
      .filter((d) => (cat === 'defense' ? !!d.defense : !d.defense))
      .map((d) => ({
        kind: 'building',
        type: d.id,
        def: d,
        iconName: d.shape,
        cost: d.cost,
        title: `${d.name} — ${d.cost} $ · ${d.time}s` +
          (d.energy ? ` · ${d.energy > 0 ? '+' : ''}${d.energy}⚡` : '') +
          (d.defense ? ` · ${d.defense.dmg} dégâts / ${d.defense.range} m` : '') +
          (d.desc ? ` · ${d.desc}` : '')
      }));
  }

  return producibleUnits(profile.faction)
    .filter((u) => unitCat(u.def) === cat)
    .map((u) => ({
      kind: 'unit',
      type: u.type,
      def: u.def,
      from: u.from,
      fromName: u.fromName,
      iconName: u.def.shape,
      cost: u.def.cost,
      title: `${u.def.name} — ${u.def.cost} $ · ${u.def.time}s · ${u.fromName}` +
        (u.def.role ? ` · ${u.def.role}` : '')
    }));
}

function renderTabs() {
  const el = $('build-tabs');
  if (!el) return;
  el.textContent = '';

  const avail = TABS.filter(([cat]) => tabItems(cat).length > 0);
  if (!avail.some(([cat]) => cat === gridCat)) {
    gridCat = avail.length ? avail[0][0] : 'structures';
  }

  for (const [cat, label, ic, short] of avail) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab' + (gridCat === cat ? ' active' : '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = `${icon(ic)}<span>${short}</span>`;
    b.addEventListener('click', () => {
      if (gridCat === cat) return;
      gridCat = cat;
      audio.sfx('click');
      renderBuildGrid();
    });
    el.appendChild(b);
  }

  const hint = $('cat-hint');
  if (hint) {
    const cur = TABS.find(([c]) => c === gridCat);
    hint.textContent = cur ? cur[1] : '';
  }
}

function renderBuildGrid() {
  const grid = $('build-grid');
  if (!grid) return;
  hideCellTip();          // le survol ne se redéclenche pas après un changement d'onglet
  grid.textContent = '';
  gridRefs = [];
  if (mode !== 'game') return;

  renderTabs();

  const items = tabItems(gridCat);
  const maxHp = Math.max(1, ...items.map((i) => i.def.hp || 0));

  for (const it of items) {
    const cell = makeCell(it, () => {
      hideCellTip();
      if (it.kind === 'building') {
        audio.sfx('click');
        startPlacement(it.type);
      } else {
        queueUnitAnywhere(it.type);
      }
    }, (it.def.hp || 0) / maxHp);
    grid.appendChild(cell.el);
    gridRefs.push({ ...cell, ...it, hotkey: cell.el._hotkey });
  }

  refreshBuildGrid();
}

/** File d'attente vers le premier bâtiment construit qui produit ce type. */
function queueUnitAnywhere(type) {
  const def = unitDef(profile.faction, type);
  if (!def) return;

  let producer = null;
  for (const b of buildings.values()) {
    if (b.owner !== myId || !b.built) continue;
    if (b.def.produces && b.def.produces.includes(type)) { producer = b; break; }
  }

  if (!producer) {
    const f = factionOf(profile.faction);
    const need = Object.values(f.buildings).find((bd) => (bd.produces || []).includes(type));
    toast(need ? `Nécessite : ${need.name}.` : 'Aucun bâtiment ne produit cette unité.');
    audio.sfx('error');
    return;
  }

  queueUnit(producer, type);
  renderBuildGrid();
}

function refreshBuildGrid() {
  for (const r of gridRefs) {
    if (r.kind === 'building') {
      r.el.disabled = false;
      r.el.classList.toggle('locked', money < r.def.cost);

      let site = null;
      for (const b of buildings.values()) {
        if (b.owner === myId && b.type === r.type && !b.built) { site = b; break; }
      }
      r.el.classList.toggle('building', !!site);
      if (site) {
        const p = Math.round(site.progress * 100);
        r.fill.style.height = `${p}%`;
        r.pct.textContent = `${p}%`;
      } else {
        r.fill.style.height = '0';
        r.pct.textContent = '';
      }
      r.queue.textContent = '';
      continue;
    }

    let producer = null;
    for (const b of buildings.values()) {
      if (b.owner !== myId || !b.built) continue;
      if (b.def.produces && b.def.produces.includes(r.type)) { producer = b; break; }
    }

    r.el.disabled = false;
    r.el.classList.toggle('locked', !producer || money < r.def.cost || producer.queue.length >= 5);

    const job = producer ? producer.queue.find((j) => j.type === r.type) : null;
    if (job) {
      const p = Math.round(job.progress * 100);
      r.fill.style.height = `${p}%`;
      r.pct.textContent = `${p}%`;
    } else {
      r.fill.style.height = '0';
      r.pct.textContent = '';
    }

    const n = producer ? producer.queue.filter((j) => j.type === r.type).length : 0;
    r.queue.textContent = n > 1 ? `×${n}` : '';
    r.el.classList.toggle('has-queue', n > 1);
  }
}

/* -------------------------------------------------------------------- pause */

function canPause() {
  return mode === 'game' && settings.ai !== 'none' && net.gamePeerCount() === 0;
}

function setPaused(v) {
  if (mode !== 'game') return;
  if (v && !canPause()) {
    toast("Pause disponible uniquement en escarmouche contre l'IA.");
    return;
  }
  paused = v;
  if (paused) keys.clear();
  $('pause-overlay').classList.toggle('hidden', !paused);
  $('btn-pause').classList.toggle('active', paused);
  if (paused) audio.sfx('click');
}

function togglePause() { setPaused(!paused); }

/** Recentre la caméra sur le centre de commandement (touche B) */
function centerOnBase() {
  let fallback = null;
  for (const b of buildings.values()) {
    if (b.owner !== myId) continue;
    if (b.type === 'cc') { cam.focus.set(b.x, 0, b.z); return; }
    if (!fallback) fallback = b;
  }
  if (fallback) cam.focus.set(fallback.x, 0, fallback.z);
}

function bindHud() {
  $('btn-home').addEventListener('click', centerOnBase);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', () => setPaused(false));
  $('btn-pause-settings').addEventListener('click', () => $('settings-modal').classList.remove('hidden'));
  $('btn-pause-quit').addEventListener('click', () => { setPaused(false); backToLobby(); });
  $('btn-help').addEventListener('click', () => $('help-modal').classList.remove('hidden'));
  $('btn-close-help').addEventListener('click', () => $('help-modal').classList.add('hidden'));
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
        orderMove(u, target.x + (Math.random() - 0.5) * 8, target.z + (Math.random() - 0.5) * 8, true);
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
          // Une unité parvenue à destination repart en attaque-mobile
          if (u.mode === MODE.GUARD || u.mode === MODE.IDLE || u.mode === MODE.GUARD_RETALIATE) {
            orderMove(u, target.x + (Math.random() - 0.5) * 10, target.z + (Math.random() - 0.5) * 10, true);
          }
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

/* --------------------------------------------------------- modes d'unité */

const MODE = {
  IDLE: 'idle',
  GUARD: 'guard',
  GUARD_RETALIATE: 'guardRetaliate',
  MOVE_TO: 'moveTo',
  ATTACK_MOVE: 'attackMove',
  ATTACK_OBJECT: 'attackObject',
  LOITER: 'loiter',
  REARM: 'rearm'
};

const AMMO_MAX = 6;       // munitions par sortie
const REARM_TIME = 6;     // secondes de rechargement au sol
const LOITER_RADIUS = 11; // rayon de la ronde au-dessus d'un point

const MODE_LABEL = {
  idle: 'au repos',
  guard: 'en garde',
  guardRetaliate: 'garde riposte',
  moveTo: 'en déplacement',
  attackMove: 'attaque-mobile',
  attackObject: 'assaut',
  loiter: 'ronde',
  rearm: 'réarmement'
};

/** Distance d'arrêt devant une cible : on tire, on ne monte pas dessus. */
function stopDistance(u) {
  return Math.max(1.4, (u.def.range || 8) * 0.8);
}

function faceTowards(u, t, dt) {
  u.ry = lerpAngle(u.ry, Math.atan2(t.x - u.x, t.z - u.z), 1 - Math.exp(-dt * 10));
}

/** Ordre de déplacement (ou d'attaque-mobile) vers un point. */
function orderMove(u, x, z, attackMove) {
  u.target = { x, z };
  u.dest = { x, z };
  u.orderTarget = null;
  // Un aéronef garde sa piste comme point d'attache, quoi qu'on lui dise
  if (!u.alt) u.home = { x, z };
  u.mode = attackMove ? MODE.ATTACK_MOVE : MODE.MOVE_TO;
}

/** Ordre d'assaut sur une entité : on la poursuit jusqu'à sa destruction. */
function orderAttack(u, id) {
  u.orderTarget = id;
  u.target = null;
  u.dest = null;
  u.mode = MODE.ATTACK_OBJECT;
}

/** Halte : on tient la position atteinte (garde sur place). */
function orderStop(u) {
  u.target = null;
  u.dest = null;
  u.orderTarget = null;
  u.mode = MODE.GUARD;
  if (!u.alt) u.home = { x: u.x, z: u.z };
  if (u.def.role === 'récolte') u.state = 'idle';
}

/**
 * Intelligence d'une unité, calquée sur AIUpdate.cpp de Generals :
 * un MODE explicite pilote le déplacement, le combat ne fait qu'ouvrir le feu
 * sur ce qui est à portée. Une unité en garde ne poursuit jamais.
 */
/** Passage en cercle autour d'une cible : un avion ne fait jamais de surplace. */
function orbitAround(u, t, dt, range) {
  u.orbit = (u.orbit || 0) + dt * 0.7;
  const r = Math.max(5, range * 0.62);
  u.target = { x: t.x + Math.cos(u.orbit) * r, z: t.z + Math.sin(u.orbit) * r };
}

/**
 * IA des aéronefs (JetAIUpdate.cpp) : ils volent en permanence, n'atterrissent
 * QUE sur leur piste, et attaquent en passages circulaires.
 */
function updateAircraftAI(u, dt) {
  const range = u.def.range || 10;

  /* -------- Réarmement : au sol, sur sa piste uniquement */
  if (u.mode === MODE.REARM) {
    const pad = u.pad;
    if (!pad) { u.mode = MODE.GUARD; return; }

    if (Math.hypot(pad.x - u.x, pad.z - u.z) > 3) {
      u.landed = false;
      u.target = { x: pad.x, z: pad.z };
      return;
    }

    u.target = null;
    u.landed = true;
    u.rearmT += dt;

    if (u.rearmT >= REARM_TIME) {
      u.rearmT = 0;
      u.ammo = u.ammoMax;
      u.mode = u.loiterPoint ? MODE.LOITER : MODE.GUARD;
      if (u.owner === myId) toast(`${u.def.name} réarmé.`);
    }
    return;
  }

  u.landed = false;

  /* -------- Plus de munitions : retour à la piste */
  if (u.ammo <= 0) {
    u.mode = MODE.REARM;
    u.rearmT = 0;
    u.target = null;
    return;
  }

  /* -------- Assaut : passages circulaires jusqu'à destruction */
  if (u.mode === MODE.ATTACK_OBJECT) {
    const t = u.orderTarget ? getEntity(u.orderTarget) : null;
    if (!t) {
      u.orderTarget = null;
      u.loiterPoint = { x: u.x, z: u.z };
      u.mode = MODE.LOITER;
      u.target = null;
      return;
    }
    if (Math.hypot(t.x - u.x, t.z - u.z) > range * 1.7) u.target = { x: t.x, z: t.z };
    else orbitAround(u, t, dt, range);
    return;
  }

  /* -------- Attaque-mobile */
  if (u.mode === MODE.ATTACK_MOVE) {
    const t = findTarget(u, range * 1.6);
    if (t) {
      if (Math.hypot(t.x - u.x, t.z - u.z) > range * 1.7) u.target = { x: t.x, z: t.z };
      else orbitAround(u, t, dt, range);
      return;
    }
    if (u.dest && Math.hypot(u.dest.x - u.x, u.dest.z - u.z) > 2) {
      u.target = { x: u.dest.x, z: u.dest.z };
      return;
    }
    u.loiterPoint = u.dest ? { x: u.dest.x, z: u.dest.z } : { x: u.x, z: u.z };
    u.dest = null;
    u.orbit = Math.random() * Math.PI * 2;
    u.mode = MODE.LOITER;
    return;
  }

  /* -------- Déplacement : on arrive, puis on TOURNE sur place */
  if (u.mode === MODE.MOVE_TO) {
    if (u.dest && Math.hypot(u.dest.x - u.x, u.dest.z - u.z) > 2) {
      u.target = { x: u.dest.x, z: u.dest.z };
      return;
    }
    u.loiterPoint = u.dest ? { x: u.dest.x, z: u.dest.z } : { x: u.x, z: u.z };
    u.dest = null;
    u.orbit = Math.random() * Math.PI * 2;
    u.mode = MODE.LOITER;
    return;
  }

  /* -------- Ronde : cercle au-dessus du point demandé */
  if (u.mode === MODE.LOITER) {
    const c = u.loiterPoint || u.pad;
    if (!c) { u.mode = MODE.GUARD; return; }

    u.orbit += dt * 0.55;
    u.target = {
      x: c.x + Math.cos(u.orbit) * LOITER_RADIUS,
      z: c.z + Math.sin(u.orbit) * LOITER_RADIUS
    };
    return;
  }

  /* -------- Garde : retour à la piste et posé */
  const pad = u.pad || u.home;
  if (!pad) { u.target = null; return; }

  if (Math.hypot(pad.x - u.x, pad.z - u.z) > 3) {
    u.target = { x: pad.x, z: pad.z };
  } else {
    u.target = null;
    u.landed = true;
  }
}

/**
 * Intelligence d'une unité, calquée sur AIUpdate.cpp de Generals :
 * un MODE explicite pilote le déplacement, le combat ne fait qu'ouvrir le feu
 * sur ce qui est à portée. Une unité en garde ne poursuit jamais.
 */
function updateUnitAI(u, dt) {
  if (u.alt) { updateAircraftAI(u, dt); return; }

  const range = u.def.range || 8;

  switch (u.mode) {
    /* -------- Assaut : poursuite jusqu'à portée, puis arrêt et tir */
    case MODE.ATTACK_OBJECT: {
      const t = u.orderTarget ? getEntity(u.orderTarget) : null;
      if (!t) {
        u.orderTarget = null;
        u.mode = MODE.GUARD;
        u.home = { x: u.x, z: u.z };
        u.target = null;
        break;
      }
      const d = Math.hypot(t.x - u.x, t.z - u.z);
      if (d > stopDistance(u)) u.target = { x: t.x, z: t.z };
      else { u.target = null; faceTowards(u, t, dt); }
      break;
    }

    /* -------- Attaque-mobile : avance vers le point en engageant */
    case MODE.ATTACK_MOVE: {
      const t = findTarget(u, range * 1.5);
      if (t) {
        const d = Math.hypot(t.x - u.x, t.z - u.z);
        if (d > stopDistance(u)) u.target = { x: t.x, z: t.z };
        else { u.target = null; faceTowards(u, t, dt); }
        break;
      }
      if (u.dest && Math.hypot(u.dest.x - u.x, u.dest.z - u.z) > 1.2) {
        u.target = { x: u.dest.x, z: u.dest.z };
      } else {
        u.dest = null;
        u.mode = MODE.GUARD;
        u.home = { x: u.x, z: u.z };
        u.target = null;
      }
      break;
    }

    /* -------- Déplacement simple : on arrive puis on garde */
    case MODE.MOVE_TO: {
      if (u.dest && Math.hypot(u.dest.x - u.x, u.dest.z - u.z) > 0.6) {
        u.target = { x: u.dest.x, z: u.dest.z };
      } else {
        u.dest = null;
        u.mode = MODE.GUARD;
        u.home = { x: u.x, z: u.z };
        u.target = null;
      }
      break;
    }

    /* -------- Garde riposte : engage à portée, revient à son poste */
    case MODE.GUARD_RETALIATE: {
      const t = findTarget(u, range);
      if (t) {
        const d = Math.hypot(t.x - u.x, t.z - u.z);
        u.target = d > stopDistance(u) ? { x: t.x, z: t.z } : null;
        if (!u.target) faceTowards(u, t, dt);
      } else if (u.home && Math.hypot(u.home.x - u.x, u.home.z - u.z) > 2) {
        u.target = { x: u.home.x, z: u.home.z };
      } else {
        u.target = null;
      }
      break;
    }

    /* -------- Garde / repos : aucun déplacement volontaire */
    default: {
      u.target = null;
      break;
    }
  }
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

    if (u.def.role === 'récolte') {
      // Le collecteur gère son cycle ; un ordre manuel le met en pause
      if (u.mode === MODE.MOVE_TO || u.mode === MODE.ATTACK_MOVE || u.mode === MODE.ATTACK_OBJECT) {
        updateUnitAI(u, dt);
      } else {
        updateCollector(u, dt);
      }
    } else {
      updateUnitAI(u, dt);
    }

    if (u.target) {
      const dx = u.target.x - u.x;
      const dz = u.target.z - u.z;
      const dist = Math.hypot(dx, dz);

      if (dist < 0.4) {
        u.target = null;
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

    // Altitude lissée : décollage / atterrissage des aéronefs
    const cruise = u.alt || 0;
    const wanted = u.landed ? 1.4 : cruise;
    u.y += (wanted - u.y) * (1 - Math.exp(-dt * 2.2));
    const bob = u.alt && !u.landed ? Math.sin(performance.now() * 0.0016 + u.x * 0.3) * 0.3 : 0;

    u.mesh.position.set(u.x, u.y + bob, u.z);
    u.mesh.rotation.y = u.ry;

    updateCombat(u, dt);
  }
}

function updateBuildings(dt) {
  for (const b of buildings.values()) {
    if (!isLocal(b.owner)) continue;
    updateConstruction(b, dt);
    updateProduction(b, dt);
    updateDefense(b, dt);
  }
}

/** Tourelles et batteries : acquisition de cible, tir, rotation du fût. */
function updateDefense(b, dt) {
  const d = b.def.defense;
  if (!d || !b.built) return;

  b.cd -= dt;
  if (b.cd > 0) return;

  const target = findTarget(b, d.range);
  if (!target) return;

  b.cd = d.cd;

  // Rotation du fût vers la cible
  const spin = b.mesh.userData && b.mesh.userData.spin;
  if (spin) {
    const want = Math.atan2(target.x - b.x, target.z - b.z);
    spin.rotation.y = want;
  }

  spawnTracer(b, target, (b.def.h || 3) * 0.75);
  if (performance.now() - lastShotSfx > 70) { lastShotSfx = performance.now(); audio.sfx('shot'); }

  if (isLocal(target.owner)) applyDamage(target, d.dmg);
  else net.sendHit({ target: target.id, dmg: d.dmg });
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

function issuePendingCommand(cx, cy) {
  const cmd = pendingCommand;
  pendingCommand = null;
  if (cmd !== 'attackMove') return;

  const ids = [...selected].filter((id) => units.has(id));
  if (!ids.length) return;

  const point = groundPoint(cx, cy);
  if (!point) return;

  const targets = formation(point, ids.length);
  ids.forEach((id, i) => {
    const u = units.get(id);
    if (u && u.owner === myId) orderMove(u, targets[i].x, targets[i].z, true);
  });

  addMarker(point.x, point.z);
  audio.sfx('click');
  toast('Attaque-mobile.');
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

  // Clic droit sur une entité ennemie : ordre d'attaque
  const hitId = pickEntity(e.clientX, e.clientY);
  const hit = hitId ? getEntity(hitId) : null;

  if (hit && hit.owner !== myId) {
    for (const id of ids) {
      const u = units.get(id);
      if (!u || u.owner !== myId) continue;
      orderAttack(u, hit.id);
      u.buildTarget = null;
    }
    addMarker(hit.x, hit.z);
    audio.sfx('click');
    toast(`Assaut — ${hit.def.name}.`);
    return;
  }

  const targets = formation(point, ids.length);
  ids.forEach((id, i) => {
    const u = units.get(id);
    if (!u || u.owner !== myId) return;
    orderMove(u, targets[i].x, targets[i].z, false);
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
  settings = Object.assign({ money: 5000, fog: true, ai: 'none', alwaysBars: true }, cfg || {});
  myId = net.selfId;
  isHost = !!(net.myRoom && net.myRoom.isHost);
  mode = 'game';

  $('lobby').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('hud').classList.remove('hidden');
  updateOrientationHint();
  $('btn-rotate-close').addEventListener('click', () => {
    rotateDismissed = true;
    updateOrientationHint();
  });

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
  renderBuildGrid();
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

  paused = false;
  $('pause-overlay').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('waiting').classList.add('hidden');
  $('lobby').classList.remove('hidden');
  renderBuildGrid();
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
  const unlock = () => {
    audio.init();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('click', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('click', unlock);
  window.addEventListener('keydown', unlock);

  sync();
}

function readSettings() {
  return {
    money: parseInt($('set-money').value, 10) || 5000,
    fog: $('set-fog').checked,
    alwaysBars: $('set-bars').checked,
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
    if (!paused) {
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

    updateBars();
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
  bindHud();
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
  get settings() { return settings; },
  get isTouch() { return IS_TOUCH; },
  get isPhone() { return IS_PHONE; },

  /* Accès de test/debug : reproduit ce que font la souris et le clavier. */
  debug: {
    select(ids) {
      clearSelection();
      for (const id of ids) {
        const e = getEntity(id);
        if (!e) continue;
        selected.add(id);
        if (e.ring) e.ring.visible = true;
      }
      refreshSelection();
      return [...selected];
    },
    attack(id) {
      for (const k of selected) {
        const u = units.get(k);
        if (u && u.owner === myId) orderAttack(u, id);
      }
      return [...selected];
    },
    move(x, z) {
      for (const k of selected) {
        const u = units.get(k);
        if (u && u.owner === myId) orderMove(u, x, z, false);
      }
      return [...selected];
    },
    spawn(type, x, z, owner) {
      const o = owner || myId;
      const id = `${o}:dbg${++entitySeq}`;
      addUnit({ id, type, owner: o, x: x || 0, z: z || 0 });
      return id;
    },
    money(v) {
      money = v;
      updateHud();
      return money;
    },
    /* Pose un bâtiment immédiatement (tests, maquettes) */
    building(type, x, z, owner = myId) {
      const id = `${owner}:dbgB${++entitySeq}`;
      return addBuilding({ id, type, owner, x, z }).id;
    },

    /* Sonde le raycast : utile pour vérifier qu'un clic touche bien sa cible */
    ray(x, y) {
      raycaster.setFromCamera(ndcFromClient(x, y), camera);
      const meshes = [];
      for (const u of units.values()) meshes.push(u.mesh);
      for (const b of buildings.values()) meshes.push(b.mesh);
      const hits = raycaster.intersectObjects(meshes, true);
      return {
        ndc: ndcFromClient(x, y).toArray().map((v) => +v.toFixed(3)),
        meshes: meshes.length,
        hits: hits.length,
        first: hits[0] ? (hits[0].object.userData.entityId || hits[0].object.parent?.userData?.entityId || null) : null
      };
    },

    screenOf(id) {
      const e = getEntity(id);
      if (!e) return null;
      const p = projectToScreen(e);
      return { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
};

boot();
