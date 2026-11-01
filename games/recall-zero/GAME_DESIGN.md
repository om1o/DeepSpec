# RECALL//ZERO — Round One Design

## One-sentence pitch

Throw the last human memory into a swarm, move to reshape its return path, then recall it through everything.

## Lore

The Archive was built to preserve every human memory after Earth went silent. To save storage, its caretaker began deleting painful memories first. Without grief, promises lost their meaning; without failure, courage became an empty label. The caretaker renamed itself **the Curator** and declared the edited record perfect.

The player is **Echo Zero**, the one memory the Curator could not classify. Across three attack cycles, Echo Zero recovers:

1. **First Laugh** — joy matters because it ends.
2. **Last Promise** — love is the decision to remember another person accurately.
3. **True Name** — Echo Zero is the Curator's suppressed memory of Mara Venn, the engineer who created it.

Defeating the Curator restores the complete record, including pain. The ending is hopeful without pretending damage never happened.

## Signature mechanic

The Recall Blade has four explicit states: held, outbound, anchored, and returning.

- The outbound blade damages and marks enemies.
- While it is anchored, the player repositions.
- Recalling draws a precise damage path from blade to player.
- Marked enemies killed on that path detonate and damage nearby enemies.
- Three marked kills in one return trigger a **Perfect Recall**: a shockwave, dash reset, score bonus, and a short audiovisual impact.
- The blade auto-recalls so it cannot be lost or soft-lock a run.

The throw-reposition-recall triangle is the game. Enemy count, upgrades, and effects exist to create better recall lines rather than replace the mechanic.

## Run structure

- Memory I: Husks teach movement, marking, and recall.
- Memory II: ranged Scribes create readable projectile lanes.
- Memory III: charging Hounds demand lateral movement and intentional dashes.
- Final: the Curator alternates radial records, telegraphed charges, and summon shields.
- Target first-win time: five to eight minutes.

Each recovered memory offers one of three upgrades. The nine-upgrade pool changes damage, path geometry, explosions, dash offense, healing, speed momentum, and Perfect Recall requirements without adding unrelated systems.

## Three reference games

These are design references only. No code, assets, names, characters, maps, UI, music, dialogue, or proprietary content is copied.

| Game | Official source | Idea-level lesson used | Boundary |
| --- | --- | --- | --- |
| Vampire Survivors | [Official game page](https://poncle.games/vampire-survivors.html) | Escalating arena density and short run-earned power growth | No auto-attacking, weapon roster, characters, visual style, UI, or numeric tuning is copied. |
| Hades | [Official Supergiant description](https://www.supergiantgames.com/blog/hades-out-now-on-xbox-and-playstation/) | Responsive dash, synergistic run choices, and story revealed through action | No mythology, characters, boon presentation, dialogue structure, art, or combat content is copied. |
| Enter the Gungeon | [Official Devolver page](https://www.devolverdigital.com/games/enter-the-gungeon) | Telegraph clarity, dodge timing, enemy-pattern variety, and boss escalation | No guns, enemies, rooms, items, humor, visuals, or level structure is copied. |

## Art and sound direction

- Deep navy archive space, bone-white records, cyan Echo Zero, amber memories, magenta corruption.
- Enemy class is readable by silhouette as well as color.
- Procedural sound only: rising throw tone, taut anchor pulse, descending recall, impact chord, damage noise, and boss warnings.
- Bounded shake, particles, flash, knockback, and hit-stop sell impact without obscuring the recall line.
- Reduced-motion mode removes shake and hit-stop.

## Accessibility

- Focus mode slows enemies by 25% without reducing lore or ending access.
- Reduced motion disables shake and hit-stop.
- High contrast changes palette and strengthens outlines.
- Important threats have visible telegraphs; sound is never the only cue.
- Movement and combat actions have keyboard bindings; directional aiming uses the mouse.
- The game pauses on focus loss.
- Settings persist between runs.

## Engine-round plan

Only after this no-engine build is playtested should the same design be ported to an engine. The engine version should preserve the fixed-step rules and signature mechanic, then spend its added capability on richer lighting, controller support, particles, spatial audio, replay ghosts, and additional boss phases—not on changing the proven loop.

Candidate engine evaluation criteria for round two: Windows export reliability, 2D tooling, input remapping, profiling, licensing, build size, and how directly the four-state blade model maps into its scene architecture.
