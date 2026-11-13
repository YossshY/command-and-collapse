# Modèles 3D — provenance et licence

Les fichiers `.glb` de ce dossier ne sont pas de moi. Ils proviennent d'un pack
**CC0 (domaine public)**, ce qui autorise explicitement la redistribution dans un
dépôt public, y compris commerciale, sans attribution obligatoire.

## KayKit — Space Base Bits 1.0

- Auteur : Kay Lousberg — <https://kaylousberg.com>
- Source : <https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0>
- Page : <https://kaylousberg.itch.io/space-base-bits>
- Licence : **CC0 1.0** (`LICENSE.txt` du pack, repris ci-dessous)

> License: (Creative Commons Zero, CC0)
> http://creativecommons.org/publicdomain/zero/1.0/
> This content is free to use in personal, educational and commercial projects.
> Support me by crediting Kay Lousberg, www.kaylousberg.com (this is not mandatory)

## Conversion

Les modèles d'origine sont en `.gltf` + `.bin` + une texture partagée
(`spacebits_texture.png`). Ils ont été empaquetés en `.glb` autonome avec
`@gltf-transform/cli` :

```bash
npx @gltf-transform/cli copy basemodule_A.gltf basemodule_A.glb
```

Aucune retouche de géométrie : seule la mise en boîte (échelle, pose au sol,
centrage) est faite au chargement, dans `buildingFromModel()` d'`assets.js`.

## Correspondance jeu ↔ modèle

| Bâtiment (shape) | Fichier |
|---|---|
| `cc` — Centre de Commandement | `basemodule_E.glb` |
| `power` — Réacteur / Centrale | `windturbine_tall.glb` |
| `supply` — Dépôt | `cargodepot_A.glb` |
| `refinery` — Raffinerie (extraction) | `drill_structure.glb` |
| `barracks` — Caserne | `basemodule_A.glb` |
| `factory` — Usine | `basemodule_garage.glb` |
| `airfield` — Aérodrome | `landingpad_large.glb` |
| `research` — Centre de recherche | `structure_tall.glb` |
| `defense-light` — Tourelle | `structure_low.glb` |
| `defense-heavy` — Batterie Patriot | `lander_B.glb` |

Les shapes absentes de la table (`palace`, `tunnel`) gardent les formes
procédurales d'`assets.js`. Idem si un fichier est supprimé ou ne se charge pas.

## Limite connue

Ces modèles ne sont **pas teintables** : ils utilisent un atlas de texture
peint, donc on ne peut pas les recolorer à la couleur de la faction. Une marque
annulaire colorée est posée au sol sous chaque bâtiment pour l'identification.
Les unités, elles, restent entièrement procédurales et teintées par faction.
