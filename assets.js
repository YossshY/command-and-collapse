/* ============================================================================
 * assets.js — Fabrique d'objets 3D (placeholders modulaires)
 * ----------------------------------------------------------------------------
 * TOUT le visuel des unités est isolé ici. Pour passer aux modèles .glb :
 *   1. importer GLTFLoader (three/addons/loaders/GLTFLoader.js)
 *   2. remplacer le corps de createTank / createDozer / createCommandCenter
 *      par un chargement GLTF, en conservant :
 *        - le nom et la signature de la fonction
 *        - le retour d'un THREE.Group centré au sol (y = 0)
 *        - l'orientation : l'avant du véhicule pointe vers +Z
 *        - l'échelle de UNIT_SPECS (w × h × d)
 *   3. renseigner group.userData = { type, spec } comme ci-dessous.
 * Aucun autre fichier n'a besoin d'être modifié.
 * ========================================================================== */

import * as THREE from 'three';

/* ---------------------------------------------------------------- constantes */

export const MAP_SIZE = 100;

export const FACTIONS = {
  usa:   { id: 'usa',   name: 'USA',   tagline: 'Blindés lourds · soutien aérien', color: '#3b82f6' },
  china: { id: 'china', name: 'Chine', tagline: 'Nombre · artillerie · blindage',  color: '#ef4444' },
  gla:   { id: 'gla',   name: 'GLA',   tagline: 'Vitesse · embuscades · guérilla', color: '#22c55e' }
};

export const TEAM_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#eab308',
  '#a855f7', '#f97316', '#06b6d4', '#ec4899'
];

/** Dimensions de référence (unités monde) + vitesse de déplacement. */
export const UNIT_SPECS = {
  cc:    { type: 'cc',    label: 'Centre de commandement', w: 6,   h: 3,   d: 6,   speed: 0, radius: 3.8 },
  tank:  { type: 'tank',  label: 'Char',                   w: 2,   h: 1,   d: 3,   speed: 9, radius: 1.8 },
  dozer: { type: 'dozer', label: 'Bulldozer',              w: 2.2, h: 1.4, d: 2.6, speed: 7, radius: 1.7 }
};

const PALETTE = {
  chassis: 0x3a424e,
  metal:   0x6b7480,
  dark:    0x1b2027,
  glass:   0x14232f
};

/* ------------------------------------------------------------------ helpers */

function mat(color, { rough = 0.7, metal = 0.18, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity });
}

/** Active ombres portées/reçues sur toute la hiérarchie. */
function shade(group) {
  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/* -------------------------------------------------------------------- chars */

/**
 * Char d'assaut — encombrement 2 × 1 × 3, canon orienté vers +Z.
 * @param {string|number} color couleur d'équipe
 * @returns {THREE.Group}
 */
export function createTank(color) {
  const g = new THREE.Group();
  const body  = mat(color, { rough: 0.6, metal: 0.2 });
  const dark  = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.35 });

  // Chenilles : elles débordent du châssis pour rester lisibles en vue de dessus
  for (const sx of [-1, 1]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.55, 3), dark);
    track.position.set(sx * 0.82, 0.28, 0);
    g.add(track);

    for (let i = -1; i <= 1; i++) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10), metal);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.82, 0.28, i * 0.95);
      g.add(wheel);
    }
  }

  // Châssis
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.9), body);
  hull.position.y = 0.75;
  g.add(hull);

  // Glacis avant incliné
  const glacis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 0.8), body);
  glacis.position.set(0, 0.62, 1.25);
  glacis.rotation.x = -0.45;
  g.add(glacis);

  // Jupes de blindage latérales
  for (const sx of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 2.4), body);
    skirt.position.set(sx * 0.78, 0.62, 0);
    g.add(skirt);
  }

  // Tourelle
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.76, 0.5, 12), body);
  turret.position.set(0, 1.25, -0.1);
  g.add(turret);

  // Trappe chef de char
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10), metal);
  hatch.position.set(0.28, 1.52, -0.35);
  g.add(hatch);

  // Canon (axe +Z)
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.6, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 1.3, 1.3);
  g.add(barrel);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.3, 10), dark);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 1.3, 2.5);
  g.add(muzzle);

  // Antenne
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6), metal);
  antenna.position.set(-0.45, 1.75, -0.6);
  g.add(antenna);

  g.userData = { type: 'tank', spec: UNIT_SPECS.tank };
  return shade(g);
}

/* ---------------------------------------------------------------- bulldozer */

/**
 * Bulldozer de construction — encombrement 2.2 × 1.4 × 2.6, lame vers +Z.
 * @param {string|number} color couleur d'équipe
 * @returns {THREE.Group}
 */
export function createDozer(color) {
  const g = new THREE.Group();
  const body  = mat(color, { rough: 0.65, metal: 0.2 });
  const dark  = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.45, metal: 0.35 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 2.4), body);
  chassis.position.y = 0.75;
  g.add(chassis);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.8, 1.1), mat(PALETTE.glass, { rough: 0.2, metal: 0.6 }));
  cab.position.set(0, 1.45, -0.35);
  g.add(cab);

  // Lame frontale
  const blade = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.25), metal);
  blade.position.set(0, 0.55, 1.45);
  g.add(blade);

  for (const sx of [-0.7, 0.7]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.9), metal);
    arm.position.set(sx, 0.7, 1.0);
    g.add(arm);
  }

  // Roues
  for (const sx of [-1, 1]) {
    for (const sz of [-0.8, 0.8]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.35, 12), dark);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * 0.95, 0.42, sz);
      g.add(wheel);
    }
  }

  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8), metal);
  pipe.position.set(0.6, 1.6, -0.9);
  g.add(pipe);

  g.userData = { type: 'dozer', spec: UNIT_SPECS.dozer };
  return shade(g);
}

/* ------------------------------------------------------ centre de commandement */

/**
 * Centre de commandement — encombrement 6 × 3 × 6, entrée vers +Z.
 * Le radar tourne : le pivot est exposé dans userData.spin.
 * @param {string|number} color couleur d'équipe
 * @returns {THREE.Group}
 */
export function createCommandCenter(color) {
  const g = new THREE.Group();
  const body  = mat(color, { rough: 0.7, metal: 0.15 });
  const dark  = mat(PALETTE.chassis, { rough: 0.85, metal: 0.1 });
  const metal = mat(PALETTE.metal, { rough: 0.5, metal: 0.3 });
  const glow  = new THREE.MeshStandardMaterial({
    color: 0x9be7ff, emissive: 0x2ea8d8, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1
  });

  // Dalle
  const base = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 6), dark);
  base.position.y = 0.25;
  g.add(base);

  // Corps principal
  const core = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.6, 4.6), body);
  core.position.y = 1.3;
  g.add(core);

  // Étage
  const upper = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.0, 3.4), body);
  upper.position.y = 2.6;
  g.add(upper);

  // Toit (plus étroit que l'étage : la couleur d'équipe reste visible)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.22, 2.9), metal);
  roof.position.y = 3.2;
  g.add(roof);

  // Piliers d'angle
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.2, 0.4), metal);
      pillar.position.set(sx * 2.6, 1.1, sz * 2.6);
      g.add(pillar);
    }
  }

  // Baies vitrées lumineuses
  const bays = [
    [0, 2.32, 0], [0, -2.32, 0],
    [2.32, 0, Math.PI / 2], [-2.32, 0, Math.PI / 2]
  ];
  for (const [x, z, ry] of bays) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.5, 0.08), glow);
    win.position.set(x, 1.5, z);
    win.rotation.y = ry;
    g.add(win);
  }

  // Mât
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 8), metal);
  mast.position.set(0, 4.3, 0);
  g.add(mast);

  // Radar (pivot animé)
  const pivot = new THREE.Group();
  pivot.position.set(0, 5.2, 0);
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    metal
  );
  dish.rotation.x = Math.PI * 0.72;
  dish.position.y = 0.1;
  pivot.add(dish);
  g.add(pivot);

  // Balise
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow);
  beacon.position.set(0, 5.9, 0);
  g.add(beacon);

  g.userData = { type: 'cc', spec: UNIT_SPECS.cc, spin: pivot };
  return shade(g);
}

/* ---------------------------------------------------------------- dispatcher */

/**
 * Fabrique une unité par son type. Point d'entrée unique utilisé par game.js.
 * @param {'cc'|'tank'|'dozer'} type
 * @param {string|number} color
 * @returns {THREE.Group}
 */
export function createUnit(type, color) {
  switch (type) {
    case 'cc':    return createCommandCenter(color);
    case 'dozer': return createDozer(color);
    case 'tank':
    default:      return createTank(color);
  }
}

/* ------------------------------------------------------------ décor / effets */

/** Texture procédurale du sol : grille tactique + grain. */
export function createGroundTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2f3843';
  ctx.fillRect(0, 0, size, size);

  // Grain
  for (let i = 0; i < 2600; i++) {
    const v = 34 + Math.random() * 26;
    ctx.fillStyle = `rgba(${v + 18},${v + 24},${v + 30},0.5)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  // Bord de cellule
  ctx.strokeStyle = 'rgba(130,200,230,0.30)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  // Croix de cellule
  ctx.strokeStyle = 'rgba(130,200,230,0.12)';
  ctx.beginPath();
  ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(MAP_SIZE / 5, MAP_SIZE / 5); // cellules de 5 unités
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Marqueur d'ordre de déplacement (anneau + point). */
export function createMoveMarker() {
  const g = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.15, 32),
    new THREE.MeshBasicMaterial({
      color: 0x7ef7a0, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthWrite: false
    })
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

/** Anneau de sélection (rayon 1, à mettre à l'échelle de l'unité). */
export function createSelectionRing(color = 0x8ef7b0) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.0, 40),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.95,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}
