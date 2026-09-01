-- Run once after schema.sql to register the V0 model. Required: telemetry.model_id
-- has a foreign key on models.model_id, so inserts fail until this row exists.
-- wrangler d1 execute model-doctor --local --file=seed.sql   (local dev)
-- wrangler d1 execute model-doctor --remote --file=seed.sql  (production)
--
-- `endpoint` is left NULL — nothing reads it yet (no dashboard exists to show it).
-- Set it later with: UPDATE models SET endpoint = '...' WHERE model_id = 'fraud-detector';
INSERT OR REPLACE INTO models (model_id, name, version, endpoint, schema_json)
VALUES (
  'fraud-detector',
  'fraud-detector',
  'v1',
  NULL,
  '{"amount":"float","oldbalanceOrg":"float","newbalanceOrig":"float","oldbalanceDest":"float","newbalanceDest":"float","type":"string"}'
);
