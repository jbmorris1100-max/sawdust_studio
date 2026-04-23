-- ============================================================
-- SOPs (Standard Operating Procedures)
-- Run this in the Supabase SQL Editor
-- ============================================================

create table if not exists sops (
  id          uuid        primary key default gen_random_uuid(),
  title       text        not null,
  dept        text        not null,
  description text,
  steps       jsonb       not null default '[]'::jsonb,
  pdf_url     text,
  created_by  text        not null default 'Supervisor',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_sops_dept       on sops (dept);
create index if not exists idx_sops_updated_at on sops (updated_at desc);

alter table sops enable row level security;

create policy "anon can read sops"
  on sops for select using (true);

create policy "anon can insert sops"
  on sops for insert with check (true);

create policy "anon can update sops"
  on sops for update using (true);

create policy "anon can delete sops"
  on sops for delete using (true);

-- ============================================================
-- Seed data — 3 example SOPs
-- ============================================================

insert into sops (title, dept, description, steps, created_by) values
(
  'Cabinet Box Assembly',
  'Assembly',
  'Step-by-step process for assembling standard cabinet boxes on the shop floor.',
  '[
    {"step_number":1,"instruction":"Verify all parts are cut to spec — check width, height, and depth against shop drawings before starting.","warning":"Do not proceed if any dimension is off by more than 1/16\". Return to Cutting."},
    {"step_number":2,"instruction":"Apply glue to all dado grooves and cabinet joints using a brush. Spread evenly — no dry spots.","warning":null},
    {"step_number":3,"instruction":"Square up the box using a framing square. Check all four corners before clamping.","warning":"A cabinet that goes into clamps out-of-square will cure that way. Take the 30 seconds."},
    {"step_number":4,"instruction":"Clamp and fasten with pocket screws or confirmat screws per the job spec. Standard spacing is 8\" on center.","warning":null},
    {"step_number":5,"instruction":"Wipe all glue squeeze-out immediately with a damp rag. Mark cabinet with job # and part label before moving.","warning":null}
  ]'::jsonb,
  'Supervisor'
),
(
  'Edge Banding Setup',
  'Edgebanding',
  'Machine setup and run procedure for applying PVC or wood edge banding.',
  '[
    {"step_number":1,"instruction":"Set machine temperature to material spec: PVC = 390°F, wood veneer = 360°F. Allow 10 minutes to reach operating temp.","warning":"Do not run material until temp is stable. Cold glue causes peel-back."},
    {"step_number":2,"instruction":"Load the banding roll and thread through the feed guides. Confirm banding is centered on the track.","warning":null},
    {"step_number":3,"instruction":"Run a test piece of scrap at the same thickness as the production material. Check adhesion and flush trim.","warning":"Always test on scrap first — never on a finished part."},
    {"step_number":4,"instruction":"Adjust end trimmer and flush trimmer to achieve zero overhang. Fine-tune scraper to remove any glue line.","warning":null}
  ]'::jsonb,
  'Supervisor'
),
(
  'Final QC Checklist',
  'All',
  'End-of-line quality inspection required before any cabinet leaves the shop floor.',
  '[
    {"step_number":1,"instruction":"Verify all dimensions match the shop drawing. Measure width, height, and depth with a tape measure.","warning":"Any part outside ±1/16\" tolerance must be flagged and set aside — do not ship."},
    {"step_number":2,"instruction":"Check that all edge banding is flush, fully adhered, and free of glue residue.","warning":null},
    {"step_number":3,"instruction":"Inspect all joints — no gaps, no glue squeeze-out on finished faces.","warning":null},
    {"step_number":4,"instruction":"Verify hardware locations: hinge holes, drawer slides, and cam locks are in the correct position per drawings.","warning":null},
    {"step_number":5,"instruction":"Check part labels: job #, cabinet #, and destination must be legible on every box.","warning":"Unlabeled parts cause delays on site. Do not allow them to ship."},
    {"step_number":6,"instruction":"Sign off in the QC log with your name, date, and job number. Notify supervisor of any flagged issues.","warning":null}
  ]'::jsonb,
  'Supervisor'
);
