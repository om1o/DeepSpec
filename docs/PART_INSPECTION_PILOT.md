# Human inspection: first pilot increment

DeepSpec now lets a person record an inspection on a saved scan. Open a result
from History, expand **Human inspection**, enter the checks performed and an
inspector name, then select **Save inspection**. The text report includes the
inspection separately from the AI answer.

Identity and part number require supporting evidence. Visible damage and
uncertainty require notes. A functional-test outcome requires a test method and
result. Defaults are **Not inspected** and **Not tested**; appearance never
establishes function. Inspector names are self-reported, not authenticated
signatures or certifications.

## Persistence and rollout

- Local saves preserve the AI result, feedback and training labels.
- Inspection does not grant training consent or automatically train a model.
- Configured cloud sync stores a separate `inspection_json` field. Cloud-only
  scans use an owner-scoped metadata update without reuploading signed images.
- Apply `supabase/migrations/20260920000100_part_inspection.sql` through the
  project's normal database deployment process before expecting cloud writes.
  This migration has not been applied by this implementation task.
- Older database schemas remain readable. Missing migrations cause an explicit
  sync failure; the locally saved inspection remains available.
- Cloud writes remain last-write-wins. Concurrent inspection editing, version
  history, and conflict resolution are not implemented. History chooses the
  newer inspection timestamp when combining a local and cloud copy.

## What this increment does not prove

It does not add 3D measurement, identify hidden failures, certify a part, license
a parts catalog, or establish model accuracy. Automated cloud tests use mocks;
live database/RLS verification is still required after migration deployment.

## Next pilot experiment

Recruit one parts business and select one part category together. Have staff
record the existing identification/documentation time, then repeat with
DeepSpec. Record correct identity, unresolved cases, wrong confident answers,
documentation completeness, and time per part. Use different physical parts
for evaluation and any later training, with explicit permission for reuse.
Use measured results and willingness to pay to decide the next feature.
