/* ============================================================================
 * config.js — Données de jeu : factions, bâtiments, unités, carte, difficulté
 * ----------------------------------------------------------------------------
 * Aucune logique ici, uniquement des chiffres et des libellés. C'est le seul
 * fichier à éditer pour équilibrer le jeu.
 * ========================================================================== */

export const MAP_SIZE = 300;

/** Points de départ (4 coins). L'index dans le roster détermine le coin. */
export const SPAWNS = [
  { x: -130, z: -130 },
  { x:  130, z:  130 },
  { x:  130, z: -130 },
  { x: -130, z:  130 }
];

/**
 * Champs d'Isotope-X.
 *  - 1 champ vert près de chaque base : 25 000 $
 *  - 2 grands champs au centre        : 50 000 $ chacun
 * `crystals` = nombre de cristaux visibles ; ils disparaissent au prorata de
 * la valeur restante et repoussent d'un cristal toutes les 10 s.
 */
export const CRYSTAL_FIELDS = [
  { id: 'g0', x: -108, z: -108, value: 25000, crystals: 50, radius: 8,  color: '#4ade80', glow: '#22c55e' },
  { id: 'g1', x:  108, z:  108, value: 25000, crystals: 50, radius: 8,  color: '#4ade80', glow: '#22c55e' },
  { id: 'g2', x:  108, z: -108, value: 25000, crystals: 50, radius: 8,  color: '#4ade80', glow: '#22c55e' },
  { id: 'g3', x: -108, z:  108, value: 25000, crystals: 50, radius: 8,  color: '#4ade80', glow: '#22c55e' },
  { id: 'c0', x:    0, z:  -70, value: 50000, crystals: 80, radius: 12, color: '#38bdf8', glow: '#0ea5e9' },
  { id: 'c1', x:    0, z:   70, value: 50000, crystals: 80, radius: 12, color: '#38bdf8', glow: '#0ea5e9' },
  { id: 'c2', x:  -70, z:    0, value: 50000, crystals: 80, radius: 12, color: '#38bdf8', glow: '#0ea5e9' },
  { id: 'c3', x:   70, z:    0, value: 50000, crystals: 80, radius: 12, color: '#38bdf8', glow: '#0ea5e9' }
];

/** Valeur d'un voyage de collecteur. */
export const HARVEST_LOAD = 400;
export const HARVEST_TIME = 2.2;      // secondes d'aspiration
export const CRYSTAL_REGROW_MS = 10000;

/** Argent de départ proposé dans les paramètres de partie. */
export const START_MONEY_OPTIONS = [3000, 5000, 10000, 20000];

/** Difficultés de l'IA. */
export const DIFFICULTY = {
  easy:   { id: 'easy',   label: 'Recrue',  money: 1.0, speed: 0.75, wave: 4,  think: 6.0, desc: 'IA lente, petites vagues' },
  normal: { id: 'normal', label: 'Vétéran', money: 1.0, speed: 1.0,  wave: 7,  think: 4.0, desc: 'IA équilibrée' },
  hard:   { id: 'hard',   label: 'Général', money: 1.6, speed: 1.45, wave: 11, think: 2.6, desc: 'IA agressive, économie boostée' }
};

/* ------------------------------------------------------------------------- */
/*                                 FACTIONS                                   */
/* ------------------------------------------------------------------------- */

export const FACTIONS = {

  /* ============================ ALLIANCE ATLANTIQUE ======================== */
  atlantic: {
    id: 'atlantic',
    name: 'Alliance Atlantique',
    short: 'Alliance',
    color: '#3b82f6',
    tagline: 'Haute technologie · boucliers · aviation',
    usesPower: true,
    buildings: {
      cc: {
        name: 'Centre de Commandement', cost: 2000, energy: 0, time: 20, hp: 4000,
        shape: 'cc', w: 7, d: 7, h: 4, produces: [],
        desc: 'Quartier général — construction depuis le panneau latéral'
      },
      power: {
        name: 'Réacteur à Fusion', cost: 800, energy: 10, time: 10, hp: 1200,
        shape: 'power', w: 5, d: 5, h: 3, produces: [],
        desc: '+10 énergie'
      },
      refinery: {
        name: 'Dépôt Logistique', cost: 1500, energy: -2, time: 15, hp: 2000,
        shape: 'refinery', w: 6, d: 6, h: 3, produces: ['collector'], freeUnit: 'collector',
        desc: 'Collecteur gratuit + production de collecteurs'
      },
      barracks: {
        name: 'Caserne Tactique', cost: 500, energy: -1, time: 8, hp: 1500,
        shape: 'barracks', w: 5, d: 5, h: 2.5, produces: ['vanguard', 'javelin'],
        desc: 'Infanterie'
      },
      factory: {
        name: "Usine d'Assemblage", cost: 1800, energy: -3, time: 15, hp: 2500,
        shape: 'factory', w: 7, d: 6, h: 3, produces: ['lynx', 'paladin', 'helios'],
        desc: 'Véhicules blindés'
      },
      airfield: {
        name: 'Aérodrome', cost: 1000, energy: -2, time: 12, hp: 1800,
        shape: 'airfield', w: 7, d: 7, h: 2, produces: ['wraith'],
        desc: 'Aviation'
      },
      research: {
        name: 'Centre de Recherche', cost: 2000, energy: -4, time: 20, hp: 2000,
        shape: 'research', w: 5, d: 5, h: 4, produces: [],
        desc: 'Débloque les unités avancées'
      },
      turret: {
        name: 'Tourelle Gatling', cost: 600, energy: -1, time: 8, hp: 1200,
        shape: 'defense-light', w: 3, d: 3, h: 3, produces: [],
        desc: 'Défense légère', defense: { dmg: 14, range: 16, cd: 0.35 }
      },
      patriot: {
        name: 'Batterie Patriot', cost: 1000, energy: -3, time: 12, hp: 1800,
        shape: 'defense-heavy', w: 4, d: 4, h: 3.5, produces: [],
        desc: 'Défense lourde', defense: { dmg: 55, range: 24, cd: 1.8 }
      }
    },
    units: {
      collector: { name: 'Collecteur',  cost: 1000, time: 8,  hp: 400,  speed: 7,  shape: 'collector',   role: 'récolte',      sight: 14 },
      vanguard:  { name: 'Fantassin Vanguard', cost: 250, time: 4, hp: 120, speed: 5, shape: 'infantry', role: 'anti-infanterie', dmg: 12, range: 9,  cd: 0.8, sight: 14 },
      javelin:   { name: 'Équipe Javelin', cost: 400, time: 5, hp: 100, speed: 4.5, shape: 'infantry-at', role: 'antichar/antiaérien', dmg: 30, range: 12, cd: 1.4, sight: 15 },
      lynx:      { name: 'Buggy Lynx', cost: 700, time: 6, hp: 250, speed: 12, shape: 'buggy', role: 'rapide', dmg: 10, range: 8, cd: 0.5, sight: 16 },
      paladin:   { name: 'Char Paladin Mk-IV', cost: 1100, time: 10, hp: 900, speed: 6, shape: 'tank', role: 'canon lourd + bouclier', dmg: 45, range: 11, cd: 1.6, sight: 16 },
      helios:    { name: 'Artillerie Laser Helios', cost: 1400, time: 12, hp: 400, speed: 4, shape: 'artillery', role: 'longue portée', dmg: 60, range: 20, cd: 2.5, sight: 18 },
      wraith:    { name: 'Intercepteur Wraith', cost: 1200, time: 10, hp: 350, speed: 16, shape: 'aircraft', role: 'aérien', dmg: 35, range: 10, cd: 1.0, sight: 20 }
    }
  },

  /* ============================ PACTE EURASIATIQUE ======================== */
  eurasia: {
    id: 'eurasia',
    name: 'Pacte Eurasiatique',
    short: 'Pacte',
    color: '#ef4444',
    tagline: 'Blindage lourd · masse · guerre électronique',
    usesPower: true,
    buildings: {
      cc: {
        name: 'Quartier Général', cost: 2000, energy: 0, time: 20, hp: 4000,
        shape: 'cc', w: 7, d: 7, h: 4, produces: [],
        desc: 'Quartier général — construction depuis le panneau latéral'
      },
      power: {
        name: 'Centrale Thermique', cost: 800, energy: 10, time: 10, hp: 1200,
        shape: 'power', w: 5, d: 5, h: 3, produces: [],
        desc: '+10 énergie'
      },
      refinery: {
        name: 'Raffinerie', cost: 1500, energy: -2, time: 15, hp: 2000,
        shape: 'refinery', w: 6, d: 6, h: 3, produces: ['collector'], freeUnit: 'collector',
        desc: 'Collecteur gratuit + production de collecteurs'
      },
      barracks: {
        name: "Camp d'Entraînement", cost: 500, energy: -1, time: 8, hp: 1500,
        shape: 'barracks', w: 5, d: 5, h: 2.5, produces: ['bastion', 'kobra'],
        desc: 'Infanterie'
      },
      factory: {
        name: 'Complexe Blindé', cost: 1800, energy: -3, time: 15, hp: 2500,
        shape: 'factory', w: 7, d: 6, h: 3, produces: ['cyclone', 'mammoth', 'tempest'],
        desc: 'Véhicules blindés'
      },
      airfield: {
        name: 'Base Aérienne', cost: 1000, energy: -2, time: 12, hp: 1800,
        shape: 'airfield', w: 7, d: 7, h: 2, produces: ['faucon'],
        desc: 'Aviation'
      },
      research: {
        name: 'Académie Militaire', cost: 2000, energy: -4, time: 20, hp: 2000,
        shape: 'research', w: 5, d: 5, h: 4, produces: [],
        desc: 'Débloque les unités avancées'
      },
      turret: {
        name: 'Bunker Bétonné', cost: 600, energy: -1, time: 8, hp: 1200,
        shape: 'defense-light', w: 3, d: 3, h: 3, produces: [],
        desc: 'Défense légère', defense: { dmg: 14, range: 16, cd: 0.35 }
      },
      patriot: {
        name: 'Tour Lance-Roquettes', cost: 1000, energy: -3, time: 12, hp: 1800,
        shape: 'defense-heavy', w: 4, d: 4, h: 3.5, produces: [],
        desc: 'Défense lourde', defense: { dmg: 55, range: 24, cd: 1.8 }
      }
    },
    units: {
      collector: { name: 'Collecteur',      cost: 1000, time: 8,  hp: 400, speed: 7,  shape: 'collector', role: 'récolte',      sight: 14 },
      bastion:   { name: 'Garde Bastion',   cost: 300,  time: 5,  hp: 150, speed: 4.5, shape: 'infantry', role: 'bonus de tir en groupe', dmg: 10, range: 9, cd: 0.9, sight: 14, squad: 2 },
      kobra:     { name: 'Chasseur Kobra',  cost: 350,  time: 5,  hp: 110, speed: 5,  shape: 'infantry-at', role: 'antichar', dmg: 28, range: 11, cd: 1.5, sight: 15 },
      cyclone:   { name: 'Char Gatling Cyclone', cost: 800, time: 7, hp: 600, speed: 7, shape: 'tank', role: 'antiaérien/infanterie', dmg: 16, range: 10, cd: 0.3, sight: 16 },
      mammoth:   { name: 'Char Lourd Mammouth', cost: 1600, time: 14, hp: 1600, speed: 4.5, shape: 'tank-heavy', role: 'double canon ultra-blindé', dmg: 70, range: 12, cd: 2.0, sight: 16 },
      tempest:   { name: 'Char Brouilleur Tempête', cost: 1200, time: 11, hp: 800, speed: 6, shape: 'tank', role: 'désactive les ennemis', dmg: 20, range: 10, cd: 1.4, sight: 18, jam: true },
      faucon:    { name: 'Bombardier Faucon', cost: 1300, time: 10, hp: 400, speed: 14, shape: 'aircraft', role: 'aérien', dmg: 55, range: 9, cd: 2.2, sight: 20 }
    }
  },

  /* ============================ LÉGION DE L'OMBRE ========================= */
  shadow: {
    id: 'shadow',
    name: "Légion de l'Ombre",
    short: 'Légion',
    color: '#22c55e',
    tagline: 'Guérilla · pas d’électricité · rapidité',
    usesPower: false,
    buildings: {
      cc: {
        name: 'Bastion Clandestin', cost: 2000, energy: 0, time: 20, hp: 4000,
        shape: 'cc', w: 7, d: 7, h: 4, produces: [],
        desc: 'Quartier général — construction depuis le panneau latéral'
      },
      refinery: {
        name: "Cache d'Approvisionnement", cost: 1500, energy: 0, time: 15, hp: 2000,
        shape: 'supply', w: 6, d: 6, h: 2.5, produces: ['collector'], freeUnit: 'collector',
        desc: 'Collecteur gratuit + production de collecteurs'
      },
      barracks: {
        name: 'Planque Urbaine', cost: 500, energy: 0, time: 8, hp: 1500,
        shape: 'barracks', w: 5, d: 5, h: 2.5, produces: ['milicien', 'scorpion'],
        desc: 'Infanterie'
      },
      factory: {
        name: 'Atelier de Récupération', cost: 1800, energy: 0, time: 15, hp: 2500,
        shape: 'factory', w: 7, d: 6, h: 3, produces: ['coyote', 'chacal', 'kamikaze', 'vipere'],
        desc: 'Véhicules de fortune'
      },
      research: {
        name: 'Palais du Commandement', cost: 2000, energy: 0, time: 20, hp: 2000,
        shape: 'palace', w: 6, d: 6, h: 4, produces: [],
        desc: 'Débloque les unités avancées'
      },
      turret: {
        name: 'Réseau de Tunnels', cost: 600, energy: 0, time: 8, hp: 1500,
        shape: 'tunnel', w: 3, d: 3, h: 1.5, produces: [],
        desc: 'Défense + téléporte les unités alliées', defense: { dmg: 10, range: 14, cd: 0.6 }
      },
      patriot: {
        name: 'Site Lance-Acide', cost: 1000, energy: 0, time: 12, hp: 1800,
        shape: 'defense-heavy', w: 4, d: 4, h: 3.5, produces: [],
        desc: 'Défense lourde', defense: { dmg: 50, range: 22, cd: 1.9 }
      }
    },
    units: {
      collector: { name: 'Collecteur',    cost: 1000, time: 8,  hp: 400, speed: 8,  shape: 'collector', role: 'récolte',      sight: 14 },
      milicien:  { name: 'Milicien Rebelle', cost: 150, time: 3, hp: 90,  speed: 5.5, shape: 'infantry', role: 'nombre', dmg: 8, range: 8, cd: 0.7, sight: 14 },
      scorpion:  { name: 'Tireur Scorpion', cost: 300, time: 4, hp: 100, speed: 5, shape: 'infantry-at', role: 'antichar', dmg: 26, range: 11, cd: 1.5, sight: 15 },
      coyote:    { name: 'Pick-up Coyote', cost: 600, time: 5, hp: 220, speed: 13, shape: 'buggy', role: 'rapide', dmg: 9, range: 8, cd: 0.45, sight: 16 },
      chacal:    { name: 'Char Chacal', cost: 850, time: 8, hp: 550, speed: 8, shape: 'tank', role: 'char moyen rapide', dmg: 32, range: 10, cd: 1.3, sight: 16 },
      kamikaze:  { name: 'Camion Piégé Kamikaze', cost: 1000, time: 9, hp: 300, speed: 11, shape: 'truck-bomb', role: 'explose au contact', dmg: 220, range: 2.5, cd: 99, sight: 15, suicide: true },
      vipere:    { name: 'Buggy Lance-Acide Vipère', cost: 1100, time: 10, hp: 380, speed: 9, shape: 'artillery', role: 'artillerie', dmg: 50, range: 18, cd: 2.4, sight: 18 }
    }
  }
};

/** Ordre d'affichage dans le lobby. */
export const FACTION_ORDER = ['atlantic', 'eurasia', 'shadow'];

/** Couleurs d'équipe proposées. */
export const TEAM_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#eab308',
  '#a855f7', '#f97316', '#06b6d4', '#ec4899'
];

/* ------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* ------------------------------------------------------------------------- */

export function factionOf(id) {
  return FACTIONS[id] || FACTIONS.atlantic;
}

export function buildingDef(factionId, type) {
  const f = factionOf(factionId);
  return f.buildings[type] || null;
}

export function unitDef(factionId, type) {
  const f = factionOf(factionId);
  return f.units[type] || null;
}

/** Liste des bâtiments constructibles par un constructeur (hors CC). */
export function buildableList(factionId) {
  const f = factionOf(factionId);
  return Object.entries(f.buildings)
    .filter(([id]) => id !== 'cc')
    .map(([id, def]) => ({ id, ...def }));
}
