-- Non-destructive photo capture (docs/HAND_AI_ARCHITECTURE.md §4–§5).
-- Keep everything needed to rebuild a photo-imported design for any future hand mesh, and to train
-- extraction models later: the original photo, the auto-detected and final landmarks (photo pixels),
-- the extraction parameters and the admin's brush edits (photo space). design_assets become a derived
-- cache tagged with the projection-frame version they were built for.

CREATE TABLE capture_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid REFERENCES designs(id) ON DELETE SET NULL,
  side text NOT NULL CHECK (side IN ('palm', 'back')),
  photo_url text NOT NULL,
  sha256 text NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  uploaded_by uuid REFERENCES users(id),
  rights_confirmed boolean NOT NULL,
  -- separate, explicit opt-in: may this photo be used to train VAISHORA's detection models?
  consent_training boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capture_sources_design_idx ON capture_sources(design_id);
CREATE INDEX capture_sources_sha_idx ON capture_sources(sha256);

CREATE TABLE capture_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES capture_sources(id) ON DELETE CASCADE,
  method text NOT NULL,                       -- e.g. 'heuristic-v1' (rule-based), later 'unet-v1' …
  params jsonb NOT NULL DEFAULT '{}'::jsonb,  -- sensitivity, detection rotation, hand index …
  auto_landmarks jsonb,                       -- 21 [x,y] photo pixels as detected (null = placed manually)
  landmarks jsonb NOT NULL,                   -- 21 [x,y] photo pixels after admin correction
  landmarks_edited boolean NOT NULL DEFAULT false,
  edits_url text,                             -- brush layer in photo space (R = add henna, G = erase)
  frame_version integer NOT NULL,             -- hand-landmarks.json frameVersion the assets were built for
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capture_runs_source_idx ON capture_runs(source_id, created_at DESC);

ALTER TABLE design_assets ADD COLUMN frame_version integer;
ALTER TABLE design_assets ADD COLUMN capture_run_id uuid REFERENCES capture_runs(id) ON DELETE SET NULL;

ALTER TABLE capture_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE capture_runs ENABLE ROW LEVEL SECURITY;
