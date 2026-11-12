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
- l'argent de départ choisi dans les paramètres (3 000 / 5 000 / 10 000 / 20 000 $)
- 0 / 0 d'énergie

**Aucune unité de construction** : les bâtiments se paient et se posent
directement depuis le panneau latéral, puis montent tout seuls.

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

La **grille de construction** occupe la colonne de droite, sous la minimap,
comme dans Generals : des cases carrées avec icône et coût, réparties en deux
onglets (**Bâtiments** / **Défense**).

1. Cliquer sur une case → **aperçu fantôme 3D** qui suit la souris
   (vert = valide, rouge = bloqué par un bâtiment, un champ de cristaux ou le bord).
2. Clic gauche → l'argent est débité et le chantier est posé.
3. Le bâtiment monte de 0 % à 100 % **tout seul** (échafaudage visible), à la
   vitesse `time` de `config.js`, divisée par deux en basse tension.
   La case affiche alors un remplissage bleu et son pourcentage.

**Tout se fait depuis la colonne de droite**, sans jamais devoir sélectionner un
bâtiment. Cinq onglets, comme dans Generals :

| Onglet | Contenu |
|---|---|
| Bâtiments | réacteur, dépôt, caserne, usine, aérodrome, recherche |
| Défense | tourelle Gatling, batterie Patriot |
| Infanterie | fantassins et équipes antichar |
| Véhicules | collecteurs, buggies, chars, artillerie |
| Aviation | intercepteurs et bombardiers |

Cliquer une unité la met en file **dans le premier bâtiment construit qui la
produit**. Si aucun bâtiment ne la fabrique, la case est grisée et le clic
explique quoi construire (« Nécessite : Caserne Tactique. »).

`Échap` ou clic droit annule l'aperçu.

### Confort façon Generals

- **Point de ralliement** : sélectionner un bâtiment de production, clic droit sur
  le sol → les unités produites s'y rendent automatiquement.
- **Groupes de contrôle** : `Ctrl+1`…`Ctrl+9` pour mémoriser, `1`…`9` pour rappeler.
- **Vente** : `Suppr` (ou bouton « Vendre ») rembourse 50 % du bâtiment sélectionné.

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

- Terrain **300 × 300** avec texture procédurale (désert, routes d'asphalte vers
  le centre, zones de base damées, gravier autour des cristaux) et rochers 3D.
  *Référence : dans le World Builder de Generals, 1 tuile = 10 pieds et une carte
  4-6 joueurs fait 350 × 350 tuiles ; 300 unités se situe entre la carte 2 joueurs
  (250) et la carte 4 joueurs (350).*
- Caméra perspective inclinée à **60°**, déplacement `ZQSD`/`WASD`/flèches ou
  bords d'écran, zoom molette lissé (20 → 200).
- Brouillard de guerre : texture canvas 384² (exploré persistant + vision
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

## 10. Audio

Aucun fichier audio : **tout est synthétisé en direct** avec la Web Audio API
(`audio.js`), ce qui évite tout problème de licence et garde le jeu autonome.

- **Musique** : boucle ambient/militaire à 84 BPM — nappe d'accords mineurs
  (Am–F–C–G) en sawtooth filtré, basse, grosse caisse et charleston, séquencés
  avec un lookahead de 250 ms.
- **Effets** : sélection, pose de bâtiment, bâtiment terminé, encaissement,
  erreur de fonds, tir, explosion.
- **Réglages** : bouton ⚙ dans le lobby et dans le HUD → deux curseurs
  (musique / effets) et deux boutons muet. Les valeurs sont conservées dans
  `localStorage` (`cac.audio`).

Le contexte audio ne démarre qu'au premier clic (politique des navigateurs).

## 11. Barres d'état et retours visuels

Toutes les barres sont des plans 3D orientés vers la caméra (`createBar` /
`setBar` dans `assets.js`), dessinés au-dessus de la scène.

**Barres de vie** — au-dessus de chaque unité et de chaque bâtiment :

| Couleur | Seuil | Sens |
|---|---|---|
| Vert | > 60 % | en forme |
| Orange | 30 – 60 % | endommagé |
| Rouge | < 30 % | critique |

Elles s'affichent pour tes unités (option « Barres de vie toujours visibles »,
activée par défaut), pour toute entité sélectionnée, et pour toute entité
ennemie **endommagée** — comme dans Generals, où les barres adverses
n'apparaissent qu'au combat.

**Barres de progression** :

- **Chantier** : la barre du bâtiment passe en orange et suit la construction
  de 0 à 100 %.
- **Collecteur** : une seconde barre sous la vie montre le cycle de récolte —
  bleue pendant l'extraction (`HARVEST_TIME`), orange pendant le retour chargé
  (cargaison / `HARVEST_LOAD`).
- **Production** : la file d'attente de chaque bâtiment est visible dans le
  panneau contextuel et dans la barre du bas.

**Barre de chantiers (bas d'écran)** : un bandeau permanent en bas de page
liste tous tes chantiers et toutes tes productions en cours avec leur
pourcentage, pour ne jamais perdre le fil quand la caméra est ailleurs.

**Panneau de sélection (bas gauche)** : nom, barre de vie chiffrée, puis les
caractéristiques de l'entité — dégâts, portée, vitesse, rôle, état courant,
cargaison pour les collecteurs, énergie et file de production pour les
bâtiments. Sur une sélection multiple : total des PV et répartition par type.

## 12. Interface façon Generals

Le HUD reprend la disposition de *Heure H* :

| Zone | Contenu |
|---|---|
| Haut gauche | pseudo, faction, pastille de couleur, nombre d'alliés |
| Haut droite | **minimap** encadrée (terrain sable, brouillard, champs, entités, cadre de caméra) |
| Sous la minimap | **argent** et **jauge d'énergie** horizontale |
| Colonne droite | onglets + **grille de construction** (cases carrées, icônes SVG, coût) |
| Bas droite | **panneau de sélection** : en-tête vert, portrait, barre de vie, caractéristiques |
| Bas gauche | **barre de commandement** : pause, réglages audio, aide |
| Bas centre | **bandeau chantiers / productions** avec pourcentages |

Les icônes sont des SVG inline (`ICONS` dans `game.js`) : aucun fichier image,
donc rien à héberger et un rendu net à toutes les tailles.

## 13. Bâtiments de défense

Les tourelles et batteries (`def.defense` dans `config.js`) sont **armées** :

- acquisition automatique de la cible la plus proche **à portée** (unités
  d'abord, puis bâtiments), sans ordre du joueur ;
- rotation du fût vers la cible (`userData.spin` du modèle 3D) ;
- tir avec traceur, cadence et dégâts propres à chaque défense ;
- dégâts appliqués par le propriétaire de la cible (même règle que les unités),
  donc pas de divergence entre clients.

| Défense | Dégâts | Portée | Cadence |
|---|---|---|---|
| Tourelle Gatling | 14 | 16 m | 0,35 s |
| Batterie Patriot | 55 | 24 m | 1,8 s |

L'IA en construit jusqu'à deux, elles défendent donc aussi sa base.

## 14. Pause

Bouton ⏸ de la barre de commandement, ou <kbd>P</kbd> / <kbd>Espace</kbd>.

La pause **gèle entièrement la simulation** : unités, chantiers, production,
récolte, IA, brouillard et synchronisation réseau. La caméra reste libre pour
inspecter la carte. <kbd>Échap</kbd> ou « Reprendre » relance.

Elle n'est proposée qu'en **escarmouche contre l'IA** (`settings.ai !== 'none'`
et aucun autre joueur humain connecté) : en P2P, mettre en pause pour soi
désynchroniserait les autres clients.

## 15. Modes d'unité (IA façon Generals)

Chaque unité porte un **mode explicite** qui pilote son déplacement, calqué sur
l'enum d'`AIUpdate.cpp` de Generals. Le combat ne décide plus du mouvement :
il ouvre simplement le feu sur ce qui est à portée.

| Mode | Comportement |
|---|---|
| `guard` | tient sa position, tire sur ce qui entre à portée, **ne poursuit pas** |
| `guardRetaliate` | riposte avec une laisse (revient à son poste ensuite) |
| `moveTo` | va au point, puis passe en garde sur place |
| `attackMove` | avance vers le point en engageant tout sur son passage, reprend ensuite |
| `attackObject` | poursuit la cible désignée, s'arrête à portée de tir, s'arrête à sa mort |

**Règles clés :**

- Une unité **ne monte jamais sur sa cible** : `stopDistance = portée × 0.8`.
  C'était le bug « il continue jusqu'à sa cible ».
- Une unité touchée en `guard` passe en `guardRetaliate` : elle riposte puis
  revient à son poste, au lieu de rester passive ou de courir partout.
- Le collecteur garde sa machine à états (`toField` / `harvesting` /
  `toRefinery`) : un ordre manuel le bascule en `moveTo`, et il **reprend son
  cycle tout seul** à l'arrivée.

**Commandes** (A et S sont pris par la caméra ZQSD) :

| Touche | Effet |
|---|---|
| Clic droit sur le sol | déplacement (`moveTo`) |
| Clic droit sur un ennemi | assaut (`attackObject`) |
| <kbd>X</kbd> puis clic | attaque-mobile |
| <kbd>C</kbd> | halte (garde sur place) |
| <kbd>H</kbd> | garde explicite |

**Aéronefs** : altitude de croisière à 9 unités avec ombre portée au sol,
décollage et atterrissage lissés. Sans ordre et loin de leur base ils y
retournent, puis se posent (y ≈ 1,4) jusqu'au prochain ordre.

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
CAC.audio        // moteur audio (ctx, volumes, séquenceur)
CAC.debug        // select · attack · move · spawn · money · screenOf
```

`CAC.debug` reproduit exactement ce que font la souris et le clavier, ce qui
permet de tester une mécanique sans jouer 10 minutes :

```js
const id = CAC.debug.spawn('paladin', -120, -120);   // unité instantanée
CAC.debug.select([id]);                              // sélection
CAC.debug.attack(cibleId);                           // ordre d'assaut
CAC.debug.move(x, z);                                // ordre de déplacement
```

## Lancer en local

```bash
python3 -m http.server 8080
# puis http://localhost:8080
```

## Limites connues

- Pas de pathfinding : les déplacements sont directs, les unités peuvent se
  chevaucher et traverser les bâtiments.
- Pas de brouillage effectif pour le Char Tempête (le drapeau `jam` est déclaré
  mais l'effet n'est pas encore implémenté).
- Pas de téléportation par tunnels (bâtiment décoratif + défense).
- Pas de reconnexion : un joueur qui ferme l'onglet laisse ses unités figées
  puis elles disparaissent au bout de 2,5 s.
- Les relais MQTT/BitTorrent sont publics et best-effort.
