/*
  # Project Pinning

  Adds pinning support to the projects table so users can pin
  frequently-used projects to the top of the dashboard grid.

  - `pinned` (boolean) — whether the project is pinned
  - `pin_order` (integer) — sort order among pinned projects (lower = first)
*/

ALTER TABLE projects ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pin_order integer NOT NULL DEFAULT 0;
