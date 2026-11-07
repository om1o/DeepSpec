# Evidence limits after the November 7 live benchmark

The PR #172 Preview returned two real Gemini scans and four follow-up answers. Its
successful requests did not establish answer quality. The three-photo answer called
surface damage severe without establishing depth or structural effect. Both next-check
answers bundled several actions despite a request for one per photo. One claimed dye
penetrant would establish crack depth and severity. The two-photo scan omitted a
photo-linked engine condition finding, although a generic engine description existed.

This change updates shared identify/chat instructions to distinguish visible extent
from severity, state measurement limits, request exactly one targeted next check per
requested photo, and prioritize supported photo-linked findings over optional detail.
It preserves missing coverage as missing; it never manufactures healthy observations.
The pipeline version is explicitly recognized as retaining first-photo identity scope.

## Technical basis

- [TWI: principles of penetrant examination](https://www.twi-global.com/technical-knowledge/faqs/faq-what-are-the-principles-of-penetrant-examination-in-non-destructive-examination-nde)
  describes detection of discontinuities open to the surface.
- [TWI: factors affecting penetrant indications](https://www.twi-global.com/technical-knowledge/faqs/faq-what-influences-the-flaw-entrapment-efficiency-of-a-penetrant-inspection)
  explains that geometry, contaminants, processing and penetrant behavior affect the
  indication. An indication is not a direct crack-depth measurement or a serviceability decision.

These are general method limits, not an automotive wear specification. No numeric
rotor limit, tightening torque, account credentials or provider changes are included.

## Validation and remaining live acceptance

Mocked API tests inspect the actual outgoing request for ordinary and research chat,
including all three original photos. They verify instruction transport, not Gemini's
compliance. A new live run must independently show one targeted check per requested
photo, explicit unresolved depth/strength, no invented specifications, and honest
missing coverage. Reuse of the old benchmark is not proof this version works.

## Isolation investigation

The tested build saved crops, not precise masks. Both local segmenters require WebGPU.
Scanner allows three seconds for primary isolation and one second for scene masks,
while SAM has longer internal load/inference deadlines. Cold loads can therefore be
discarded by the caller. The saved benchmark lacks the diagnostic evidence needed to
attribute its fallback to that timeout, GPU support, model download or mask rejection.
No precise-isolation success is claimed by this change. A separately tested explicit
retry after the crop is displayed is preferable to delaying every initial AI scan.
