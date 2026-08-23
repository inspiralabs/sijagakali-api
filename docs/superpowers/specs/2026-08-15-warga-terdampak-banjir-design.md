# Manajemen Data Warga Terdampak Banjir — Design

**Source notes:** `notes-fitur-tambahan.md` (task 1)

## Goal

Add an admin-facing feature for recording residents affected by flooding, so
village government / BPBD can retrieve accurate per-flood-event data: who was
affected, where, and their current status (at home / evacuated).

## Scope

New feature spanning both repos:
- `sijagakali-api` (this repo): 3 new Postgres tables' worth of schema (5
  tables total), 3 new Fastify route files, 1 migration.
- `sijagakali-app`: 3 new admin pages (Kejadian Banjir, Warga Terdampak,
  Kelola Wilayah), 1 new sidebar group, 1 cascading combobox component.

**Out of scope (explicitly decided against):** no summary/stat integration
into the main flood-monitoring Dashboard page — this data is reference/report
data entered by admins, not real-time sensor telemetry, and mixing the two
would clutter the primary monitoring view. Stat cards live only on the Warga
Terdampak page.

## Data Model

Five new tables in the `sijagakali` schema.

### `sijagakali.wilayah_dusun` (master data, hierarchy level 1)
| column | type | notes |
|---|---|---|
| id | UUID PK | `gen_random_uuid()` |
| deployment_slug | TEXT NOT NULL | FK → `deployments(slug)` |
| nama | TEXT NOT NULL | e.g. "Kampung Bojong Kulur" |
| created_at | TIMESTAMPTZ | default `now()` |

`UNIQUE (deployment_slug, nama)`

### `sijagakali.wilayah_rw` (level 2, under Dusun)
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| dusun_id | UUID NOT NULL | FK → `wilayah_dusun(id)` ON DELETE RESTRICT |
| nama | TEXT NOT NULL | e.g. "001" |
| created_at | TIMESTAMPTZ | default `now()` |

`UNIQUE (dusun_id, nama)`

### `sijagakali.wilayah_rt` (level 3, under RW)
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| rw_id | UUID NOT NULL | FK → `wilayah_rw(id)` ON DELETE RESTRICT |
| nama | TEXT NOT NULL | e.g. "001" |
| created_at | TIMESTAMPTZ | default `now()` |

`UNIQUE (rw_id, nama)`

Rationale for the hierarchy: in Indonesian administrative structure, RT
numbers repeat across different RW, and RW numbers repeat across different
Dusun — flat independent lists would make "RT 001" ambiguous for
filtering/reporting. `ON DELETE RESTRICT` prevents deleting a Dusun/RW that
still has children — the UI's Kelola Wilayah page must delete children first
or block the action with a clear error.

### `sijagakali.banjir_events`
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| deployment_slug | TEXT NOT NULL | FK → `deployments(slug)` |
| nama | TEXT NOT NULL | e.g. "Banjir Januari 2026" |
| tanggal_mulai | DATE NOT NULL | |
| tanggal_selesai | DATE NULL | null = masih berlangsung |
| keterangan | TEXT NULL | |
| created_at, updated_at | TIMESTAMPTZ | `updated_at` via `sijagakali.set_updated_at()` trigger (reused, defined in the init migration) |

### `sijagakali.warga_terdampak`
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| banjir_event_id | UUID NOT NULL | FK → `banjir_events(id)` ON DELETE CASCADE |
| deployment_slug | TEXT NOT NULL | denormalized, matches existing table convention (e.g. `sensor_readings`) |
| nik | TEXT NULL | 16 digits when present; CHECK `nik IS NULL OR nik ~ '^[0-9]{16}$'` |
| nama_lengkap | TEXT NOT NULL | |
| tanggal_lahir | DATE NOT NULL | umur computed client-side, not stored |
| jenis_kelamin | TEXT NOT NULL | CHECK IN `('laki-laki','perempuan')` |
| no_kk | TEXT NULL | groups household members for "N keluarga terdampak" reporting |
| kontak_hp | TEXT NULL | |
| status_saat_ini | TEXT NOT NULL | CHECK IN `('di_rumah','mengungsi','lainnya')`, default `'di_rumah'` |
| dusun_id | UUID NOT NULL | FK → `wilayah_dusun(id)` ON DELETE RESTRICT |
| rw_id | UUID NOT NULL | FK → `wilayah_rw(id)` ON DELETE RESTRICT |
| rt_id | UUID NOT NULL | FK → `wilayah_rt(id)` ON DELETE RESTRICT |
| detail_alamat | TEXT NULL | house number, landmark, etc. |
| catatan | TEXT NULL | free text — damage/loss/special needs instead of a rigid severity enum |
| created_at, updated_at | TIMESTAMPTZ | `updated_at` via the same shared trigger |

`UNIQUE (banjir_event_id, nik) WHERE nik IS NOT NULL` — a resident can
legitimately reappear in a *different* flood event, so uniqueness is scoped
per event, not global. Partial index also allows any number of NULL NIKs
(residents without ID at time of data collection).

### RLS / grants (all 5 tables)

Follow the exact pattern in `20260512120000_authenticated_read_dashboard_tables.sql`:
- `ENABLE ROW LEVEL SECURITY`
- Policy `authenticated_read_<table>`: `FOR SELECT TO authenticated USING (true)`
- `service_role` gets full grant (bypasses RLS by default, same as `admins`)
- No INSERT/UPDATE/DELETE policy for `authenticated` — all writes go through
  the Fastify API using the service-role client, same as `device_configs`.

### Indexes
- `(deployment_slug)` on all 5 tables
- `(banjir_event_id)` on `warga_terdampak` for the per-event list query

## API (sijagakali-api)

Reads happen directly from the frontend via the Supabase client under the
`authenticated` RLS policy — same as `Devices.tsx` reading `device_configs`
directly. Only mutations go through Fastify (`requireAdmin` preHandler),
since RLS grants `authenticated` no write access.

New route files, registered in `api/src/app.ts` the same way the existing
five are:

- `api/src/routes/wilayah.ts` — `registerWilayahRoutes`
  - `POST /api/wilayah/dusun`, `PATCH /api/wilayah/dusun/:id`, `DELETE /api/wilayah/dusun/:id`
  - `POST /api/wilayah/rw`, `PATCH /api/wilayah/rw/:id`, `DELETE /api/wilayah/rw/:id`
  - `POST /api/wilayah/rt`, `PATCH /api/wilayah/rt/:id`, `DELETE /api/wilayah/rt/:id`
  - DELETE handlers surface the FK-restrict Postgres error (`error.code === '23503'`)
    as a clear 409 message, same pattern as the device permanent-delete route.
- `api/src/routes/banjirEvents.ts` — `registerBanjirEventRoutes`
  - `POST /api/banjir/events`, `PATCH /api/banjir/events/:id`, `DELETE /api/banjir/events/:id`
- `api/src/routes/wargaTerdampak.ts` — `registerWargaTerdampakRoutes`
  - `POST /api/banjir/warga`, `PATCH /api/banjir/warga/:id`, `DELETE /api/banjir/warga/:id`
  - Server-side validation: NIK regex when present, `jenis_kelamin` and
    `status_saat_ini` enum checks, required fields present — mirrors the
    validation style in `device.ts` (plain functions returning
    `{ok:true,value}|{ok:false,error}` or inline checks, no schema library).

All use the existing `RouteDeps` (`supabase`, `requireAdmin`) — no changes
needed to `api/src/types/deps.ts`.

## Frontend (sijagakali-app)

New sidebar group "Data Bencana" in `AppSidebar.tsx`, three sub-items:

1. **Kejadian Banjir** (`/banjir/kejadian`) — list + add/edit dialog (nama,
   tanggal_mulai, tanggal_selesai, keterangan). Same table+Dialog pattern as
   `AdminUsers.tsx`.
2. **Warga Terdampak** (`/banjir/warga`) — main CRUD page.
   - Top: select which Kejadian Banjir to view (defaults to the most recent
     one with `tanggal_selesai IS NULL`).
   - Stat cards (reusing the `SummaryCards.tsx` pattern): total warga, total
     KK (distinct non-null `no_kk`), mengungsi vs di rumah count, top
     Dusun by affected count. All computed from the currently selected
     event's rows.
   - Table: Nama, NIK, Umur (computed from `tanggal_lahir` client-side),
     Alamat (Dusun/RW/RT joined), Status, Aksi (edit/delete).
   - Add/edit dialog includes the cascading Dusun→RW→RT combobox (below).
3. **Kelola Wilayah** (`/banjir/wilayah`) — three tabs (Dusun / RW / RT),
   each a simple list with add/edit/delete, same table+Dialog pattern as
   `AdminUsers.tsx`. RW tab requires picking a parent Dusun first; RT tab
   requires picking a parent RW first.

### Cascading combobox (Dusun → RW → RT)

Built from existing shadcn primitives already in the repo — `command.tsx`
(wraps `cmdk`, already a dependency) + `popover.tsx`. No new dependency.

1. Dusun combobox: searchable list of existing `wilayah_dusun` rows for the
   current deployment. Typing a name with no match shows "+ Tambah '<name>'"
   — selecting it calls `POST /api/wilayah/dusun`, then selects the new row.
2. RW combobox: disabled until a Dusun is chosen. Options filtered to that
   `dusun_id`. Same inline-add behavior (`POST /api/wilayah/rw` with the
   chosen `dusun_id`).
3. RT combobox: disabled until an RW is chosen. Options filtered to that
   `rw_id`. Same inline-add behavior (`POST /api/wilayah/rt`).

Typo fixes and deletions happen on the Kelola Wilayah page, not inline.

## Testing approach

No existing test suite covers the API's CRUD routes or these UI flows
(checked: no `*.test.ts` under `sijagakali-api/api/src`; the app's few
`*.test.ts` files cover unrelated utilities). Following existing
convention, the plan verifies each task manually (`curl` for API routes,
manual exercise of the UI in a running dev server) rather than introducing a
new test framework for this feature alone.

## Open items resolved during brainstorming

- Age stored as `tanggal_lahir`, not a raw `umur` number (accuracy over time).
- Data is scoped to a `banjir_events` entity (not a single flat registry) —
  this was the user's explicit choice after clarification, and is the
  reason a Kejadian Banjir management page exists at all.
- RT/RW/Dusun are a real hierarchy (FK chain), not three independent lists.
- NIK is optional at entry (emergency data collection may lack ID), unique
  per event when present.
- No dashboard summary integration — deferred, not part of this feature.
