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
| `index.html` | Structure : canvas 3D, HUD, lobby, salon d'attente, paramètres de partie. |
| `style.css` | Interface sombre tactique (lobby, HUD, minimap, panneau de commandes). |
| `config.js` | **Toutes les données** : 3 factions, bâtiments, unités, carte, difficulté. |
| `network.js` | Couche P2P Trystero : annonces de salons, roster, démarrage, sync de partie. |
| `game.js` | Scène Three.js, caméra, économie, construction, récolte, combat, brouillard, IA. |
| `assets.js` | **Toute** la fabrique 3D (bâtiments, unités, cristaux, décor). |

---

## 1. Démarrage de partie

Chaque joueur commence avec **uniquement** :

- 1 Centre de Commandement de sa faction (bâti à 100 %)
- 1 unité de construction juste devant
- l'argent de départ choisi dans les paramètres (3 000 / 5 000 / 10 000 / 20 000 $)
- 0 / 0 d'énergie

Aucune unité de combat au départ : tout passe par le constructeur.

### Paramètres de partie (hôte)

Réglés dans le salon d'attente avant de lancer :

| Paramètre | Valeurs |
|---|---|
| Argent de départ | 3 000 / 5 000 / 10 000 / 20 000 $ |
| Adversaire IA | Aucun / Recrue / Vétéran / Général |
| Brouillard de guerre | activé / désactivé |

L'IA est simulée par l'hôte et diffusée aux autres clients comme un joueur normal.

---

## 2. Économie : l'Isotope-X

Six champs de cristaux sur la carte :

- **4 champs verts** près des bases — 25 000 $ chacun
- **2 grands champs bleus** au centre — 50 000 $ chacun

Chaque champ est un `InstancedMesh` de dizaines de cristaux octaédriques émissifs.
Ils disparaissent **un par un** au prorata de la valeur restante et **repoussent**
d'un cristal toutes les 10 secondes tant que le champ n'est pas totalement vidé.

### Collecteurs

Construire une raffinerie fait apparaître **un collecteur gratuit**. Le collecteur :

1. repère le champ le plus proche,
2. roule jusqu'à un cristal et l'aspire (2,2 s),
3. retourne à la raffinerie et dépose **+400 $**.

On peut produire des collecteurs supplémentaires depuis la raffinerie (1 000 $).

### Énergie

Chaque bâtiment consomme ou produit de l'énergie. Si la consommation dépasse la
production, l'alerte **« Basse tension »** s'affiche et la vitesse de construction
et de production est **divisée par deux** (pour le joueur concerné uniquement).

La Légion de l'Ombre n'utilise pas d'énergie : tous ses bâtiments sont à 0.

---

## 3. Construction

1. Sélectionner un constructeur → le panneau de commandes affiche les bâtiments.
2. Cliquer sur un bâtiment → **aperçu fantôme 3D** qui suit la souris
   (vert = valide, rouge = bloqué par un bâtiment, un champ de cristaux ou le bord).
3. Clic gauche → le chantier est posé, le constructeur **se déplace physiquement**
   jusqu'au site et fait monter le bâtiment de 0 % à 100 % (échafaudage visible).

`Échap` ou clic droit annule l'aperçu.

---

## 4. Catalogue (`config.js`)

### Alliance Atlantique — haute technologie, boucliers, aviation

| Bâtiment | Coût | Énergie | Temps | Produit |
|---|---|---|---|---|
| Centre de Commandement | 2 000 $ | 0 | 20 s | Drone Atlas (1 000 $, 8 s) |
| Réacteur à Fusion | 800 $ | +10 | 10 s | — |
| Dépôt Logistique | 1 500 $ | −2 | 15 s | Collecteur gratuit + Collecteur (1 000 $, 8 s) |
| Caserne Tactique | 500 $ | −1 | 8 s | Vanguard (250 $, 4 s), Javelin (400 $, 5 s) |
| Usine d'Assemblage | 1 800 $ | −3 | 15 s | Lynx (700 $, 6 s), Paladin Mk-IV (1 100 $, 10 s), Helios (1 400 $, 12 s) |
| Aérodrome | 1 000 $ | −2 | 12 s | Wraith (1 200 $, 10 s) |
| Centre de Recherche | 2 000 $ | −4 | 20 s | — |
| Tourelle Gatling | 600 $ | −1 | 8 s | défense légère |
| Batterie Patriot | 1 000 $ | −3 | 12 s | défense lourde |

### Pacte Eurasiatique — blindage lourd, masse, guerre électronique

| Bâtiment | Coût | Énergie | Temps | Produit |
|---|---|---|---|---|
| Quartier Général | 2 000 $ | 0 | 20 s | Bulldozer Titan (1 000 $, 8 s) |
| Centrale Thermique | 800 $ | +10 | 10 s | — |
| Raffinerie | 1 500 $ | −2 | 15 s | Collecteur gratuit + Collecteur |
| Camp d'Entraînement | 500 $ | −1 | 8 s | Garde Bastion (300 $, 5 s, ×2), Kobra (350 $, 5 s) |
| Complexe Blindé | 1 800 $ | −3 | 15 s | Cyclone (800 $, 7 s), Mammouth (1 600 $, 14 s), Tempête (1 200 $, 11 s) |
| Base Aérienne | 1 000 $ | −2 | 12 s | Faucon (1 300 $, 10 s) |
| Académie Militaire | 2 000 $ | −4 | 20 s | — |
| Bunker Bétonné | 600 $ | −1 | 8 s | défense légère |
| Tour Lance-Roquettes | 1 000 $ | −3 | 12 s | défense lourde |

### Légion de l'Ombre — guérilla, pas d'électricité, rapidité

| Bâtiment | Coût | Énergie | Temps | Produit |
|---|---|---|---|---|
| Bastion Clandestin | 2 000 $ | 0 | 20 s | Sapeur Nomade (500 $, 5 s) |
| Cache d'Approvisionnement | 1 500 $ | 0 | 15 s | Collecteur gratuit + Collecteur |
| Planque Urbaine | 500 $ | 0 | 8 s | Milicien (150 $, 3 s), Scorpion (300 $, 4 s) |
| Atelier de Récupération | 1 800 $ | 0 | 15 s | Coyote (600 $, 5 s), Chacal (850 $, 8 s), Kamikaze (1 000 $, 9 s), Vipère (1 100 $, 10 s) |
| Palais du Commandement | 2 000 $ | 0 | 20 s | — |
| Réseau de Tunnels | 600 $ | 0 | 8 s | défense légère |
| Site Lance-Acide | 1 000 $ | 0 | 12 s | défense lourde |

Chaque unité possède PV, vitesse, portée, dégâts et cadence de tir dans `config.js`.

---

## 5. Combat

Les unités armées attaquent automatiquement la cible ennemie la plus proche à
portée (tracers visibles). Les bâtiments de défense tirent aussi. Les dégâts sont
appliqués par le **propriétaire de la cible** (message `hit`), ce qui évite toute
divergence entre clients. Le camion Kamikaze explose au contact (dégâts de zone).

---

## 6. HUD

- **Argent** en haut à droite, **jauge d'énergie verticale** sur le bord droit
- **Minimap interactive** en bas à gauche (clic = déplacer la caméra)
- **Panneau de commandes contextuel** en bas au centre : bâtiments du constructeur
  ou unités du bâtiment sélectionné, avec coût, énergie et file de production
- Alerte **« Basse tension »** au centre haut

---

## 7. Multijoueur P2P (`network.js`)

Deux salons Trystero coexistent :

- **Salon global** `cac-lobby-v1` — annonces des parties toutes les **2 secondes**,
  roster, démarrage. Une annonce non rafraîchie disparaît en 6 s.
- **Salon de jeu** `cac-game-<CODE>` — trafic de la partie.

### Protocole du lobby

| Action | Émetteur | Charge utile |
|---|---|---|
| `ann` | hôte, toutes les 2 s | `{code, host, hostName, players, max, isPrivate}` |
| `hello` | tout le monde | `{}` → les hôtes se re-annoncent |
| `join` | candidat | `{code, player}` |
| `roster` | hôte | `{code, host, players, isPrivate}` |
| `start` | hôte | `{code, players, seed, settings}` |
| `leave` / `close` | joueur / hôte | `{code}` |

### Synchronisation en jeu

Chaque client est **autoritaire sur ses propres entités** (et l'hôte sur celles de
l'IA). Il diffuse 10 fois par seconde un instantané :

```
[id, kind, type, owner, x, z, rotation, hp, maxHp, progression, construit]
```

Les autres clients créent les entités manquantes, interpolent les positions et
suppriment celles qui n'ont pas été vues depuis 2,5 s. Les ordres de déplacement
(`order`), les dégâts (`hit`) et les ponctions sur les cristaux (`harvest`) sont
diffusés séparément.

### Stratégie de signalisation

```
https://cdn.jsdelivr.net/npm/trystero@0.21.5/<mqtt|torrent>/+esm
```

`MQTT` par défaut, `BitTorrent` via le sélecteur du lobby ou `?net=torrent`.

---

## 8. Rendu 3D et caméra

- Terrain **100 × 100** avec texture procédurale (désert, routes d'asphalte vers
  le centre, zones de base damées, gravier autour des cristaux) et rochers 3D.
- Caméra perspective inclinée à **60°**, déplacement `ZQSD`/`WASD`/flèches ou
  bords d'écran, zoom molette lissé (18 → 110).
- Brouillard de guerre : texture canvas 192² (exploré persistant + vision
  courante), plan semi-transparent au sol et masquage des entités ennemies.

## 9. Remplacer les placeholders par des `.glb`

Tout est isolé dans `assets.js`. Pour chaque fabrique, conserver :

- le nom et la signature (`createBuilding(shape, color, faction)`,
  `createUnit(shape, color, faction)`) ;
- le retour d'un `THREE.Group` posé au sol (`y = 0`) ;
- l'avant du véhicule orienté vers **+Z** ;
- l'échelle de la définition (`w`, `d`, `h` dans `config.js`) ;
- `group.userData = { type, shape }`.

Aucun autre fichier n'a besoin d'être modifié.

---

## Débogage

La console du navigateur expose `window.CAC` :

```js
CAC.units        // Map id -> unité
CAC.buildings    // Map id -> bâtiment
CAC.fields       // Map id -> champ de cristaux
CAC.net          // couche réseau
CAC.players      // roster
CAC.money        // trésorerie locale
CAC.settings     // paramètres de la partie
```

## Lancer en local

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

## Limites connues

- Pas de pathfinding : les déplacements sont directs, les unités peuvent se
  chevaucher et contourner un bâtiment par glissement.
- Pas de brouillage effectif pour le Char Tempête (le drapeau `jam` est déclaré
  mais l'effet n'est pas encore implémenté).
- Pas de téléportation par tunnels (bâtiment décoratif + défense).
- Pas de reconnexion : un joueur qui ferme l'onglet laisse ses unités figées
  puis elles disparaissent au bout de 2,5 s.
- Les relais MQTT/BitTorrent sont publics et best-effort.
