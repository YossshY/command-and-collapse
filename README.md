# Command & Collapse

STR 3D en vue de dessus, jouable dans le navigateur, multijoueur **pair-à-pair sans serveur**.
Inspiré de *Command & Conquer: Generals — Heure H*.

**Jouer :** https://yossshy.github.io/command-and-collapse/

Aucune installation, aucun compte, aucun backend : tout tourne côté client
(Three.js + WebRTC via Trystero) et l'hébergement est assuré par GitHub Pages.

---

## Sommaire des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure : canvas 3D, HUD, lobby, salon d'attente. Import map Three.js. |
| `style.css` | Interface sombre tactique (lobby, HUD, sélection, toasts). |
| `network.js` | Couche P2P Trystero : annonces de salons, roster, démarrage, sync de partie. |
| `game.js` | Scène Three.js, caméra stratégique, sélection, ordres, boucle de jeu. |
| `assets.js` | **Toute** la fabrique 3D (chars, bulldozer, centre de commandement, décor). |

---

## 1. Multijoueur P2P (`network.js`)

Deux salons Trystero coexistent :

- **Salon global** `cac-lobby-v1` — tout le monde y est connecté. Les hôtes y
  publient une annonce toutes les **2 secondes** (`ann`), ce qui alimente la liste
  des parties en temps réel. Une annonce non rafraîchie disparaît au bout de 6 s.
- **Salon de jeu** `cac-game-<CODE>` — créé au lancement de la partie, il ne
  transporte que le trafic de jeu (transformées d'unités, ordres).

### Protocole du lobby

| Action | Émetteur | Charge utile |
|---|---|---|
| `ann` | hôte, toutes les 2 s | `{code, host, hostName, players, max, isPrivate}` |
| `hello` | tout le monde (à la connexion) | `{}` → les hôtes se re-annoncent |
| `join` | candidat | `{code, player}` |
| `roster` | hôte | `{code, host, players, isPrivate}` (ou `{error:'full'}`) |
| `start` | hôte | `{code, players, seed}` |
| `leave` / `close` | joueur / hôte | `{code}` |

- **Salon public** : annoncé dans la liste, rejoignable en un clic.
- **Salon privé** : jamais annoncé, rejoignable uniquement par son code à 5 caractères.
- **4 joueurs maximum** par salon.
- L'hôte est le seul à pouvoir lancer la partie ; le message `start` bascule
  simultanément tous les clients sur l'arène 3D.

### Synchronisation en jeu

Chaque client est **autoritaire sur ses propres unités** : il diffuse leur
transformée 10 fois par seconde (`units`), les autres clients interpolent
(lerp exponentiel). Les ordres de déplacement sont également diffusés (`order`)
pour afficher le marqueur au sol chez tout le monde. Aucun arbitrage serveur,
aucune simulation déterministe à maintenir.

### Stratégie de signalisation

Trystero est chargé dynamiquement depuis le CDN :

```
https://cdn.jsdelivr.net/npm/trystero@0.21.5/<mqtt|torrent>/+esm
```

`MQTT` par défaut (relais publics, connexion rapide). `BitTorrent` disponible via
le sélecteur du lobby ou l'URL `?net=torrent` — utile si les relais MQTT publics
sont bloqués sur votre réseau.

---

## 2. Rendu 3D et caméra (`game.js`)

- Terrain plat **100 × 100 unités**, texture de grille tactique générée
  procéduralement (canvas), lumière directionnelle avec ombres douces (2048²),
  hémisphérique d'appoint, brouillard de distance.
- Caméra perspective inclinée à **60°** (vue stratégique).
- Déplacement : `ZQSD` / `WASD` / flèches, **ou** approche de la souris sur les
  bords de l'écran. Vitesse proportionnelle au zoom.
- Zoom molette lissé, borné entre 22 et 120 unités.
- En lobby, la caméra orbite lentement autour de l'arène.

## 3. Placeholders 3D (`assets.js`)

Trois fabriques, échelles normalisées, avant orienté vers **+Z** :

| Fonction | Encombrement (w × h × d) |
|---|---|
| `createTank(color)` | 2 × 1 × 3 |
| `createDozer(color)` | 2.2 × 1.4 × 2.6 |
| `createCommandCenter(color)` | 6 × 3 × 6 |

`createUnit(type, color)` est le point d'entrée unique utilisé par le jeu.

### Remplacer par des modèles `.glb`

1. Importer `GLTFLoader` depuis `three/addons/loaders/GLTFLoader.js`.
2. Remplacer le corps d'une fabrique en conservant :
   - le nom et la signature,
   - le retour d'un `THREE.Group` posé au sol (`y = 0`),
   - l'avant du véhicule vers `+Z`,
   - l'échelle de `UNIT_SPECS`,
   - `group.userData = { type, spec }`.
3. Rien d'autre à modifier : `game.js` ne connaît que `createUnit()`.

## 4. Interactions

- **Clic gauche** : sélection d'une unité.
- **Rectangle de sélection** (glisser) : sélection multiple ; `Maj` pour ajouter.
- **Clic droit** : ordre de déplacement en formation, avec marqueur au sol animé.
- **`B`** : produit un bulldozer près du centre de commandement (démo du
  placeholder `createDozer`).
- **`Échap`** : désélection.

Chaque joueur démarre avec **1 centre de commandement + 2 chars** à sa couleur,
sur des points de départ opposés (4 coins de la carte).

---

## Lancer en local

Les modules ES et l'import map exigent un serveur HTTP (pas de `file://`) :

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

Pour tester le multijoueur sur une seule machine, ouvrez deux onglets (ou deux
navigateurs) : créez un salon dans l'un, rejoignez-le depuis l'autre.

## Déploiement

GitHub Pages sert la branche `main` à la racine. Un `git push` suffit à publier.

## Limites connues (étape 1)

- Pas encore de combat, de ressources ni de construction : les unités se
  déplacent, c'est tout.
- Pas de pathfinding : les déplacements sont directs, les unités peuvent se
  chevaucher.
- Pas de reconnexion : si un joueur ferme l'onglet, ses unités se figent.
- Les relais MQTT/BitTorrent sont publics et best-effort ; en cas d'échec de
  connexion, basculer de stratégie dans le lobby.
