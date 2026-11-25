-- Model registry for the self-improving henna detector (docs/HAND_AI_ARCHITECTURE.md §5.3).
-- The training worker (scripts/ml/autolearn.py) registers each new version as a candidate with its test
-- results; it becomes live automatically only when it beats the live model on the same held-out photos.
-- Exactly one version is live; admins can promote or roll back at any time.
CREATE TABLE ml_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL DEFAULT 'henna' CHECK (task IN ('henna')),
  version integer NOT NULL CHECK (version >= 0),
  method text NOT NULL,                       -- 'unet-v<version>'
  url text NOT NULL,                          -- ONNX file
  threshold real NOT NULL CHECK (threshold > 0 AND threshold < 1),
  working_size integer NOT NULL CHECK (working_size BETWEEN 256 AND 4096),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb, -- candidate vs live on the same test sets, as measured by the worker
  trained_on jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. { real_labels, gold_labels, steps, base_version }
  status text NOT NULL CHECK (status IN ('candidate', 'live', 'retired', 'rejected')),
  decision text,                              -- why it was (not) promoted
  promoted_at timestamptz,
  promoted_by uuid REFERENCES users(id),      -- null = promoted automatically
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task, version)
);
CREATE UNIQUE INDEX ml_models_one_live ON ml_models(task) WHERE status = 'live';
ALTER TABLE ml_models ENABLE ROW LEVEL SECURITY;

-- v0: trained on synthetic data + the project's own photo pairs (public/models/ml/henna.json)
INSERT INTO ml_models(task, version, method, url, threshold, working_size, metrics, trained_on, status, decision, promoted_at)
VALUES ('henna', 0, 'unet-v0', '/models/ml/henna-unet-v0.onnx', 0.3, 1024,
        '{"candidate": {"synthetic": {"f1": 0.8297}, "real_holdout": {"f1": 0.782}}, "rule_based": {"synthetic": {"f1": 0.5578}, "real_holdout": {"f1": 0.7162}}}',
        '{"real_labels": 0, "gold_labels": 0, "steps": 3000, "base_version": null}',
        'live', 'First model; beat the rule-based extractor on both test sets.', now());
