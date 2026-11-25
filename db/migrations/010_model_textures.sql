-- The "3D model" viewer's own textures for a design (src/lib/photo-import/model-texture.ts): the design painted on
-- both photographed hands, front (palms) and/or back. Built from the design's henna + fitted photo whenever an
-- admin or artist imports a hand photo, so artist designs show exactly on the 3D model instead of a closest look.
ALTER TABLE design_assets DROP CONSTRAINT design_assets_kind_check;
ALTER TABLE design_assets ADD CONSTRAINT design_assets_kind_check
  CHECK (kind IN ('palm', 'back', 'feet', 'palm_photo', 'back_photo', 'model_front', 'model_back'));
