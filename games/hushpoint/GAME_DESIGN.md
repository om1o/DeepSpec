# HUSHPOINT — vertical-slice design contract

## Promise

HUSHPOINT is survival horror about sound, pressure, and unreliable memory. It is deliberately not an action horde game. The player should leave a room wondering whether the ammunition spent there was worth the noise.

## Plot and lore — The Rehearsal Error

In 1958, Hushpoint opened as a tidal control station protecting Kinmouth Harbor. Twenty years later, its owners converted the lower chambers into Project PALINODE, an emergency-call prediction archive using a pressure-sensitive mineral called vesperite.

PALINODE does not merely replay the dead. It predicts likely calls, then manipulates powered doors, pumps, speakers, and frightened operators until reality matches the recording. During the 1989 Quiet Night storm, saturation diver Gideon Rusk sealed the archive and grounded its carrier through his regulator. The company blamed him for the disaster. He became the Bellman because he was the lock, not the mastermind.

Present day, 52-year-old field engineer Lena Orr is sent to compare a faulty digital tide reading against a physical gauge. Her real dispatcher, June Halden, establishes normal radio procedure before the station fabricates an order in June's voice. PALINODE created the fault because Mara Orr's cancellation lock requires a living Orr voice. Mara's authentic recording tells Lena to trust ink and brass, free Gideon from the three crystals driving his regulator, purge the archive, escape to the surface, and refuse the final predicted call.

## Slice flow

1. **A Normal Call** — arrive outside, read the work order, take the inspection lamp, and compare physical and digital water levels. No weapon or threat.
2. **The First Contradiction** — reset relay R-4, receive tomorrow's packet, log the 23 cm mismatch on paper, and hear an unplugged speaker repeat Lena.
3. **The Building Listens** — cross the station threshold, recover a six-round response handgun, restore emergency power, and survive the first Listener.
4. **The Records Annex** — manage six slots, collect three spool fragments, read the shallow-water Wader threat, and open the route toward Mara's recording.
5. **Mara's Real Message** — learn that PALINODE predicts and coerces, and that Gideon is its grounding circuit.
6. **The Bellman** — lure Gideon to steam, expose three regulator crystals with the lamp, and free rather than kill him.
7. **Counterflow** — engage three noisy breakers. The third unlocks an escape; it does not end the game.
8. **Return to the Surface** — cross the transformed exterior and physically break or answer a call from `LENA ORR / +00:17`.

The authored target is a 25–42 minute first playthrough. Correctness tests cannot prove pacing, fear, or fun; blind human playtesting remains required.

## Core loop

Explore an interlocked hub → inspect clues and locks → choose what to carry → solve physical machinery → decide whether to fight, evade, or distract → recover a key resource → return to safety under greater stalker pressure.

## Mechanics

- Eight ordered outdoor service interactions teach inspection, objective provenance, and contradiction-reading before any enemy or weapon appears.
- Third-person over-the-shoulder movement, sprint, crouch, quick turn, shoulder aim.
- Six-slot inventory with separate Files and Objectives tabs; a safe-room field case opens the same inventory screen.
- Inspection lamp reveals vesperite weak points; it overheats rather than consuming batteries.
- The response handgun is acquired only after Lena enters the station; the surface sequence cannot aim, fire, reload, or display ammunition.
- Handgun ammunition is limited. Body shots stagger; node shots permanently neutralize.
- Downed enemies can recover while their node survives.
- Noise decoys and steam valves create deliberate stalker counterplay.
- Stable, Wounded, and Critical health states; no floating numeric health bar.
- Manual safe-room save plus milestone checkpoints.
- Inspectable key items, physical control panels, doors, and lore terminals.
- Objectives identify whether an instruction came from the paper work order, verified Control, Mara's recording, or PALINODE; the source is part of the puzzle language.
- Counterflow opens a physical escape route. The ending occurs only after Lena crosses the altered surface and chooses whether to break or answer the predicted radio call.

## Enemy language

- **Listener:** slow sight-and-sound hunter with one exposed node.
- **Wader:** hides low in shallow water, rises when alerted, and telegraphs a fast close rush.
- **Chorus:** stationary wall colony that emits a loud alert tone and alerts other enemies.
- **The Bellman:** persistent brass-suited stalker. He has poor sight, exceptional hearing, and cannot enter the safe room. His bell and state tones communicate pursuit; he never teleports into the current room or camera view.

## Puzzle contract

- Emergency power: match two printed fuse ratings; printed numbers support the color cues.
- Archive spool: collect three pieces and assemble Mara's real message.
- Tide balance: set three physical valves to the maintenance schematic. A reset control prevents softlocks.
- Counterflow: activate three noisy purge breakers while the Bellman searches the vault.

## Visual and audio direction

Wet concrete, low ceilings, oxidized brass, black water, cyan inspection light, amber safety lamps, red emergency strobes, emissive vesperite, depth fog, sparks, steam, dust, muzzle flash, impact particles, camera recoil, restrained vignette, spatial machinery, movement-paced footsteps, and an original procedural industrial drone.

Effects exist to communicate danger and material—not to cover the screen. Reduce-hard-flashes suppresses lightning, muzzle, impact, and damage flashes; reduced camera shake is independently selectable.

## Real-world grounding

The surface route borrows only broad engineering reality: physical water-level verification, telemetry cabinets, relay equipment, flood-barrier access controls, surge-watch terminology, and maintained civic infrastructure. It does not reproduce a real facility or operating procedure.

- [NOAA — What is a tide gauge?](https://oceanservice.noaa.gov/facts/tide-gauge.html)
- [U.S. Army Corps of Engineers — Fox Point Hurricane Barrier](https://www.nae.usace.army.mil/Missions/Civil-Works/Flood-Risk-Management/Rhode-Island/Fox-Point/)
- [U.S. Army Corps of Engineers — New Orleans PCCP](https://www.mvn.usace.army.mil/Missions/HSDRRS/PCCP.aspx)
- [National Weather Service — hurricane watch and warning terminology](https://www.weather.gov/safety/hurricane-ww)
- [Rijkswaterstaat — Maeslant Barrier](https://www.rijkswaterstaat.nl/en/projects/iconic-structures/maeslant-barrier)

## References and provenance

| Reference | Lesson used | Boundary |
| --- | --- | --- |
| [Resident Evil 2 — official PlayStation hands-on](https://blog.playstation.com/2018/12/04/hands-on-with-resident-evil-2-on-ps4/) | Interconnected exploration, inventory pressure, puzzle/combat/evasion rhythm. | No Raccoon City, police station, Umbrella, zombies, herbs, typewriters, medallions, characters, UI, or puzzle solutions. |
| [Alien: Isolation — official Sega site](https://alienisolation.sega.jp/battle.html) | A stalker that reacts to player-created sound instead of following a visible fixed patrol. | No xenomorph anatomy, vents, motion tracker, retro-space setting, flamethrower loop, or Alien terminology. |
| [Dead Space — official EA intensity article](https://www.ea.com/en-gb/inside-ea/news/inside-dead-space-4-the-intensity-director) | Readable weak points, environmental storytelling, and tension that ebbs instead of staying at maximum. | No spacecraft, Necromorphs, dismemberment, plasma cutter, telekinesis, zero gravity, or RIG interface. |

Reuse type for the three games: **idea only**. No reference-game asset or code was used. One original tide-gauge concept and source mesh were generated for HUSHPOINT through Higgsfield and then cleaned, validated, and exported through Blender; its exact prompts, IDs, hashes, cost, and commercial-license caveat are recorded in `THIRD_PARTY_NOTICES.md` and `assets/README.md`.
