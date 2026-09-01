# ModelForge

**Model Doctor** — is my ML model still healthy in production? A fraud-detection model
(trained on PaySim) served from a VPS, with a Cloudflare-based control plane that ingests
prediction telemetry and scores it for data quality, drift, and performance.

## Architecture

```
model-service (VPS, FastAPI)  --telemetry-->  worker (Cloudflare, Hono)  -->  D1
   /predict /health /metadata                   POST /api/v1/telemetry
```

`model-service` serves predictions and fires a telemetry event after each one.
`worker` authenticates it, checks it against the model's registered schema, and stores it
in D1 with a computed data quality score.

## Status

- **V0 — Foundation**: trained model, FastAPI serving, Worker + D1 telemetry ingestion
- **V1 — Data Quality**: missing/invalid-value checks against the registered schema,
  `data_quality_score` stored per telemetry row
- V2 — Drift, V3 — Performance, V4 — Infra metrics, V5 — Alerts, V6 — Health score

## model-service

Copy `.env.example` (repo root) to `.env` and fill in `APP_API_KEY`, `TELEMETRY_API_KEY`,
and `MODEL_DOCTOR_TELEMETRY_URL` (the worker's telemetry endpoint) — needed by both paths
below.

### Development

```
cd model-service
uv sync
# place the PaySim CSV at data/paysim.csv (Kaggle: ealaxi/paysim1)
uv run train.py               # data/paysim.csv -> artifacts/model.joblib
uv run uvicorn app:app --reload
```

### Production

The trained artifact never leaves your machine as a file — it's baked into a Docker image
that gets pushed and pulled, same as any other deploy:

```
uv run train.py                                    # produces artifacts/
docker build -t <dockerhub-user>/model-service:v1 . # bundles artifacts/ into the image
docker push <dockerhub-user>/model-service:v1
```

On the VPS: `docker pull <dockerhub-user>/model-service:v1 && docker run -d -p 8000:8000
--env-file .env <dockerhub-user>/model-service:v1` (or point your platform, e.g. Easypanel,
at the pushed image directly — no repo checkout or build step needed there).

Endpoints: `GET /`, `GET /health`, `GET /metadata`, `POST /predict`.

Test: `uv run tests/test_app.py`

## worker

```
cd worker
npm install
npx wrangler login
npx wrangler d1 create model-doctor   # paste the database_id into wrangler.toml
npx wrangler secret put TELEMETRY_API_KEY
npm run db:init:remote                # applies schema.sql + seed.sql
npm run deploy
```

(Or connect the repo in the Cloudflare dashboard for git-based deploys — root directory
`worker`, build command blank, deploy command `npx wrangler deploy`.)

Endpoint: `POST /api/v1/telemetry` (`Authorization: Bearer <TELEMETRY_API_KEY>`).

Test: `npm test`
