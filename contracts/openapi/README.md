# contracts/openapi

`openapi.yaml` — OpenAPI 3.0 specification for core-api's REST surface
(`/api/v1/...`), covering the endpoints built in Phase 2 (auth, drivers,
vehicles, driver devices, ride requests, trips). Updated alongside the API
as later phases add endpoints (e.g. ride-offers in Phase 5).

View it locally with any OpenAPI viewer, e.g.:

```bash
npx @redocly/cli preview-docs contracts/openapi/openapi.yaml
```
