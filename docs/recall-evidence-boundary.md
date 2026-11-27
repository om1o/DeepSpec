# Safety recall evidence boundary

The result page offers an explicit search of NHTSA's public recalls API using
the scan's year, make, and model. It sends those three values as query parameters,
with no dedicated VIN, photo, symptom, or account fields. VIN-shaped tokens
pasted into make or model are rejected; the UI asks users to remove other private
identifiers from those free-text fields. The request is limited in time and
response size, and its results are not stored as a vehicle-specific finding.

The API's year/make/model campaigns are **model-wide possibilities**. They do
not establish that this VIN is included, that a recall is still open, or that
the vehicle is safe to drive. A zero-result API response is not a VIN or safety
clearance. The result page links to NHTSA's official VIN lookup as a separate
user action. NHTSA says its VIN lookup omits completed recalls, some recently
announced recalls, certain older/small-manufacturer campaigns, and
international vehicles. Users should contact the manufacturer if they need
additional confirmation.

The public API supports model-year/make/model and campaign searches; it does
not document a VIN-specific open-recall endpoint. NHTSA's API use policy
disallows bulk VIN lookup use. This integration makes one user-initiated model
query and does not automate VIN lookup or bypass the website's controls.

Sources checked 2026-11-26:

- [NHTSA datasets and APIs](https://www.nhtsa.gov/nhtsa-datasets-and-apis)
- [NHTSA recalls and VIN lookup limits](https://www.nhtsa.gov/recalls)
- [NHTSA API use policy](https://api.nhtsa.gov/)

Validation uses synthetic response fixtures plus one live GET of NHTSA's
published example query. A live query does not verify any user's VIN or prove
that the UI works on a physical device. The browser relies on NHTSA's current
cross-origin response policy; if it changes, the UI reports an unavailable
lookup and keeps the official VIN link.
