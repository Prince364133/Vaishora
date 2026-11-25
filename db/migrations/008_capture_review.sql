-- Review queue for photo captures (docs/HAND_AI_ARCHITECTURE.md §5.3). An admin approves a capture's final
-- henna (detected + brush corrections) as a training label, or rejects it. Only approved captures whose owner
-- consented (capture_sources.consent_training) are ever exported for training.
ALTER TABLE capture_runs ADD COLUMN review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE capture_runs ADD COLUMN reviewed_by uuid REFERENCES users(id);
ALTER TABLE capture_runs ADD COLUMN reviewed_at timestamptz;
-- model uncertainty 0..100 at import time (null for the rule-based extractor); the queue shows high first
ALTER TABLE capture_runs ADD COLUMN uncertainty real CHECK (uncertainty IS NULL OR (uncertainty >= 0 AND uncertainty <= 100));
-- the final henna mask in the hand frame for this run (what the design shows), for review and export
ALTER TABLE capture_runs ADD COLUMN mask_url text;
CREATE INDEX capture_runs_review_idx ON capture_runs(review_status, uncertainty DESC NULLS LAST);
