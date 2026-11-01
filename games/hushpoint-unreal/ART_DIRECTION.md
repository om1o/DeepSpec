# HUSHPOINT Unreal art direction — Pressure Gradient

## Decision

HUSHPOINT uses all three approved directions as one escalating system:

1. **60% Storm Authority** is the global visual language. Exterior routes, safe rooms, ordinary station spaces, characters, props, and menus stay grounded in believable coastal public infrastructure.
2. **30% Blackwater Pursuit** controls normal underground play. Tighter framing, selective darkness, shallow floodwater, negative space, and sparse practical lights support the sound-reactive stalker loop.
3. **10% Counterflow Cathedral** appears only in the Bellman and final purge spaces. Monumental scale is a climax, not the default room size.

This is not three mixed styles. Materials, safety colors, character design, prop language, and weather remain consistent; only framing, light density, and architectural scale escalate with the story.

## Reference boards

| Direction | Project image | Production use | Cost/risk |
| --- | --- | --- | --- |
| Storm Authority | [direction A](SourceAssets/art-direction/direction-a-storm-authority-openai.png) | Exterior, entrance, safe rooms, most traversal | Lowest; baseline kit and lighting language |
| Blackwater Pursuit | [direction B](SourceAssets/art-direction/direction-b-blackwater-pursuit-openai.png) | Flooded service galleries, Listener/Wader pressure | Medium; reflection and darkness need careful profiling |
| Counterflow Cathedral | [direction C](SourceAssets/art-direction/direction-c-counterflow-cathedral-openai.png) | Bellman reveal and purge finale only | Highest; one bounded set piece, not a whole-game target |

The images are composition and mood references, not runtime textures, geometry, characters, or a promise that every detail will be built. Exact prompts, sources, and hashes are in [art_direction_lineage.json](SourceAssets/art-direction/art_direction_lineage.json). Higgsfield supplied the project’s original floodlight concept and source mesh; its lineage remains in [higgsfield_floodlight_lineage.json](SourceAssets/reports/higgsfield_floodlight_lineage.json).

## Shared visual grammar

### Palette

- Storm blue-gray and wet graphite define the world.
- Sodium amber identifies safety, human maintenance, and trustworthy physical evidence.
- Desaturated green identifies legacy machinery and ordinary station power.
- Emergency red is reserved for active threat, breaker state, or an invalid procedure.
- PALINODE cyan is rare, cold, and visibly artificial; it never replaces readable navigation contrast.

### Materials

- Poured concrete, galvanized steel, painted pipework, marine rubber, glass gauges, salt bloom, oil, and rain are the core library.
- Wear follows use: hands polish handles, boots clear grime from routes, salt accumulates on windward faces, and leaks stain downward.
- Six reusable material families cover concrete, painted steel, galvanized metal, oxidized brass, shallow water, and emissive glass. Wetness is layered selectively; the whole level must not look uniformly mirror-coated.
- Safety markings use original generic symbols and numbers; no reference-game logos, signage, UI, or puzzle iconography.

### Camera

- Default play uses a close right-shoulder camera with collision and a stable screen-space reticle: about 68° FOV, a 320–335 cm boom, and a 62 cm shoulder offset.
- Aiming narrows toward 58° FOV with a 260–270 cm boom and about a 72 cm shoulder offset. Sprint may widen only to 71–72°.
- Normal exploration stays near the grounded Storm Authority framing.
- Blackwater spaces tighten sight lines through architecture, not forced zoom or excessive camera shake.
- Counterflow may widen for authored reveal moments, then returns control and the normal gameplay camera.
- Reduced-camera-motion disables shake, recoil impulse, and aggressive reveal moves without changing required aiming or traversal.

### Lighting

- Every gameplay room has a readable practical-light explanation: work lamp, emergency strip, panel lamp, inspection light, or exterior storm opening.
- Cold storm light and warm maintenance light create the primary contrast.
- One hero shadow-casting practical is preferred over many overlapping expensive lights. Ordinary rooms should show no more than two overlapping shadowed movable lights, including Lena's lamp; supporting fixtures may be cheaper and non-shadowed after visual review.
- Emissive lenses communicate state, but real light components create the illumination; tiny emissive surfaces alone are not trusted to light gameplay.
- Exposure is locked or tightly constrained. Darkness may hide threat information, never the walkable route, interaction prompt, enemy tell, or accessibility focus.

## Environment allocation

### Storm Authority spaces

- Surface service route, flood barrier, tide gauge, station entrance, control room, safe room, workshops, and return-to-surface ending.
- Modular kit: concrete bays, marine doors, grated stairs, galvanized rails, cable trays, pipe families, gauge/panel families, drainage, and practical-light sockets.
- The Higgsfield/Blender floodlight is a prototype background/mid-distance fixture. Its coarse lamp reconstruction is not a close-up hero asset.

### Blackwater Pursuit spaces

- Intake galleries, maintenance corridors, spool route, flooded pump access, and Listener/Wader encounters.
- Playable water remains ankle-to-shin deep and uses bounded planes with authored ripples and reflection settings; no swimming system or unbounded fluid simulation is implied by the waist-deep concept board.
- Negative space, occluding pipework, and audio create uncertainty. Fog is local and low, not a screen-wide gray filter.

### Counterflow Cathedral spaces

- One Bellman chamber and the connected purge reveal. Forced perspective and occluded vistas create scale without building a fully traversable cathedral.
- Large forms are modular repetitions of the same civic kit, not a second unrelated architecture set. Architecture used by Software Lumen must be closed, sensibly thick, and split into room-scale meshes rather than one station-sized shell.
- Distant waterfalls, mist, and moving machinery use bounded effects and impostor/mesh solutions where possible.
- The scene must remain navigable and mechanically legible: steam exposure, three regulator hits, breaker route, and escape path each get distinct silhouette and color cues.

## Enemy and interaction readability

- Listener: narrow silhouette and a clear head/neck node revealed by the lamp; sound investigation is readable through pose and audio.
- Wader: low water displacement and a bright pre-rush tell before emergence.
- Chorus: wider silhouette and a visible alert pulse that does not rely only on color.
- Bellman: tall corroded civic-machine profile, bell audio, and three exposed regulator states. It must not copy existing creature anatomy.
- Physical evidence uses brass, paper, stamped metal, or mechanical indicators. PALINODE information uses screens and cyan light. Players can identify source trust at a glance.

## Performance contract

- Initial target: 1280×720, 30 fps, Windows, Deferred DX12/SM6, Software Lumen, hardware ray tracing off. The frame budget is 33.3 ms and evidence must report p95 CPU/GPU time, not only an average.
- Intel Iris Xe is outside Epic's named current Lumen GPU families. Software Lumen is experimental until measured; no concept image is performance evidence.
- Profile one representative Storm Authority exterior, one Blackwater encounter, and the Counterflow chamber separately. Use `stat unit` and `stat gpu` for live triage, then record a repeatable Unreal Insights trace (or exported equivalent samples) for the reported p95; a single stat screenshot is not p95 evidence.
- Counterflow spectacle is cut first if it prevents readable 30 fps play; mechanics and route clarity are not sacrificed for mist, reflections, or distant machinery.
- The non-manifold generated floodlight render mesh requires distance-field review. Use its authored simple UCX collision, never complex-render-mesh collision.

## Acceptance images

Before the art direction is called implemented, capture these same five views from a packaged build:

1. Surface approach with cold storm light, warm station entry, and readable route.
2. Safe room with calm human maintenance lighting and no threat ambiguity.
3. Blackwater gallery with player, visible route, one enemy tell, and readable water edge.
4. Bellman chamber wide reveal with steam/regulator/breaker silhouettes all legible.
5. Reduced-flash and reduced-camera-motion comparison frames from the same gameplay state.

The packaged captures are the acceptance evidence. These concept boards are the target conversation, not the pass condition.

## Reference boundary

Resident Evil 2 contributes only the abstract rhythm of revisitable exploration and inventory pressure. Alien: Isolation contributes only sound-reactive pursuit. Dead Space contributes only readable weak points, environmental storytelling, and intensity valleys. HUSHPOINT copies no character, creature, location, story, logo, interface, animation, model, texture, sound, or puzzle solution from those games.
