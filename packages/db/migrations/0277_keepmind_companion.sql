-- Keep stable agent ids, handles, permissions, histories and all custom names.
UPDATE "agents" SET "name" = 'Kivo'
WHERE "builtin" = 'right_hand' AND "name" IN ('Lodi', 'KeepMind');
