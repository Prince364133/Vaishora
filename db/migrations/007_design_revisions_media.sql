-- Artist design revisions and media. Add-only.
--   pending_changes: an artist's edit of a LIVE design, waiting for admin review. The live version keeps
--   selling until the edit is approved, then the snapshot is applied in one step.
--   video_url: one optional YouTube video per design (autoplays muted on the design page).

ALTER TABLE designs
  ADD COLUMN IF NOT EXISTS pending_changes jsonb,
  ADD COLUMN IF NOT EXISTS pending_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS video_url text;

CREATE INDEX IF NOT EXISTS designs_pending_changes_idx ON designs(pending_submitted_at) WHERE pending_changes IS NOT NULL;
