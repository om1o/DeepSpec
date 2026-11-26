# Replacement fitment boundary

The vehicle profile now carries reviewed build/option details (for example trim,
drivetrain, build date or equipment codes) with the frozen scan. These details
narrow candidate explanations. They are user assertions, even when marked
confirmed. The NHTSA VIN reference supplies manufacturer-reported vehicle
identity fields; it does not supply part applications.

An AI answer, readable label, VIN decode, or human-entered part number is not
an exact replacement fitment check. New scan results are marked **Vehicle
context needed** until the VIN is explicitly confirmed, then **Catalog
verification needed**. Existing saved `possible` and `supported` AI values
remain readable for compatibility but display as unresolved. The result page,
shop job, quick text report and offline inspection report all apply this rule.
Direct follow-up questions about exact compatibility receive a fixed
unverified answer without a model call; general chat still uses the provider
and can be wrong, so its prose is not catalog evidence.
The current app has no authorized OEM or licensed parts-catalog application
record, so it never promotes a replacement to verified fitment.

An eventual verified application must bind a specific catalog part number to
the vehicle identity and every required qualifier (such as trim, engine,
drivetrain, production range and equipment), retain source and retrieval time,
and reject stale or conflicting records. The catalog owner must authorize the
integration and the use of its data. An ACES/VCdb subscription supplies vehicle
reference data and a standard, not a manufacturer part-application catalog.

Sources checked on 2026-11-26:

- [NHTSA vPIC API](https://vpic.nhtsa.dot.gov/api/) — manufacturer-submitted VIN decoding.
- [Auto Care Association FAQ](https://www.autocare.org/about-us/frequently-asked-questions) — ACES/VCdb scope and application-data requirement.

Validation here is local code and synthetic fixture testing. No live catalog
match, hosted provider run, customer order or physical-device acceptance is
claimed.
