# DeepSpec V1 → V2 Master Product & Engineering Plan

You are working on **DeepSpec**, an AI-powered automotive platform focused on identifying car parts from images and helping users understand the part, its condition, value, usage, and related information.

Treat the following as the current product direction and engineering plan.

## PRIMARY GOAL

We are targeting a **real-user DeepSpec V1 launch within approximately one month maximum**.

We are reaching the point where the core product has enough functionality. Do not continuously expand V1 with unnecessary features.

The objective now is:

**Finish → stabilize → polish → test with real people → launch → collect high-quality data → use that data to build V2.**

The core V1 promise should remain extremely clear:

**Take a photo of a car part → DeepSpec identifies it → provides useful information → lets the user inspect the result and easily report or correct problems.**

V1 does NOT need to contain every future DeepSpec idea.

---

# 1. V1 PRIORITIES

Before public launch, prioritize:

1. Reliable image scanning
2. Accurate car-part identification
3. Good-looking and usable AR
4. Reliable Supabase backend
5. Image and analysis persistence
6. Excellent feedback/reporting
7. Training-data collection architecture
8. User consent/privacy controls
9. Internal review/dashboard tools
10. Error monitoring and analytics
11. Mobile responsiveness
12. UI/UX polish
13. Production reliability
14. Cost/rate-limit protection
15. Real-user testing

Do not delay V1 for speculative V2 features unless they are necessary to collect useful V2 data.

---

# 2. SUPABASE

Use the connected **Supabase tooling/plugin** whenever appropriate for Supabase work.

Do not assume old Supabase/Auth bugs are still present. Verify the CURRENT state before changing working systems.

Supabase should support the durable DeepSpec data system.

We need to preserve data around:

- Users
- Scans
- Original uploaded images
- Cropped/detected part images when available
- AI analysis
- Predicted part
- Candidate parts
- Confidence scores
- OCR
- Vehicle information when known
- Condition assessment
- Value/valuation result
- Model/provider used
- Model version
- Prompt/pipeline version when useful
- User rating
- User correction
- Feedback category
- User notes
- Chat/message count where relevant
- Model-run metadata
- Sync events
- Error information
- Review status
- Training consent
- Training eligibility/status
- Human verification
- Dataset version

Images should use appropriate private Supabase Storage policies rather than simply exposing raw uploads publicly.

---

# 3. FEEDBACK IS A CORE V1 FEATURE

DeepSpec V1 should provide MANY easy ways for users to report problems.

Feedback is not an afterthought.

It is one of the mechanisms through which V2 gets better.

Possible feedback paths include:

### Wrong result

Every scan result should make it easy to report that DeepSpec was wrong.

Possible reasons:

- Wrong part
- Wrong vehicle
- Wrong value
- Wrong condition assessment
- Missing information
- Bad explanation
- Other

### Correct the AI

Users should be able to provide the correct identification.

Example:

DeepSpec prediction:
Alternator

User correction:
A/C compressor

Corrections like this are potentially extremely valuable labeled examples.

### AR feedback

Provide an easy way to report:

- Wrong AR placement
- Highlight on wrong component
- Jitter/shaking
- Tracking lost
- Overlay disappeared
- Camera issue
- Incorrect label
- Poor detection
- Other AR problem

### General bug report

A global bug-report option should exist.

### Feature request

Users should be able to suggest functionality they want in V2.

### Quick rating

Allow lightweight feedback such as positive/negative or another simple rating mechanism.

Do not make feedback so annoying that users stop submitting it.

### Additional context

Users should optionally be able to explain what went wrong and attach supporting imagery/screenshots where appropriate.

---

# 4. AUTOMATIC DEBUG CONTEXT

When appropriate and privacy-safe, reports should automatically include useful technical context so the user doesn't have to know what information engineers need.

Examples:

- Scan ID
- Session ID
- User ID or appropriate anonymous identifier
- Timestamp
- Original prediction
- Confidence
- Candidate results
- Model/provider
- Model version
- Pipeline version
- App version
- Browser/device information
- Relevant errors
- AR state
- Image reference
- Previous correction
- Relevant latency/performance information

Do NOT silently collect unnecessary sensitive information.

---

# 5. FEEDBACK REVIEW WORKFLOW

Create or preserve an internal workflow approximately like:

**New → Reviewed → Confirmed Issue → Fixed**

Training-related examples can additionally move through:

**Training Candidate → Verified → Approved → Dataset**

The exact implementation can evolve, but we need to know which reports:

- Have not been reviewed
- Represent real product bugs
- Represent AI/model failures
- Were corrected by users
- Have been human verified
- Are useful for evaluation
- Are eligible for training
- Have already entered a dataset

---

# 6. IMAGES + DATA SHOULD SUPPORT FUTURE TRAINING

DeepSpec should be designed so that, with proper user consent and privacy handling, useful scans can eventually improve our models.

Conceptual pipeline:

**User image**
↓
**DeepSpec prediction**
↓
**Confidence + candidates + analysis**
↓
**User feedback/correction**
↓
**Quality/privacy checks**
↓
**Human/automatic review**
↓
**Approved training example**
↓
**Versioned dataset**
↓
**Evaluation / fine-tuning / specialized model training**

Do NOT automatically treat every upload as valid training data.

Users will upload:

- Blurry images
- Irrelevant objects
- Duplicate images
- Faces
- License plates
- Personal information
- Screenshots
- Random photos
- Incorrect corrections

Training eligibility therefore needs a deliberate review/quality process.

---

# 7. TRAINING CONSENT

Training consent must be explicitly represented.

Useful concepts/fields include:

- `training_consent`
- `training_status`
- `human_verified`
- `dataset_version`

Do not assume that because DeepSpec can technically store an image, it automatically has permission to use that image for model training.

The product should clearly communicate relevant data usage.

Design the architecture so opting out, deletion, and dataset lineage are manageable.

---

# 8. DATASET VERSIONING

Future training datasets should be versioned.

For example:

- DeepSpec Vision Dataset v1
- v1.1
- v2

We should be able to determine:

- Which examples entered a dataset
- Where the example originated
- What label was originally predicted
- What correction occurred
- Whether a human verified it
- Which model generated the original prediction
- Whether the example is still permitted for training

Do not build a mysterious folder containing 80,000 JPEGs and call it machine learning infrastructure.

---

# 9. POSITIVE AND NEGATIVE EXAMPLES

We want to preserve BOTH successful and failed AI behavior.

### Good results

High-quality successful examples can become:

- Evaluation examples
- Positive training examples
- Prompt examples
- Regression tests

### Bad results

Do not simply delete bad generations.

Preserve useful failure information:

- What the model produced
- Why it was wrong
- Correct answer
- User correction
- Failure category
- Model/version
- Relevant image/context

These can become:

- Negative examples
- Evaluation cases
- Regression tests
- Prompt improvements
- Fine-tuning examples where appropriate

The goal is not simply:

**“Train on everything.”**

The goal is:

**Collect → classify → verify → curate → evaluate → train when justified.**

---

# 10. FIRECRAWL ROADMAP

Later, we may use **Firecrawl** as part of DeepSpec's data/evaluation pipeline.

Possible uses include gathering permitted external automotive information, structured research, feedback/results from appropriate sources, evaluation material, and other useful public information.

Firecrawl data should NOT automatically become trusted training truth.

External information should go through:

- Source tracking
- Deduplication
- Quality checks
- Licensing/usage review where necessary
- Validation
- Normalization
- Review

First-party DeepSpec user corrections and verified results may be significantly more valuable than random scraped material.

---

# 11. FUTURE CUSTOM MODEL

DeepSpec may eventually train or fine-tune its own specialized models.

This may include:

- Automotive image classification
- Part detection
- Part recognition
- Part ranking
- Condition detection
- Damage/rust detection
- OCR-related automotive systems
- Specialized embeddings
- Multimodal models
- AR-supporting vision models

However:

**Do not make custom-model training a V1 launch blocker.**

V1 should first generate high-quality real-world data.

Before training a custom model, determine whether improvements can be achieved through:

- Better prompts
- Better model routing
- Better retrieval
- Better image preprocessing
- Better candidate ranking
- Better context
- Better evaluation
- Existing model upgrades

Train/fine-tune when the dataset and evaluation evidence justify doing so.

---

# 12. IMAGE TRAINING

Images are particularly important to DeepSpec.

Where permitted, preserve useful information such as:

- Original image
- Detected part crop
- Bounding region/mask if available
- Part label
- Corrected label
- Vehicle context
- Condition
- Rust/damage information
- AI confidence
- Candidate list
- Human verification
- Model/version
- Training eligibility

This can eventually become a proprietary real-world automotive vision dataset.

Protect it appropriately.

---

# 13. AR IS REQUIRED TO LOOK GOOD IN V1

AR does NOT have to be unbelievably advanced before V1.

It DOES have to look polished enough for real users.

The quality standard is:

**Polished > overly ambitious.**

We would rather ship three good AR behaviors than twelve broken ones.

The target V1 AR experience is approximately:

**Open camera → scan → detect component → visually lock/highlight component → show identification overlay/card → tap for full DeepSpec analysis**

AR should avoid:

- Constantly jumping labels
- Severe jitter
- Obviously incorrect anchors
- Broken overlays
- Bad transitions
- UI covering important camera content
- Pretending confidence exists when it doesn't

Provide graceful failure states such as:

- Move closer
- Move farther away
- Hold camera steady
- Improve lighting
- Try another angle
- Part not confidently detected
- Use standard photo scan instead

AR overlays should feel integrated into DeepSpec rather than like HTML stickers floating randomly over a camera.

Test AR on multiple realistic mobile devices and screen sizes.

---

# 14. AR FEEDBACK SHOULD FEED V2

AR failures should also become structured feedback.

When possible, preserve information such as:

- What component DeepSpec thought it detected
- Where the highlight appeared
- Tracking confidence
- Device/browser/app information
- Relevant frame/image
- User-reported issue
- Correct component if supplied

This information can eventually improve detection/tracking systems.

---

# 15. ONE-MONTH V1 LAUNCH STRATEGY

Use approximately this progression rather than blindly following dates if the current codebase is ahead or behind.

## Week 1: Foundation

Finish/verify:

- Supabase
- Auth
- Storage
- Scan persistence
- Analysis persistence
- Feedback tables
- Training consent/data fields
- Error handling
- Security policies
- Production configuration

## Week 2: Scanning + AR Quality

Stress-test:

- Real automotive images
- Identification
- Candidate ranking
- Confidence
- Bad images
- Different lighting
- Different angles
- Different vehicle types
- AR tracking
- AR overlays
- Failure states
- Mobile UI

Record failures instead of merely fixing one-off examples.

## Week 3: Small Real-User Beta

Put DeepSpec in front of approximately **5–15 trusted real users**.

Do not over-explain the interface.

Observe where users naturally get confused.

Measure:

- Scan success
- Wrong identification
- Corrections
- AR failures
- Response latency
- Crashes
- User reports
- Whether the answer was useful
- Whether users understand what to do next

Use feedback to fix recurring problems.

## Week 4: Launch Candidate

Focus on:

- Recurring bugs
- UX confusion
- Reliability
- Onboarding
- Privacy
- Terms
- Analytics
- Monitoring
- Rate limiting
- Cost controls
- Mobile testing
- Production security
- Public website
- Final production verification

Avoid adding random major features during this stage.

---

# 16. V1 VS V2

## V1

V1 proves:

**People can photograph a car part and DeepSpec can give them genuinely useful information.**

V1 also begins generating the dataset required to improve DeepSpec.

## V2

V2 can be driven by actual V1 evidence.

Potential V2 work includes:

- Better identification models
- Better AR
- Specialized automotive vision
- Better condition/damage detection
- Better valuation
- Improved model routing
- Custom fine-tuned models
- Larger verified datasets
- Firecrawl-supported research/data pipelines
- Features repeatedly requested by real users

Do not decide V2 solely from guesses.

Use V1 telemetry, reports, corrections, and user behavior.

---

# 17. ENGINEERING PRINCIPLE

Before implementing something large, ask:

1. Is this required to make V1 useful?
2. Is this required for reliability/security?
3. Is this required to collect the data needed for V2?
4. Did real users demonstrate a need for it?
5. Can we accomplish the same goal with a smaller, more reliable implementation?

If the answer to all of those is no, strongly consider moving it out of V1.

---

# 18. CURRENT PRODUCT PHILOSOPHY

DeepSpec V1 does not need to prove that DeepSpec can do everything.

It needs to repeatedly create this reaction:

**“I took a picture of a car part and DeepSpec actually helped me understand what it was.”**

Then every real interaction should help us learn how to make the next version better.

The flywheel is:

**Real users**
→ **Real automotive images**
→ **AI results**
→ **Corrections + reports**
→ **Supabase**
→ **Review**
→ **Verified examples**
→ **Versioned datasets**
→ **Evaluations**
→ **Better prompts/models**
→ **Better DeepSpec**
→ **More real users**

Build V1 so this flywheel can start immediately.

---

# 19. INSTRUCTIONS FOR THE CODING AGENT

Before making changes:

- Inspect the existing codebase.
- Inspect existing Supabase schema/migrations.
- Inspect current Storage setup.
- Inspect existing AR implementation.
- Inspect current feedback functionality.
- Inspect existing analytics/error monitoring.
- Inspect the current DeepSpec presentation/project documentation.
- Do not recreate systems that already exist.
- Do not break working functionality simply to conform to this document.
- Verify assumptions against the current implementation.

Then:

1. Identify what is already complete.
2. Identify what is partially complete.
3. Identify actual V1 blockers.
4. Prioritize blockers.
5. Implement/fix them.
6. Test them.
7. Re-test critical flows.
8. Preserve useful existing functionality.
9. Document important architectural decisions.
10. Keep the one-month launch target in mind.

For Supabase-specific problems, use the available connected Supabase tooling where appropriate.

Do not blindly trust stale bug reports. Verify the current state first.

Do not silently perform destructive database or repository operations.

Do not delete valuable untracked project files.

Prefer safe migrations and reversible changes.

The immediate mission is:

**Get DeepSpec V1 ready for real users while deliberately building the feedback and data infrastructure that will make V2 substantially better.**