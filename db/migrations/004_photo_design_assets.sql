-- Designs imported from a mehndi photo: besides the henna mask ('palm' / 'back'), store the
-- warped real photo of the hand in the same projection frame ('palm_photo' / 'back_photo').
ALTER TABLE design_assets DROP CONSTRAINT design_assets_kind_check;
ALTER TABLE design_assets ADD CONSTRAINT design_assets_kind_check CHECK (kind IN ('palm', 'back', 'feet', 'palm_photo', 'back_photo'));
