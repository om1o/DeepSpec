# Selected-part comparison with ChatGPT

This is a **product comparison**, separate from `eval:identify:release` and the
full-image/crop/isolation experiment in [MAKER_PORTFOLIO_PLAN.md](MAKER_PORTFOLIO_PLAN.md).
It does not call either provider. Record actual displayed answers from the DeepSpec
and ChatGPT products, then score them locally with:

```powershell
npm run eval:selected-part-comparison -- artifacts/pilot/selected-part-comparison.json
```

The input stays in the ignored `artifacts/pilot/` directory. The command prints
aggregate JSON; it rejects an empty or incomplete-format batch. A
nonempty reference field is only a format check, not proof of human review.

## Freeze the cases first

1. Obtain permission to use each photo for this evaluation. Keep customer identifiers,
   license plates and private catalog content out of committed files. Freeze the
   selected target and normalized rectangle on the original photo, photo SHA-256,
   human/reference-verified part-family name,
   acceptable synonyms and any verified exact IDs **before** running either product.
2. Treat each physical part as one case. Its extra angles and retakes belong to the
   same case. Keep development examples and alternate views of held-out parts out
   of the held-out selection process.
3. Give both products the same original image, marked target, vehicle context and
   question. Record the actual product/model used. DeepSpec's internal crop and
   guidance remain part of its product workflow. Do not substitute an OpenAI API
   response for the ChatGPT app.
4. Record every attempted case, including unresolved answers, provider failures,
   retakes and missing timing. Have a reviewer judge the top displayed part name and
   next-photo usefulness without seeing which product supplied them. Do not use an
   AI answer as ground truth.

The JSON shape is:

```json
{
  "version": 1,
  "frozenAt": "2026-11-25T12:00:00.000Z",
  "deepspecCommit": "commit SHA tested",
  "deepspecModel": "provider and model tested",
  "chatgptModel": "model shown by ChatGPT, or not disclosed",
  "cases": [{
    "id": "coded case ID",
    "physicalPartId": "coded physical part ID",
    "photoSha256": "64 hexadecimal characters for the original photo",
    "selectedTarget": "which part was indicated in the original photo",
    "selectedBox": { "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4 },
    "vehicleContext": "same vehicle details supplied to both, or none supplied",
    "question": "exact same question asked in both products",
    "reference": "human or authorized source supporting the identity",
    "acceptedNames": ["reviewed part-family name", "preapproved synonym"],
    "verifiedPartNumbers": [],
    "runs": {
      "deepspec": { "status": "answered", "topChoice": "displayed top name", "confidence": "high", "exactPartNumber": null, "nextPhotoRequest": null, "nextPhotoUseful": null, "elapsedSeconds": 8.5, "retakes": 0 },
      "chatgpt": { "status": "abstained", "topChoice": null, "confidence": "unstated", "exactPartNumber": null, "nextPhotoRequest": "one more label photo", "nextPhotoUseful": true, "elapsedSeconds": 12, "retakes": 0 }
    }
  }]
}
```

Use `answered`, `abstained`, or `error` for `status`. For an answer, transcribe
the single displayed top part name into `topChoice`; do not include alternatives,
evidence text or a list. If no primary answer is displayed, record `abstained`.
Use `high`, `medium`, `low`, or `unstated` for confidence.
Set unavailable elapsed time to `null`, never zero. Set `nextPhotoUseful` to
`null` until the blinded reviewer judges the actual request.

`topChoiceAccuracy` divides correct top choices by **all** attempted cases;
`answeredPrecision` divides by answered cases only. Both abstentions and errors
remain in the first denominator. Exact-ID precision and coverage use only cases
with reviewer-verified part numbers; claims on other cases are reported as
`unverifiedExactIdClaims`, which must be read alongside precision. Timing
comparisons use only complete DeepSpec/ChatGPT pairs; a missing time suppresses
the batch medians and paired difference. Rates are fractions from 0 to 1 and
are descriptive for a small pilot. Inspect the raw cases and failures before
making any claim.

There are no eligible reviewed held-out cases in the last recorded export check.
The committed engine image is a development flow fixture and must stay out of a
held-out comparison. This harness and its synthetic tests are not evidence that
DeepSpec beats ChatGPT or that the provider follows the next-photo instruction.
