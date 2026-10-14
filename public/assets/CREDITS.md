# Asset credits

All third-party art in this project is CC0 (public domain). Credit isn't required, but it's appreciated.

## Original (made for this project with Meshy) — `meshy/`

Generated with Meshy (meshy.ai) on a paid plan, so the outputs are ours to use commercially. Designs are
original; the style brief is in `docs/art-bible.md`. Prompts, settings and task ids for every asset are in
`assets-src/meshy/*/manifest.json`; `tools/blender/import_meshy.py` builds the game file.

| File | Contents |
|---|---|
| `meshy/Warrior.glb` | Warrior character (northern mercenary), rigged by our `tools/blender/auto_rig.py`, 19 Meshy library animations (retargeted, renamed, trimmed), and his greatsword, arming sword and round shield |
| `meshy/BattleMage.glb` | Mage character (robed battle mage), rigged by `auto_rig.py`, reusing the Warrior's animations; holds KayKit's staff, wand and spellbook (CC0, below) as stand-ins |

## KayKit by Kay Lousberg — www.kaylousberg.com

License: CC0 1.0 (see `kaykit/licenses/`). Downloaded from the official repositories at https://github.com/KayKit-Game-Assets.

| Pack | Files used | Used for |
|---|---|---|
| Character Pack: Adventurers 1.0 | `characters/Knight.glb`, `Rogue_Hooded.glb`, `Rogue.glb`, `Mage.glb` | Ranger, Rogue (models, weapons, animations); Knight's and Mage's weapons for skeleton enemies; Mage's staff, wand and spellbook baked into `meshy/BattleMage.glb` |
| Character Pack: Skeletons 1.0 | `characters/Skeleton_Minion.glb`, `Skeleton_Warrior.glb`, `Skeleton_Mage.glb` | Skeleton, Bone Brute, Hexer |
| Dungeon Remastered 1.0 | `dungeon/*.glb` (floor tiles, wall, pillar, torch, chests, props) | Dungeon geometry and chests |

Support the artist: https://kaylousberg.itch.io · https://patreon.com/kaylousberg
