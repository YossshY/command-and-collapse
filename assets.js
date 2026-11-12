/* ============================================================================
 * assets.js — Fabrique d'objets 3D (placeholders modulaires)
 * ----------------------------------------------------------------------------
 * CONTRAT DE REMPLACEMENT .glb
 *   Pour chaque fabrique, remplacer le corps par un GLTFLoader en conservant :
 *     - le nom et la signature de la fonction
 *     - le retour d'un THREE.Group posé au sol (y = 0)
 *     - l'avant du véhicule orienté vers +Z
 *     - l'échelle de la définition (w × h × d dans config.js)
 *     - group.userData = { type, spec }
 *   Aucun autre fichier n'a besoin d'être modifié : le jeu n'appelle que
 *   createBuilding(), createUnit(), createCrystalField() et le décor.
 * ========================================================================== */

import * as THREE from 'three';
import { MAP_SIZE, SPAWNS, CRYSTAL_FIELDS } from './config.js';

/* ------------------------------------------------------------------ palette */

const PALETTE = {
  chassis: 0x3a424e,
  metal: 0x6b7480,
  dark: 0x1b2027,
  glass: 0x14232f,
  concrete: 0x8a8578,
  sand: 0x9c8a6a
};

function mat(color, { rough = 0.7, metal = 0.18, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity });
}

function glowMat(color, intensity = 1.4) {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.1
  });
}

function shade(group) {
  group.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return group;
}

/** Boîte positionnée. */
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

/** Cylindre positionné (axe Y par défaut). */
function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  return m;
}

/* ========================================================================== */
/*                                  TERRAIN                                   */
/* ========================================================================== */

/**
 * Texture procédurale du sol : désert / terre battue, routes d'asphalte vers
 * le centre, taches de gravier. Une seule texture 2048² pour toute la carte.
 */
export function createGroundTexture() {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const u = S / MAP_SIZE; // pixels par unité monde

  // Fond sable
  ctx.fillStyle = '#6d5c46';
  ctx.fillRect(0, 0, S, S);

  // Grandes taches de terrain
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 40 + Math.random() * 220;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    if (Math.random() < 0.5) {
      g.addColorStop(0, 'rgba(120,102,78,0.30)');
      g.addColorStop(1, 'rgba(120,102,78,0)');
    } else {
      g.addColorStop(0, 'rgba(78,66,50,0.30)');
      g.addColorStop(1, 'rgba(78,66,50,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grain fin
  for (let i = 0; i < 14000; i++) {
    const v = 60 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v + 30},${v + 18},${v},0.16)`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }

  // Routes d'asphalte : chaque base vers le centre
  const cx = S / 2;
  const cy = S / 2;
  ctx.lineCap = 'round';

  for (const sp of SPAWNS) {
    const x0 = (sp.x + MAP_SIZE / 2) * u;
    const y0 = (sp.z + MAP_SIZE / 2) * u;

    ctx.strokeStyle = 'rgba(60,52,40,0.55)';
    ctx.lineWidth = 4.6 * u;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(cx, cy); ctx.stroke();

    ctx.strokeStyle = '#2b2b30';
    ctx.lineWidth = 3.4 * u;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(cx, cy); ctx.stroke();

    ctx.strokeStyle = 'rgba(220,200,120,0.35)';
    ctx.lineWidth = 0.16 * u;
    ctx.setLineDash([1.6 * u, 1.6 * u]);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(cx, cy); ctx.stroke();
    ctx.setLineDash([]);
  }

  // Place centrale
  ctx.fillStyle = '#2b2b30';
  ctx.beginPath(); ctx.arc(cx, cy, 7 * u, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(220,200,120,0.30)';
  ctx.lineWidth = 0.2 * u;
  ctx.beginPath(); ctx.arc(cx, cy, 5.4 * u, 0, Math.PI * 2); ctx.stroke();

  // Zones de base (terre damée)
  for (const sp of SPAWNS) {
    const x0 = (sp.x + MAP_SIZE / 2) * u;
    const y0 = (sp.z + MAP_SIZE / 2) * u;
    const g = ctx.createRadialGradient(x0, y0, 0, x0, y0, 13 * u);
    g.addColorStop(0, 'rgba(96,84,64,0.85)');
    g.addColorStop(1, 'rgba(96,84,64,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x0, y0, 13 * u, 0, Math.PI * 2); ctx.fill();
  }

  // Gravier autour des champs de cristaux
  for (const f of CRYSTAL_FIELDS) {
    const x0 = (f.x + MAP_SIZE / 2) * u;
    const y0 = (f.z + MAP_SIZE / 2) * u;
    const g = ctx.createRadialGradient(x0, y0, 0, x0, y0, (f.radius + 3) * u);
    g.addColorStop(0, 'rgba(40,44,40,0.55)');
    g.addColorStop(1, 'rgba(40,44,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x0, y0, (f.radius + 3) * u, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Rocher décoratif (blocs anguleux). */
export function createRock() {
  const g = new THREE.Group();
  const m = mat(0x6a6257, { rough: 0.95, metal: 0.05 });
  const n = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.6 + Math.random() * 1.6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), m);
    rock.position.set((Math.random() - 0.5) * 2.4, s * 0.45, (Math.random() - 0.5) * 2.4);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.y = 0.6 + Math.random() * 0.5;
    g.add(rock);
  }
  return shade(g);
}

/* ========================================================================== */
/*                              CHAMPS DE CRISTAUX                            */
/* ========================================================================== */

/**
 * Champ d'Isotope-X : cristaux instanciés + halo au sol.
 * userData.setAlive(n) affiche les n premiers cristaux.
 */
export function createCrystalField(field) {
  const group = new THREE.Group();

  const geo = new THREE.OctahedronGeometry(0.55, 0);
  const material = new THREE.MeshStandardMaterial({
    color: field.color,
    emissive: field.glow,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.15,
    flatShading: true
  });

  const mesh = new THREE.InstancedMesh(geo, material, field.crystals);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const spots = [];
  for (let i = 0; i < field.crystals; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * field.radius;
    spots.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      s: 0.55 + Math.random() * 0.95,
      ry: Math.random() * Math.PI,
      y: 0.28 + Math.random() * 0.35
    });
  }

  const dummy = new THREE.Object3D();
  function setAlive(n) {
    const count = Math.max(0, Math.min(spots.length, Math.round(n)));
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i];
      const alive = i < count;
      dummy.position.set(p.x, alive ? p.y : -60, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.setScalar(alive ? p.s : 0.0001);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  setAlive(field.crystals);

  group.add(mesh);

  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(field.radius * 1.2, 36),
    new THREE.MeshBasicMaterial({ color: field.glow, transparent: true, opacity: 0.13, depthWrite: false })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.04;
  group.add(halo);

  group.position.set(field.x, 0, field.z);
  group.userData = { setAlive, fieldId: field.id };
  return group;
}

/* ========================================================================== */
/*                                 BÂTIMENTS                                  */
/* ========================================================================== */

function bCC(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.15 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const glow = glowMat(0x9be7ff, 1.6);

  g.add(box(7, 0.5, 7, dark, 0, 0.25, 0));
  g.add(box(5.4, 1.8, 5.4, body, 0, 1.4, 0));
  g.add(box(3.8, 1.2, 3.8, body, 0, 2.9, 0));
  g.add(box(3.2, 0.25, 3.2, metal, 0, 3.6, 0));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.45, 2.4, 0.45, metal, sx * 3.0, 1.2, sz * 3.0));
    }
  }

  for (const [x, z, ry] of [[0, 2.72, 0], [0, -2.72, 0], [2.72, 0, Math.PI / 2], [-2.72, 0, Math.PI / 2]]) {
    const win = box(3.4, 0.55, 0.1, glow, x, 1.6, z);
    win.rotation.y = ry;
    g.add(win);
  }

  g.add(cyl(0.09, 0.09, 2.4, 8, metal, 0, 4.9, 0));
  const pivot = new THREE.Group();
  pivot.position.set(0, 5.9, 0);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  dish.rotation.x = Math.PI * 0.72;
  pivot.add(dish);
  g.add(pivot);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), glow);
  beacon.position.set(0, 6.6, 0);
  g.add(beacon);

  g.userData = { type: 'cc', spin: pivot };
  return shade(g);
}

function bPower(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const core = glowMat(faction === 'shadow' ? 0x22c55e : 0x38bdf8, 1.8);

  g.add(box(5, 0.4, 5, dark, 0, 0.2, 0));
  g.add(box(4.2, 1.0, 4.2, body, 0, 0.9, 0));

  for (const sx of [-1, 1]) {
    g.add(cyl(1.05, 1.35, 2.6, 14, metal, sx * 1.15, 2.6, 0));
    g.add(cyl(1.1, 1.1, 0.18, 14, core, sx * 1.15, 3.95, 0));
  }
  g.add(cyl(0.5, 0.5, 1.4, 10, core, 0, 1.9, 1.5));
  g.add(box(0.3, 0.3, 1.6, metal, 0, 1.2, 0.9));

  g.userData = { type: 'power' };
  return shade(g);
}

function bRefinery(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const glow = glowMat(0x4ade80, 1.2);

  g.add(box(6, 0.4, 6, dark, 0, 0.2, 0));
  g.add(box(4.4, 1.6, 4.4, body, 0, 1.2, 0));

  for (const sx of [-1, 1]) {
    g.add(cyl(1.0, 1.0, 2.4, 14, metal, sx * 1.5, 2.4, -1.4));
    g.add(cyl(1.05, 1.05, 0.2, 14, glow, sx * 1.5, 3.65, -1.4));
  }
  g.add(cyl(0.35, 0.45, 2.2, 10, dark, 1.6, 2.6, 1.6));

  const belt = box(1.2, 0.25, 2.2, metal, 0, 1.1, 2.6);
  belt.rotation.x = -0.25;
  g.add(belt);

  g.userData = { type: 'refinery' };
  return shade(g);
}

function bBarracks(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.75, metal: 0.15 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });

  g.add(box(5, 0.35, 5, dark, 0, 0.18, 0));
  g.add(box(4.4, 1.5, 3.4, body, 0, 1.1, -0.4));

  const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4.4, 3, 1), mat(0x4a4f57, { rough: 0.9 }));
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set(1, 1, 0.55);
  roof.position.set(0, 2.1, -0.4);
  g.add(roof);

  g.add(box(1.4, 1.1, 0.12, dark, 0, 0.75, 1.35));
  g.add(cyl(0.06, 0.06, 2.6, 6, metal, 1.9, 1.5, 1.6));
  g.add(box(0.9, 0.55, 0.05, mat(color, { rough: 0.8 }), 2.4, 2.5, 1.6));

  for (let i = 0; i < 4; i++) {
    g.add(box(0.7, 0.3, 0.4, mat(PALETTE.sand, { rough: 1 }), -1.8 + i * 0.75, 0.35, 2.1));
  }

  g.userData = { type: 'barracks' };
  return shade(g);
}

function bFactory(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });

  g.add(box(7, 0.4, 6, dark, 0, 0.2, 0));
  g.add(box(6.4, 2.2, 5.2, body, 0, 1.5, -0.2));

  const roof = box(6.6, 0.3, 5.4, metal, 0, 2.75, -0.2);
  roof.rotation.x = 0.08;
  g.add(roof);

  g.add(box(3.4, 1.8, 0.15, dark, 0, 1.1, 2.45));
  for (const sx of [-1, 1]) g.add(box(0.18, 0.18, 5.6, metal, sx * 2.6, 3.0, -0.2));
  g.add(box(5.4, 0.2, 0.3, metal, 0, 3.0, 1.4));
  for (const sx of [-1, 1]) g.add(cyl(0.28, 0.32, 1.6, 8, dark, sx * 2.2, 3.4, -1.8));

  g.userData = { type: 'factory' };
  return shade(g);
}

function bAirfield(color, faction) {
  const g = new THREE.Group();
  const dark = mat(PALETTE.chassis, { rough: 0.9, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const paint = mat(0xd8d2c0, { rough: 0.9 });

  g.add(box(7, 0.25, 7, dark, 0, 0.12, 0));
  g.add(box(0.5, 0.02, 6.2, paint, 0, 0.26, 0));
  for (let i = -2; i <= 2; i++) {
    g.add(box(1.6, 0.02, 0.18, paint, 0, 0.26, i * 1.3));
  }

  g.add(box(1.6, 2.4, 1.6, body, -2.4, 1.2, -2.4));
  g.add(box(2.0, 0.5, 2.0, mat(PALETTE.glass, { rough: 0.2, metal: 0.5 }), -2.4, 2.6, -2.4));
  g.add(cyl(0.05, 0.05, 1.2, 6, metal, -2.4, 3.4, -2.4));

  g.add(cyl(0.05, 0.05, 1.6, 6, metal, 2.6, 0.9, 2.6));
  const sock = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8, 1, true), mat(0xf97316, { rough: 0.9 }));
  sock.rotation.z = Math.PI / 2;
  sock.position.set(3.1, 1.6, 2.6);
  g.add(sock);

  g.userData = { type: 'airfield' };
  return shade(g);
}

function bResearch(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.65, metal: 0.25 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.35 });
  const glow = glowMat(0x9be7ff, 1.3);

  g.add(box(5, 0.4, 5, dark, 0, 0.2, 0));
  g.add(box(4.2, 1.6, 4.2, body, 0, 1.2, 0));

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  dome.position.y = 2.0;
  g.add(dome);

  const pivot = new THREE.Group();
  pivot.position.set(0, 3.4, 0);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2.4),
    mat(0xd6dde6, { rough: 0.4, metal: 0.4 })
  );
  dish.rotation.x = Math.PI * 0.62;
  dish.position.y = 0.5;
  pivot.add(dish);
  pivot.add(cyl(0.07, 0.07, 1.0, 6, metal, 0, 0.1, 0));
  g.add(pivot);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 8, 32), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.05;
  g.add(ring);

  g.userData = { type: 'research', spin: pivot };
  return shade(g);
}

function bDefenseLight(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  g.add(cyl(1.5, 1.7, 0.5, 12, dark, 0, 0.25, 0));
  g.add(cyl(1.1, 1.3, 1.2, 12, body, 0, 1.1, 0));

  const pivot = new THREE.Group();
  pivot.position.set(0, 1.9, 0);
  pivot.add(cyl(0.75, 0.85, 0.6, 12, body, 0, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = cyl(0.07, 0.07, 1.5, 6, metal, Math.cos(a) * 0.22, 0.1, 0.75);
    b.rotation.x = Math.PI / 2;
    pivot.add(b);
  }
  g.add(pivot);

  g.userData = { type: 'defense-light', spin: pivot };
  return shade(g);
}

function bDefenseHeavy(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  g.add(box(4, 0.5, 4, dark, 0, 0.25, 0));
  g.add(box(3.2, 1.4, 3.2, body, 0, 1.2, 0));

  const pivot = new THREE.Group();
  pivot.position.set(0, 2.2, 0);
  pivot.add(box(2.2, 1.0, 1.4, metal, 0, 0, 0));
  for (let i = 0; i < 4; i++) {
    const tube = cyl(0.16, 0.16, 1.5, 8, dark, -0.75 + (i % 2) * 1.5, 0.25 - Math.floor(i / 2) * 0.5, 0.2);
    tube.rotation.x = Math.PI / 2;
    pivot.add(tube);
  }
  pivot.rotation.x = -0.35;
  g.add(pivot);

  g.userData = { type: 'defense-heavy', spin: pivot };
  return shade(g);
}

function bSupply(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.8, metal: 0.1 });
  const dark = mat(PALETTE.chassis, { rough: 0.9, metal: 0.1 });
  const wood = mat(0x8a6a44, { rough: 0.95 });

  g.add(box(6, 0.3, 6, dark, 0, 0.15, 0));
  g.add(box(3.2, 1.6, 2.6, body, -1.2, 1.1, -1.2));

  const roof = box(3.6, 0.2, 3.0, mat(0x4a4f57, { rough: 0.9 }), -1.2, 2.0, -1.2);
  roof.rotation.z = 0.06;
  g.add(roof);

  for (let i = 0; i < 6; i++) {
    const s = 0.7 + Math.random() * 0.3;
    g.add(box(s, s, s, wood, 1.2 + (i % 3) * 0.9, 0.35 + Math.floor(i / 3) * 0.75, 0.6 + (i % 2) * 0.8));
  }

  const tarp = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x5a6b4a, { rough: 1 }));
  tarp.scale.y = 0.5;
  tarp.position.set(1.6, 0.3, -1.6);
  g.add(tarp);

  g.userData = { type: 'supply' };
  return shade(g);
}

function bTunnel(color, faction) {
  const g = new THREE.Group();
  const earth = mat(0x5a4c3a, { rough: 1 });
  const dark = mat(0x0a0c0f, { rough: 1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.4 });

  const mound = new THREE.Mesh(new THREE.SphereGeometry(1.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), earth);
  mound.scale.y = 0.55;
  g.add(mound);

  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.85, 16), dark);
  hole.rotation.x = -Math.PI / 2;
  hole.position.y = 0.06;
  g.add(hole);

  const hatch = box(1.5, 0.12, 1.5, metal, 0, 0.95, -0.9);
  hatch.rotation.x = -0.5;
  g.add(hatch);

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(box(0.6, 0.28, 0.35, mat(PALETTE.sand, { rough: 1 }), Math.cos(a) * 1.5, 0.2, Math.sin(a) * 1.5));
  }

  g.userData = { type: 'tunnel' };
  return shade(g);
}

function bPalace(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const gold = mat(0xd4a94a, { rough: 0.35, metal: 0.6 });

  g.add(box(6, 0.5, 6, dark, 0, 0.25, 0));
  g.add(box(4.6, 2.0, 4.6, body, 0, 1.5, 0));
  g.add(box(3.2, 1.4, 3.2, body, 0, 3.2, 0));

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  dome.position.y = 3.9;
  g.add(dome);
  g.add(cyl(0.06, 0.06, 1.2, 6, gold, 0, 5.4, 0));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(0.22, 0.22, 2.0, 8, metal, sx * 2.1, 1.0, sz * 2.1));
    }
  }
  for (const sx of [-1, 1]) {
    g.add(box(0.7, 1.4, 0.06, mat(color, { rough: 0.9 }), sx * 2.6, 2.2, 2.4));
  }

  g.userData = { type: 'palace' };
  return shade(g);
}

const BUILDING_FACTORY = {
  cc: bCC,
  power: bPower,
  refinery: bRefinery,
  supply: bSupply,
  barracks: bBarracks,
  factory: bFactory,
  airfield: bAirfield,
  research: bResearch,
  palace: bPalace,
  'defense-light': bDefenseLight,
  'defense-heavy': bDefenseHeavy,
  tunnel: bTunnel
};

/**
 * Fabrique un bâtiment par sa forme.
 * @param {string} shape clé de BUILDING_FACTORY
 * @param {string} color couleur d'équipe
 * @param {string} faction id de faction (variations visuelles)
 */
export function createBuilding(shape, color, faction) {
  const fn = BUILDING_FACTORY[shape] || bBarracks;
  const g = fn(color, faction);
  g.userData = { ...g.userData, shape };
  return g;
}

/* ========================================================================== */
/*                                   UNITÉS                                   */
/* ========================================================================== */

function uBuilder(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.6, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  for (const sx of [-1, 1]) g.add(box(0.45, 0.5, 2.4, dark, sx * 0.72, 0.25, 0));
  g.add(box(1.4, 0.55, 2.2, body, 0, 0.7, 0));
  g.add(box(1.0, 0.6, 0.9, mat(PALETTE.glass, { rough: 0.2, metal: 0.5 }), 0, 1.25, -0.3));
  g.add(box(1.9, 0.7, 0.2, metal, 0, 0.5, 1.35));

  const arm = box(0.16, 0.16, 1.6, metal, 0.5, 1.5, -0.2);
  arm.rotation.x = -0.5;
  g.add(arm);
  g.add(box(0.3, 0.3, 0.3, mat(0xfbbf24, { rough: 0.6 }), 0.5, 1.9, 0.5));

  g.userData = { type: 'builder' };
  return shade(g);
}

function uCollector(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.6, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = cyl(0.42, 0.42, 0.34, 10, dark, sx * 0.85, 0.42, sz * 0.95);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(box(1.7, 0.5, 2.8, dark, 0, 0.6, 0));
  g.add(box(1.6, 1.0, 1.7, body, 0, 1.3, -0.4));
  g.add(box(1.2, 0.5, 0.9, mat(PALETTE.glass, { rough: 0.2, metal: 0.5 }), 0, 1.35, 1.0));

  const scoop = box(1.5, 0.5, 0.7, metal, 0, 0.55, 1.6);
  scoop.rotation.x = 0.35;
  g.add(scoop);

  g.add(box(0.9, 0.25, 0.9, glowMat(0x4ade80, 0.9), 0, 1.85, -0.4));

  g.userData = { type: 'collector' };
  return shade(g);
}

function infantryFigure(color, x, z, ry, tube = false) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.8, metal: 0.1 });
  const dark = mat(0x2a2f37, { rough: 0.9 });
  const skin = mat(0xc9a27a, { rough: 0.9 });

  g.add(cyl(0.16, 0.2, 0.55, 8, dark, 0, 0.28, 0));
  g.add(cyl(0.2, 0.22, 0.5, 8, body, 0, 0.8, 0));

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.position.set(0, 1.15, 0);
  g.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.set(0, 1.2, 0);
  g.add(helmet);

  if (tube) {
    const t = cyl(0.07, 0.07, 1.1, 6, mat(0x4a5058, { rough: 0.6, metal: 0.4 }), 0.18, 0.95, 0.35);
    t.rotation.x = Math.PI / 2;
    g.add(t);
  } else {
    g.add(box(0.08, 0.08, 0.7, mat(0x2a2f37, { rough: 0.7 }), 0.2, 0.9, 0.3));
  }

  g.position.set(x, 0, z);
  g.rotation.y = ry;
  return g;
}

function uInfantry(color, faction) {
  const g = new THREE.Group();
  g.add(infantryFigure(color, -0.35, 0.2, 0.2));
  g.add(infantryFigure(color, 0.35, -0.15, -0.3));
  g.add(infantryFigure(color, 0.05, 0.45, 0.9));
  g.userData = { type: 'infantry' };
  return shade(g);
}

function uInfantryAT(color, faction) {
  const g = new THREE.Group();
  g.add(infantryFigure(color, -0.3, 0.1, 0.1, true));
  g.add(infantryFigure(color, 0.4, -0.2, -0.4, true));
  g.userData = { type: 'infantry-at' };
  return shade(g);
}

function uBuggy(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.6, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = cyl(0.34, 0.34, 0.3, 10, dark, sx * 0.75, 0.34, sz * 0.85);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(box(1.3, 0.3, 2.2, body, 0, 0.55, 0));

  const bar = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 12, Math.PI), metal);
  bar.position.set(0, 0.7, -0.2);
  g.add(bar);

  const gun = cyl(0.07, 0.07, 0.9, 6, metal, 0, 0.95, 0.5);
  gun.rotation.x = Math.PI / 2;
  g.add(gun);
  g.add(box(0.3, 0.3, 0.3, dark, 0, 0.85, 0.1));

  g.userData = { type: 'buggy' };
  return shade(g);
}

function uTank(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.6, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.35 });

  for (const sx of [-1, 1]) {
    g.add(box(0.46, 0.55, 3, dark, sx * 0.82, 0.28, 0));
    for (let i = -1; i <= 1; i++) {
      const w = cyl(0.2, 0.2, 0.5, 10, metal, sx * 0.82, 0.28, i * 0.95);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(box(1.5, 0.55, 2.9, body, 0, 0.75, 0));

  const glacis = box(1.5, 0.45, 0.8, body, 0, 0.62, 1.25);
  glacis.rotation.x = -0.45;
  g.add(glacis);

  for (const sx of [-1, 1]) g.add(box(0.12, 0.3, 2.4, body, sx * 0.78, 0.62, 0));

  g.add(cyl(0.62, 0.76, 0.5, 12, body, 0, 1.25, -0.1));
  g.add(cyl(0.22, 0.22, 0.1, 10, metal, 0.28, 1.52, -0.35));

  const barrel = cyl(0.12, 0.14, 2.6, 10, metal, 0, 1.3, 1.3);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);

  const muzzle = cyl(0.19, 0.19, 0.3, 10, dark, 0, 1.3, 2.5);
  muzzle.rotation.x = Math.PI / 2;
  g.add(muzzle);

  g.add(cyl(0.035, 0.035, 1.0, 6, metal, -0.45, 1.75, -0.6));

  g.userData = { type: 'tank' };
  return shade(g);
}

function uTankHeavy(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.65, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.35 });

  for (const sx of [-1, 1]) {
    g.add(box(0.6, 0.7, 3.6, dark, sx * 1.0, 0.35, 0));
    for (let i = -1; i <= 1; i++) {
      const w = cyl(0.26, 0.26, 0.64, 10, metal, sx * 1.0, 0.35, i * 1.15);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(box(1.9, 0.7, 3.4, body, 0, 0.9, 0));
  g.add(box(1.9, 0.5, 0.9, body, 0, 0.75, 1.5));
  g.add(box(1.7, 0.6, 1.7, body, 0, 1.55, -0.2));

  for (const sx of [-1, 1]) {
    const b = cyl(0.13, 0.15, 2.8, 10, metal, sx * 0.42, 1.6, 1.4);
    b.rotation.x = Math.PI / 2;
    g.add(b);

    const m = cyl(0.2, 0.2, 0.3, 10, dark, sx * 0.42, 1.6, 2.7);
    m.rotation.x = Math.PI / 2;
    g.add(m);
  }
  g.add(cyl(0.05, 0.05, 1.2, 6, metal, -0.7, 2.1, -0.7));

  g.userData = { type: 'tank-heavy' };
  return shade(g);
}

function uArtillery(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.6, metal: 0.2 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });

  for (const sx of [-1, 1]) g.add(box(0.5, 0.5, 2.8, dark, sx * 0.8, 0.25, 0));
  g.add(box(1.5, 0.5, 2.6, body, 0, 0.65, 0));
  g.add(box(1.0, 0.5, 1.2, body, 0, 1.05, -0.3));

  const tube = cyl(0.13, 0.16, 3.4, 10, metal, 0, 1.55, 0.9);
  tube.rotation.x = Math.PI / 2 - 0.22;
  g.add(tube);

  const brake = cyl(0.22, 0.22, 0.35, 10, dark, 0, 1.9, 2.5);
  brake.rotation.x = Math.PI / 2 - 0.22;
  g.add(brake);

  for (const sx of [-1, 1]) g.add(box(0.12, 0.12, 1.0, metal, sx * 0.55, 0.5, -1.2));

  g.userData = { type: 'artillery' };
  return shade(g);
}

function uAircraft(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.45, metal: 0.35 });
  const dark = mat(PALETTE.chassis, { rough: 0.7, metal: 0.2 });
  const glass = mat(PALETTE.glass, { rough: 0.15, metal: 0.6 });

  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 2.2, 6, 10), body);
  fus.rotation.x = Math.PI / 2;
  fus.position.y = 1.6;
  g.add(fus);

  g.add(box(3.4, 0.12, 0.9, body, 0, 1.6, 0.1));
  g.add(box(1.4, 0.1, 0.5, body, 0, 1.6, -1.2));
  g.add(box(0.1, 0.6, 0.5, body, 0, 1.9, -1.2));

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glass);
  cockpit.position.set(0, 1.75, 0.9);
  g.add(cockpit);

  for (const sx of [-1, 1]) {
    const e = cyl(0.18, 0.18, 0.9, 8, dark, sx * 0.9, 1.45, -0.3);
    e.rotation.x = Math.PI / 2;
    g.add(e);
  }
  for (const sx of [-1, 1]) g.add(cyl(0.05, 0.05, 1.2, 6, dark, sx * 0.5, 0.6, 0.2));

  g.userData = { type: 'aircraft', flying: true };
  return shade(g);
}

function uTruckBomb(color, faction) {
  const g = new THREE.Group();
  const body = mat(color, { rough: 0.7, metal: 0.15 });
  const dark = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.4 });
  const hazard = mat(0xf59e0b, { rough: 0.6 });

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = cyl(0.4, 0.4, 0.32, 10, dark, sx * 0.8, 0.4, sz * 0.9);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  }
  g.add(box(1.6, 0.5, 2.8, dark, 0, 0.6, 0));
  g.add(box(1.4, 0.9, 0.9, body, 0, 1.2, 0.9));

  const tank = cyl(0.75, 0.75, 1.8, 14, hazard, 0, 1.35, -0.5);
  tank.rotation.x = Math.PI / 2;
  g.add(tank);

  const band = cyl(0.78, 0.78, 0.12, 14, dark, 0, 1.35, 0.4);
  band.rotation.x = Math.PI / 2;
  g.add(band);

  g.add(box(0.5, 0.5, 0.5, metal, 0, 1.9, -0.5));

  g.userData = { type: 'truck-bomb' };
  return shade(g);
}

const UNIT_FACTORY = {
  builder: uBuilder,
  collector: uCollector,
  infantry: uInfantry,
  'infantry-at': uInfantryAT,
  buggy: uBuggy,
  tank: uTank,
  'tank-heavy': uTankHeavy,
  artillery: uArtillery,
  aircraft: uAircraft,
  'truck-bomb': uTruckBomb
};

/**
 * Fabrique une unité par sa forme.
 * @param {string} shape clé de UNIT_FACTORY
 * @param {string} color couleur d'équipe
 * @param {string} faction id de faction
 */
export function createUnit(shape, color, faction) {
  const fn = UNIT_FACTORY[shape] || uTank;
  const g = fn(color, faction);
  g.userData = { ...g.userData, shape };
  return g;
}

/* ========================================================================== */
/*                              EFFETS / MARQUEURS                            */
/* ========================================================================== */

export function createMoveMarker() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 32),
    new THREE.MeshBasicMaterial({ color: 0x7ef7a0, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);

  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 16),
    new THREE.MeshBasicMaterial({ color: 0x7ef7a0, transparent: true, opacity: 0.8, depthWrite: false })
  );
  dot.rotation.x = -Math.PI / 2;
  g.add(dot);

  g.position.y = 0.06;
  g.userData.life = 0;
  return g;
}

export function createSelectionRing(color = 0x8ef7b0) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.0, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}

/** Aperçu fantôme d'un bâtiment (vert = valide, rouge = bloqué). */
export function createGhost(shape, color, faction) {
  const g = createBuilding(shape, color, faction);
  const ghostMat = new THREE.MeshBasicMaterial({
    color: 0x4ade80, transparent: true, opacity: 0.45, depthWrite: false
  });
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = ghostMat;
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  g.userData.ghostMat = ghostMat;
  g.userData.setValid = (ok) => {
    ghostMat.color.setHex(ok ? 0x4ade80 : 0xef4444);
    ghostMat.opacity = ok ? 0.45 : 0.35;
  };
  return g;
}

/** Échafaudage affiché pendant la construction. */
export function createScaffold(w, h, d) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, transparent: true, opacity: 0.55 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.y = h / 2;
  g.add(mesh);
  return g;
}

/** Barre de vie (fond + remplissage). */
export function createHealthBar() {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.13),
    new THREE.MeshBasicMaterial({ color: 0x0a0c0f, transparent: true, opacity: 0.8, depthWrite: false })
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x4ade80, depthWrite: false })
  );
  fill.position.z = 0.002;
  g.add(bg);
  g.add(fill);
  g.userData.fill = fill;
  return g;
}
