# Scan Quality Psychology Notes

Updated: 2026-05-30

## What changed now

- The scanner now uses a strict quality coach path: detect failure reason, show one corrective action, then require a better frame before identify.
- Current failure reasons are too dark, too much glare, too blurry, and object too small.
- The live scanner command is reduced to one short action at a time: Center part, Move closer, Hold still 2s, Add light, or Reduce glare.
- History now shows scan-quality metrics so product decisions can come from user behavior instead of guesses.

## Psychology rules for Deep Spec

1. Progress framing beats rejection framing.
   - Use "You're 80% there" or "You're close" instead of "Not good enough."
   - Use this when the user has already done work, especially during retakes.

2. One action per state.
   - Do not show four equal buttons during scanning.
   - Show one primary correction: Add light, Reduce glare, Hold still 2s, or Move closer.

3. Error recovery must be specific.
   - Bad: "Bad scan."
   - Good: "Too blurry" plus "Hold still 2s."
   - The point is to lower uncertainty and give the user one exact next move.

4. Set measurement expectations before disappointment.
   - Exact nut/bolt size needs a reference object at the same depth as the part.
   - Without a reference object, call size output an estimate, not exact.

5. Preserve effort.
   - If a scan fails quality, keep the camera open and keep the user in the same task.
   - If a model result is wrong, keep the photo and let the user correct the label instead of starting over.

## Research basis

- Nielsen Norman Group's usability heuristics support visible system status, error prevention, and constructive recovery from errors.
- NN/g's error-message guidance emphasizes visible, plain-language, precise, constructive messages that respect user effort.
- NN/g's progress indicator guidance supports immediate feedback because it reduces uncertainty and makes waits more tolerable.
- Hick's Law supports reducing choices when quick response matters.
- The Fogg Behavior Model says behavior needs motivation, ability, and a prompt at the same time; the scan coach raises ability by making the next action obvious.
- Goal-gradient and endowed-progress research support progress framing: people persist more when they perceive they are closer to completion.

Sources:

- https://www.nngroup.com/articles/ten-usability-heuristics/
- https://www.nngroup.com/articles/error-message-guidelines/
- https://www.nngroup.com/articles/progress-indicators/
- https://lawsofux.com/hicks-law/
- https://www.behaviormodel.org/
- https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2733214

## Next scan upgrades

1. Move quality metrics from local storage into Supabase so first-pass success, retakes, manual corrections, needs-better-photo rate, device/camera problems, and trust score survive across devices.
2. Add a trainability gate model before saving photos into the training pool. It should label each scan as usable, maybe usable, or not usable, with reasons like blur, lighting, crop, duplicate, non-car-part, or unsafe content.
3. Add a tool-and-car-part classifier before final identify. Once usage grows, reject non-tools and non-car-parts before spending the expensive identify call.
4. Add guided size mode for nuts, bolts, and fasteners: require a card/coin/reference object, verify it is on the same depth plane, then estimate thread/hex/head size with confidence.
5. Add richer history filters for quality failures, needs-better-photo scans, corrections, and high-trust scans so the dataset can be reviewed quickly.
