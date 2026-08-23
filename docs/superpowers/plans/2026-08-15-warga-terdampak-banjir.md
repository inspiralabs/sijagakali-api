# Manajemen Data Warga Terdampak Banjir Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin feature for recording flood-affected residents (Warga Terdampak Banjir), scoped to flood events (Kejadian Banjir), with hierarchical RT/RW/Dusun master data.

**Architecture:** 5 new Postgres tables in the `sijagakali` schema (RLS: `authenticated` reads directly via Supabase client, writes go through Fastify routes with `requireAdmin`, mirroring the existing `device_configs`/`admins` pattern). Frontend adds 3 admin pages and a reusable cascading combobox built from existing shadcn primitives.

**Tech Stack:** Fastify 5 + `@supabase/supabase-js` (backend, `sijagakali-api/api`), React + Vite + shadcn/ui (`cmdk`, Radix Popover) + React Router (frontend, `sijagakali-app`). No new dependencies in either repo.

**Spec:** `docs/superpowers/specs/2026-08-15-warga-terdampak-banjir-design.md`

## Global Constraints

- All new tables live in the `sijagakali` Postgres schema (never `public`).
- Multi-tenancy via `deployment_slug` column on every top-level table (`wilayah_dusun`, `banjir_events`, `warga_terdampak`) — never a separate schema per village.
- RLS: `authenticated` gets SELECT only (`USING (true)`), matching `20260512120000_authenticated_read_dashboard_tables.sql`. All INSERT/UPDATE/DELETE go through Fastify routes using the service-role Supabase client, gated by `requireAdmin`.
- No new npm dependencies in `sijagakali-api` or `sijagakali-app` — the combobox is built from `cmdk`/`@radix-ui/react-popover`, both already installed.
- `nik` is optional; when present it must be exactly 16 digits and unique **per `banjir_event_id`**, not globally.
- No changes to the main flood-monitoring `Dashboard.tsx` — explicitly out of scope per the spec.
- **Known pre-existing baseline TypeScript errors in `sijagakali-app`, unrelated to this feature — do not fix them as part of this plan:** `npx tsc --noEmit -p tsconfig.app.json` already reports errors before any change from this plan, always confined to exactly 2 files: `src/lib/sijagakali/fetchDashboard.ts` and `src/lib/supabase.ts` (a pre-existing `@supabase/supabase-js` `.select()`/schema-generic typing fragility, unrelated to warga terdampak). The exact error count and wording in those 2 files is **not stable across runs** — confirmed empirically: adding unrelated new files under `src/` shifts which fallback overload TS's checker reports for the already-broken `.select()` calls in `fetchDashboard.ts`, even with zero lines of that file touched. Do not compare error text or count against a prior run. The correct bar for every task's `tsc --noEmit` step: **zero errors in any file the task creates or modifies**, and any errors that do appear are confined to `fetchDashboard.ts`/`supabase.ts` only (never a file this plan touches). An error appearing in any other file is a real regression.

---

## Task 1: Database migration — wilayah, banjir_events, warga_terdampak

**Files:**
- Create: `supabase/migrations/20260815090000_banjir_warga_terdampak.sql`

**Interfaces:**
- Produces: tables `sijagakali.wilayah_dusun(id, deployment_slug, nama, created_at)`, `sijagakali.wilayah_rw(id, dusun_id, nama, created_at)`, `sijagakali.wilayah_rt(id, rw_id, nama, created_at)`, `sijagakali.banjir_events(id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan, created_at, updated_at)`, `sijagakali.warga_terdampak(id, banjir_event_id, deployment_slug, nik, nama_lengkap, tanggal_lahir, jenis_kelamin, no_kk, kontak_hp, status_saat_ini, dusun_id, rw_id, rt_id, detail_alamat, catatan, created_at, updated_at)`. Later tasks (2, 3, 4) insert/update/delete rows in these tables by exact column name.

- [ ] **Step 1: Write the migration file**

```sql
-- Manajemen data warga terdampak banjir: wilayah (dusun/rw/rt berjenjang),
-- kejadian banjir, dan data warga per kejadian.
-- Lihat docs/superpowers/specs/2026-08-15-warga-terdampak-banjir-design.md

-- ============================================================
-- Master data wilayah — hierarki Dusun > RW > RT. RT/RW berulang lintas
-- wilayah induk di struktur administratif Indonesia, jadi berjenjang lewat
-- FK, bukan tiga daftar independen (supaya "RT 001" tidak ambigu).
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.wilayah_dusun (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nama            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deployment_slug, nama)
);

CREATE TABLE IF NOT EXISTS sijagakali.wilayah_rw (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dusun_id   UUID NOT NULL REFERENCES sijagakali.wilayah_dusun (id) ON DELETE RESTRICT,
  nama       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dusun_id, nama)
);

CREATE TABLE IF NOT EXISTS sijagakali.wilayah_rt (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rw_id      UUID NOT NULL REFERENCES sijagakali.wilayah_rw (id) ON DELETE RESTRICT,
  nama       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rw_id, nama)
);

CREATE INDEX IF NOT EXISTS idx_wilayah_dusun_deployment_slug ON sijagakali.wilayah_dusun (deployment_slug);
CREATE INDEX IF NOT EXISTS idx_wilayah_rw_dusun_id ON sijagakali.wilayah_rw (dusun_id);
CREATE INDEX IF NOT EXISTS idx_wilayah_rt_rw_id ON sijagakali.wilayah_rt (rw_id);

-- ============================================================
-- Kejadian banjir
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.banjir_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug  TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nama             TEXT NOT NULL,
  tanggal_mulai    DATE NOT NULL,
  tanggal_selesai  DATE,
  keterangan       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banjir_events_deployment_slug ON sijagakali.banjir_events (deployment_slug);

DROP TRIGGER IF EXISTS trg_banjir_events_updated_at ON sijagakali.banjir_events;
CREATE TRIGGER trg_banjir_events_updated_at
  BEFORE UPDATE ON sijagakali.banjir_events
  FOR EACH ROW EXECUTE PROCEDURE sijagakali.set_updated_at();

-- ============================================================
-- Warga terdampak banjir — satu baris = satu warga pada satu kejadian.
-- NIK unik per kejadian (bukan global): warga yang sama bisa tercatat lagi
-- di kejadian banjir yang berbeda.
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.warga_terdampak (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banjir_event_id  UUID NOT NULL REFERENCES sijagakali.banjir_events (id) ON DELETE CASCADE,
  deployment_slug  TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nik              TEXT CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$'),
  nama_lengkap     TEXT NOT NULL,
  tanggal_lahir    DATE NOT NULL,
  jenis_kelamin    TEXT NOT NULL CHECK (jenis_kelamin IN ('laki-laki', 'perempuan')),
  no_kk            TEXT,
  kontak_hp        TEXT,
  status_saat_ini  TEXT NOT NULL DEFAULT 'di_rumah' CHECK (status_saat_ini IN ('di_rumah', 'mengungsi', 'lainnya')),
  dusun_id         UUID NOT NULL REFERENCES sijagakali.wilayah_dusun (id) ON DELETE RESTRICT,
  rw_id            UUID NOT NULL REFERENCES sijagakali.wilayah_rw (id) ON DELETE RESTRICT,
  rt_id            UUID NOT NULL REFERENCES sijagakali.wilayah_rt (id) ON DELETE RESTRICT,
  detail_alamat    TEXT,
  catatan          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warga_terdampak_event_nik
  ON sijagakali.warga_terdampak (banjir_event_id, nik) WHERE nik IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warga_terdampak_deployment_slug ON sijagakali.warga_terdampak (deployment_slug);
CREATE INDEX IF NOT EXISTS idx_warga_terdampak_banjir_event_id ON sijagakali.warga_terdampak (banjir_event_id);

DROP TRIGGER IF EXISTS trg_warga_terdampak_updated_at ON sijagakali.warga_terdampak;
CREATE TRIGGER trg_warga_terdampak_updated_at
  BEFORE UPDATE ON sijagakali.warga_terdampak
  FOR EACH ROW EXECUTE PROCEDURE sijagakali.set_updated_at();

-- ============================================================
-- RLS — pola sama seperti 20260512120000_authenticated_read_dashboard_tables.sql
-- ============================================================
ALTER TABLE sijagakali.wilayah_dusun ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.wilayah_rw ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.wilayah_rt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.banjir_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.warga_terdampak ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_wilayah_dusun" ON sijagakali.wilayah_dusun;
CREATE POLICY "authenticated_read_wilayah_dusun"
  ON sijagakali.wilayah_dusun FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_wilayah_rw" ON sijagakali.wilayah_rw;
CREATE POLICY "authenticated_read_wilayah_rw"
  ON sijagakali.wilayah_rw FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_wilayah_rt" ON sijagakali.wilayah_rt;
CREATE POLICY "authenticated_read_wilayah_rt"
  ON sijagakali.wilayah_rt FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_banjir_events" ON sijagakali.banjir_events;
CREATE POLICY "authenticated_read_banjir_events"
  ON sijagakali.banjir_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_warga_terdampak" ON sijagakali.warga_terdampak;
CREATE POLICY "authenticated_read_warga_terdampak"
  ON sijagakali.warga_terdampak FOR SELECT TO authenticated USING (true);

-- service_role bypass RLS secara default (tidak perlu policy eksplisit)

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT ON sijagakali.wilayah_dusun TO authenticated;
GRANT SELECT ON sijagakali.wilayah_rw TO authenticated;
GRANT SELECT ON sijagakali.wilayah_rt TO authenticated;
GRANT SELECT ON sijagakali.banjir_events TO authenticated;
GRANT SELECT ON sijagakali.warga_terdampak TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_dusun TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_rw TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_rt TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.banjir_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.warga_terdampak TO service_role;
```

- [ ] **Step 2: Review the file against existing conventions**

Compare against `supabase/migrations/20260511080000_admin_auth.sql` and `supabase/migrations/20260512120000_authenticated_read_dashboard_tables.sql`: table/policy naming (`authenticated_read_<table>`), `gen_random_uuid()` (from `pgcrypto`, already enabled in the init migration — do not re-add `CREATE EXTENSION`), and the reused `sijagakali.set_updated_at()` trigger function (defined once in the init migration, do not redefine it here).

- [ ] **Step 3: Apply the migration manually (you, not the agent)**

Per `supabase/README.md` → "Cara menjalankan migrasi": paste the file into the Supabase SQL Editor for the project referenced by `SUPABASE_URL` in `sijagakali-api/api/.env`, or run it via `psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260815090000_banjir_warga_terdampak.sql` from a machine that has `psql`. Then, per the same README's "Wajib setelah migrasi" section, confirm the `sijagakali` schema is still in **Project Settings → Data API → Exposed schemas** (it already should be from prior migrations — nothing new needed here since no new schema was created).

Confirm success with:
```sql
select table_name from information_schema.tables
where table_schema = 'sijagakali'
  and table_name in ('wilayah_dusun','wilayah_rw','wilayah_rt','banjir_events','warga_terdampak')
order by table_name;
```
Expected: all 5 rows returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260815090000_banjir_warga_terdampak.sql
git commit -m "feat: add schema for warga terdampak banjir (wilayah, banjir_events, warga_terdampak)"
```

---

## Task 2: API routes — wilayah (Dusun/RW/RT master data)

**Files:**
- Create: `api/src/routes/wilayah.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: `RouteDeps` from `api/src/types/deps.ts` (`supabase`, `requireAdmin`) — unchanged from Task 1.
- Produces: `registerWilayahRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void>`, registering `POST/PATCH/DELETE /api/wilayah/dusun[/:id]`, `POST/PATCH/DELETE /api/wilayah/rw[/:id]`, `POST/PATCH/DELETE /api/wilayah/rt[/:id]`. Task 9 (frontend Kelola Wilayah page) and Task 10 (frontend Warga Terdampak page's inline "add new" combobox) call these.

- [ ] **Step 1: Create the route file**

```typescript
// api/src/routes/wilayah.ts
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function registerWilayahRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  // ---- Dusun ----
  app.post<{ Body: { deployment_slug: string; nama: string } }>(
    '/api/wilayah/dusun',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const deploymentSlug = trimmedNonEmpty(req.body.deployment_slug);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!deploymentSlug) return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama dusun wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_dusun')
        .insert({ deployment_slug: deploymentSlug, nama })
        .select('id, deployment_slug, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama dusun ini sudah ada' });
        }
        req.log.error({ msg: 'INSERT wilayah_dusun error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ dusun: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/dusun/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama dusun wajib diisi' });

      const { error } = await supabase.from('wilayah_dusun').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama dusun ini sudah ada' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/dusun/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_dusun').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh RW atau data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  // ---- RW ----
  app.post<{ Body: { dusun_id: string; nama: string } }>(
    '/api/wilayah/rw',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const dusunId = trimmedNonEmpty(req.body.dusun_id);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!dusunId) return reply.code(400).send({ error: 'dusun_id wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama RW wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_rw')
        .insert({ dusun_id: dusunId, nama })
        .select('id, dusun_id, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RW ini sudah ada di dusun tersebut' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'Dusun induk tidak ditemukan' });
        }
        req.log.error({ msg: 'INSERT wilayah_rw error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ rw: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/rw/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama RW wajib diisi' });

      const { error } = await supabase.from('wilayah_rw').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RW ini sudah ada di dusun tersebut' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/rw/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_rw').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh RT atau data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  // ---- RT ----
  app.post<{ Body: { rw_id: string; nama: string } }>(
    '/api/wilayah/rt',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const rwId = trimmedNonEmpty(req.body.rw_id);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!rwId) return reply.code(400).send({ error: 'rw_id wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama RT wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_rt')
        .insert({ rw_id: rwId, nama })
        .select('id, rw_id, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RT ini sudah ada di RW tersebut' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'RW induk tidak ditemukan' });
        }
        req.log.error({ msg: 'INSERT wilayah_rt error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ rt: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/rt/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama RT wajib diisi' });

      const { error } = await supabase.from('wilayah_rt').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RT ini sudah ada di RW tersebut' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/rt/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_rt').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 2: Register the route in `app.ts`**

In `api/src/app.ts`, add the import next to the other route imports:
```typescript
import { registerWilayahRoutes } from './routes/wilayah.js';
```
And register it next to the other `await register*Routes(app, deps);` calls:
```typescript
  await registerWilayahRoutes(app, deps);
```

- [ ] **Step 3: Type-check**

Run: `cd api && npm run build`
Expected: compiles with no errors (build output in `api/dist`).

- [ ] **Step 4: Smoke-test route registration (no DB needed)**

Run: `cd api && npm run dev` (starts Fastify on port 3100 from `FASTIFY_PORT` in `api/.env`), then in another terminal:
```bash
curl -i -X POST http://localhost:3100/api/wilayah/dusun -H "Content-Type: application/json" -d '{"nama":"Test"}'
```
Expected: `HTTP/1.1 401` with body `{"error":"Authorization header diperlukan"}` — confirms the route is registered and `requireAdmin` is gating it. (Full success-path testing with a real admin token happens in Task 9, once the migration from Task 1 has been applied and there's a UI to log in through.)

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/wilayah.ts api/src/app.ts
git commit -m "feat: add API routes for wilayah (dusun/rw/rt) master data"
```

---

## Task 3: API routes — Kejadian Banjir

**Files:**
- Create: `api/src/routes/banjirEvents.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: `RouteDeps` (unchanged).
- Produces: `registerBanjirEventRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void>`, registering `POST/PATCH/DELETE /api/banjir/events[/:id]`. Task 8 (frontend Kejadian Banjir page) and Task 10 (Warga Terdampak page's event picker) consume this.

- [ ] **Step 1: Create the route file**

```typescript
// api/src/routes/banjirEvents.ts
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function registerBanjirEventRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.post<{
    Body: {
      deployment_slug: string;
      nama: string;
      tanggal_mulai: string;
      tanggal_selesai?: string | null;
      keterangan?: string | null;
    };
  }>('/api/banjir/events', { preHandler: requireAdmin }, async (req, reply) => {
    const deploymentSlug = trimmedNonEmpty(req.body.deployment_slug);
    const nama = trimmedNonEmpty(req.body.nama);
    const tanggalMulai = req.body.tanggal_mulai;

    if (!deploymentSlug) return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
    if (!nama) return reply.code(400).send({ error: 'nama kejadian wajib diisi' });
    if (!DATE_RE.test(tanggalMulai ?? '')) {
      return reply.code(400).send({ error: 'tanggal_mulai wajib diisi, format YYYY-MM-DD' });
    }
    if (req.body.tanggal_selesai && !DATE_RE.test(req.body.tanggal_selesai)) {
      return reply.code(400).send({ error: 'tanggal_selesai harus format YYYY-MM-DD' });
    }

    const { data, error } = await supabase
      .from('banjir_events')
      .insert({
        deployment_slug: deploymentSlug,
        nama,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: req.body.tanggal_selesai || null,
        keterangan: req.body.keterangan?.trim() || null,
      })
      .select('id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan, created_at')
      .single();

    if (error) {
      req.log.error({ msg: 'INSERT banjir_events error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ event: data });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      nama?: string;
      tanggal_mulai?: string;
      tanggal_selesai?: string | null;
      keterangan?: string | null;
    };
  }>('/api/banjir/events/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const b = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (b.nama !== undefined) {
      const nama = trimmedNonEmpty(b.nama);
      if (!nama) return reply.code(400).send({ error: 'nama kejadian wajib diisi' });
      updates.nama = nama;
    }
    if (b.tanggal_mulai !== undefined) {
      if (!DATE_RE.test(b.tanggal_mulai)) {
        return reply.code(400).send({ error: 'tanggal_mulai harus format YYYY-MM-DD' });
      }
      updates.tanggal_mulai = b.tanggal_mulai;
    }
    if (b.tanggal_selesai !== undefined) {
      if (b.tanggal_selesai && !DATE_RE.test(b.tanggal_selesai)) {
        return reply.code(400).send({ error: 'tanggal_selesai harus format YYYY-MM-DD' });
      }
      updates.tanggal_selesai = b.tanggal_selesai || null;
    }
    if (b.keterangan !== undefined) {
      updates.keterangan = b.keterangan?.trim() || null;
    }

    const { error } = await supabase.from('banjir_events').update(updates).eq('id', id);
    if (error) {
      req.log.error({ msg: 'PATCH banjir_events error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/banjir/events/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('banjir_events').delete().eq('id', req.params.id);
      if (error) {
        req.log.error({ msg: 'DELETE banjir_events error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 2: Register the route in `app.ts`**

Add `import { registerBanjirEventRoutes } from './routes/banjirEvents.js';` and `await registerBanjirEventRoutes(app, deps);` alongside the others.

- [ ] **Step 3: Type-check**

Run: `cd api && npm run build`
Expected: no errors.

- [ ] **Step 4: Smoke-test route registration**

With `npm run dev` running:
```bash
curl -i -X POST http://localhost:3100/api/banjir/events -H "Content-Type: application/json" -d '{"nama":"Test"}'
```
Expected: `401` — same reasoning as Task 2 Step 4.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/banjirEvents.ts api/src/app.ts
git commit -m "feat: add API routes for kejadian banjir"
```

---

## Task 4: API routes — Warga Terdampak

**Files:**
- Create: `api/src/routes/wargaTerdampak.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: `RouteDeps` (unchanged).
- Produces: `registerWargaTerdampakRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void>`, registering `POST/PATCH/DELETE /api/banjir/warga[/:id]`. Task 10 (frontend Warga Terdampak page) consumes this. Also produces the exported `WargaBody` type shape (documented below) that Task 10's frontend form payload must match field-for-field.

- [ ] **Step 1: Create the route file**

```typescript
// api/src/routes/wargaTerdampak.ts
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

const NIK_RE = /^[0-9]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JENIS_KELAMIN_VALUES = ['laki-laki', 'perempuan'] as const;
const STATUS_VALUES = ['di_rumah', 'mengungsi', 'lainnya'] as const;

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function optionalTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

type WargaBody = {
  banjir_event_id: string;
  deployment_slug: string;
  nik?: string | null;
  nama_lengkap: string;
  tanggal_lahir: string;
  jenis_kelamin: string;
  no_kk?: string | null;
  kontak_hp?: string | null;
  status_saat_ini?: string;
  dusun_id: string;
  rw_id: string;
  rt_id: string;
  detail_alamat?: string | null;
  catatan?: string | null;
};

function validateWargaBody(
  b: Partial<WargaBody>,
  opts: { partial: boolean },
): { ok: true } | { ok: false; error: string } {
  if (!opts.partial || b.nama_lengkap !== undefined) {
    if (!trimmedNonEmpty(b.nama_lengkap)) return { ok: false, error: 'nama_lengkap wajib diisi' };
  }
  if (!opts.partial || b.tanggal_lahir !== undefined) {
    if (!DATE_RE.test(b.tanggal_lahir ?? '')) {
      return { ok: false, error: 'tanggal_lahir wajib diisi, format YYYY-MM-DD' };
    }
  }
  if (!opts.partial || b.jenis_kelamin !== undefined) {
    if (!JENIS_KELAMIN_VALUES.includes(b.jenis_kelamin as (typeof JENIS_KELAMIN_VALUES)[number])) {
      return { ok: false, error: `jenis_kelamin harus salah satu dari: ${JENIS_KELAMIN_VALUES.join(', ')}` };
    }
  }
  if (
    b.status_saat_ini !== undefined &&
    !STATUS_VALUES.includes(b.status_saat_ini as (typeof STATUS_VALUES)[number])
  ) {
    return { ok: false, error: `status_saat_ini harus salah satu dari: ${STATUS_VALUES.join(', ')}` };
  }
  if (b.nik !== undefined && b.nik !== null && b.nik !== '' && !NIK_RE.test(b.nik)) {
    return { ok: false, error: 'nik harus 16 digit angka' };
  }
  if (!opts.partial || b.dusun_id !== undefined) {
    if (!trimmedNonEmpty(b.dusun_id)) return { ok: false, error: 'dusun_id wajib diisi' };
  }
  if (!opts.partial || b.rw_id !== undefined) {
    if (!trimmedNonEmpty(b.rw_id)) return { ok: false, error: 'rw_id wajib diisi' };
  }
  if (!opts.partial || b.rt_id !== undefined) {
    if (!trimmedNonEmpty(b.rt_id)) return { ok: false, error: 'rt_id wajib diisi' };
  }
  return { ok: true };
}

export async function registerWargaTerdampakRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.post<{ Body: WargaBody }>('/api/banjir/warga', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const validation = validateWargaBody(b, { partial: false });
    if (!validation.ok) return reply.code(400).send({ error: validation.error });
    if (!trimmedNonEmpty(b.banjir_event_id)) {
      return reply.code(400).send({ error: 'banjir_event_id wajib diisi' });
    }
    if (!trimmedNonEmpty(b.deployment_slug)) {
      return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
    }

    const row = {
      banjir_event_id: b.banjir_event_id,
      deployment_slug: b.deployment_slug,
      nik: optionalTrimmed(b.nik),
      nama_lengkap: trimmedNonEmpty(b.nama_lengkap),
      tanggal_lahir: b.tanggal_lahir,
      jenis_kelamin: b.jenis_kelamin,
      no_kk: optionalTrimmed(b.no_kk),
      kontak_hp: optionalTrimmed(b.kontak_hp),
      status_saat_ini: b.status_saat_ini ?? 'di_rumah',
      dusun_id: b.dusun_id,
      rw_id: b.rw_id,
      rt_id: b.rt_id,
      detail_alamat: optionalTrimmed(b.detail_alamat),
      catatan: optionalTrimmed(b.catatan),
    };

    const { data, error } = await supabase.from('warga_terdampak').insert(row).select('id').single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return reply.code(409).send({ error: 'NIK ini sudah tercatat pada kejadian banjir yang sama' });
      }
      if (error.code === '23503') {
        return reply.code(400).send({ error: 'Kejadian banjir atau wilayah (dusun/RW/RT) tidak ditemukan' });
      }
      req.log.error({ msg: 'INSERT warga_terdampak error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ id: data.id });
  });

  app.patch<{ Params: { id: string }; Body: Partial<WargaBody> }>(
    '/api/banjir/warga/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const b = req.body;
      const validation = validateWargaBody(b, { partial: true });
      if (!validation.ok) return reply.code(400).send({ error: validation.error });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.nik !== undefined) updates.nik = optionalTrimmed(b.nik);
      if (b.nama_lengkap !== undefined) updates.nama_lengkap = trimmedNonEmpty(b.nama_lengkap);
      if (b.tanggal_lahir !== undefined) updates.tanggal_lahir = b.tanggal_lahir;
      if (b.jenis_kelamin !== undefined) updates.jenis_kelamin = b.jenis_kelamin;
      if (b.no_kk !== undefined) updates.no_kk = optionalTrimmed(b.no_kk);
      if (b.kontak_hp !== undefined) updates.kontak_hp = optionalTrimmed(b.kontak_hp);
      if (b.status_saat_ini !== undefined) updates.status_saat_ini = b.status_saat_ini;
      if (b.dusun_id !== undefined) updates.dusun_id = b.dusun_id;
      if (b.rw_id !== undefined) updates.rw_id = b.rw_id;
      if (b.rt_id !== undefined) updates.rt_id = b.rt_id;
      if (b.detail_alamat !== undefined) updates.detail_alamat = optionalTrimmed(b.detail_alamat);
      if (b.catatan !== undefined) updates.catatan = optionalTrimmed(b.catatan);

      const { error } = await supabase.from('warga_terdampak').update(updates).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'NIK ini sudah tercatat pada kejadian banjir yang sama' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'Wilayah (dusun/RW/RT) tidak ditemukan' });
        }
        req.log.error({ msg: 'PATCH warga_terdampak error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/banjir/warga/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('warga_terdampak').delete().eq('id', req.params.id);
      if (error) {
        req.log.error({ msg: 'DELETE warga_terdampak error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 2: Register the route in `app.ts`**

Add `import { registerWargaTerdampakRoutes } from './routes/wargaTerdampak.js';` and `await registerWargaTerdampakRoutes(app, deps);`.

- [ ] **Step 3: Type-check**

Run: `cd api && npm run build`
Expected: no errors.

- [ ] **Step 4: Smoke-test route registration**

With `npm run dev` running:
```bash
curl -i -X POST http://localhost:3100/api/banjir/warga -H "Content-Type: application/json" -d '{}'
```
Expected: `401` (auth is checked before body validation, via `preHandler`).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/wargaTerdampak.ts api/src/app.ts
git commit -m "feat: add API routes for warga terdampak"
```

---

## Task 5: Frontend domain types

**Files:**
- Create: `sijagakali-app/src/lib/banjir/types.ts`

**Interfaces:**
- Produces: `WilayahDusun`, `WilayahRw`, `WilayahRt`, `BanjirEvent`, `StatusSaatIni`, `STATUS_SAAT_INI_LABEL`, `WargaTerdampak`, `hitungUmur(tanggalLahir: string): number`. All later frontend tasks (7, 8, 9, 10) import from this file. Field names are snake_case, matching the raw JSON shape returned by both direct Supabase reads and the Task 2–4 API responses (same convention as `AdminUser` in `sijagakali-app/src/pages/AdminUsers.tsx` — no camelCase mapping layer, since there's no derived data here besides age).

- [ ] **Step 1: Create the types file**

```typescript
// sijagakali-app/src/lib/banjir/types.ts
export interface WilayahDusun {
  id: string;
  deployment_slug: string;
  nama: string;
}

export interface WilayahRw {
  id: string;
  dusun_id: string;
  nama: string;
}

export interface WilayahRt {
  id: string;
  rw_id: string;
  nama: string;
}

export interface BanjirEvent {
  id: string;
  deployment_slug: string;
  nama: string;
  tanggal_mulai: string;
  tanggal_selesai: string | null;
  keterangan: string | null;
}

export type StatusSaatIni = 'di_rumah' | 'mengungsi' | 'lainnya';

export const STATUS_SAAT_INI_LABEL: Record<StatusSaatIni, string> = {
  di_rumah: 'Di rumah',
  mengungsi: 'Mengungsi',
  lainnya: 'Lainnya',
};

export interface WargaTerdampak {
  id: string;
  banjir_event_id: string;
  deployment_slug: string;
  nik: string | null;
  nama_lengkap: string;
  tanggal_lahir: string;
  jenis_kelamin: 'laki-laki' | 'perempuan';
  no_kk: string | null;
  kontak_hp: string | null;
  status_saat_ini: StatusSaatIni;
  dusun_id: string;
  rw_id: string;
  rt_id: string;
  detail_alamat: string | null;
  catatan: string | null;
}

/** Umur (tahun) dari tanggal_lahir, dihitung terhadap tanggal hari ini. */
export function hitungUmur(tanggalLahir: string): number {
  const lahir = new Date(tanggalLahir);
  const now = new Date();
  let umur = now.getFullYear() - lahir.getFullYear();
  const belumUlangTahun =
    now.getMonth() < lahir.getMonth() ||
    (now.getMonth() === lahir.getMonth() && now.getDate() < lahir.getDate());
  if (belumUlangTahun) umur -= 1;
  return umur;
}
```

- [ ] **Step 2: One runnable check for `hitungUmur` (non-trivial date-math logic)**

Create: `sijagakali-app/src/lib/banjir/types.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { hitungUmur } from './types';

describe('hitungUmur', () => {
  it('computes full years elapsed, accounting for birthday not yet reached this year', () => {
    const now = new Date();
    const notYetBirthdayThisYear = new Date(now.getFullYear() - 30, now.getMonth() + 1, 1);
    expect(hitungUmur(notYetBirthdayThisYear.toISOString().slice(0, 10))).toBe(29);
  });

  it('counts the year once the birthday has passed this year', () => {
    const now = new Date();
    const birthdayAlreadyPassed = new Date(now.getFullYear() - 30, 0, 1);
    expect(hitungUmur(birthdayAlreadyPassed.toISOString().slice(0, 10))).toBe(30);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `cd sijagakali-app && npx vitest run src/lib/banjir/types.test.ts`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/banjir/types.ts src/lib/banjir/types.test.ts
git commit -m "feat: add domain types for warga terdampak banjir"
```

---

## Task 6: Reusable cascading combobox component

**Files:**
- Create: `sijagakali-app/src/components/ui/combobox.tsx`

**Interfaces:**
- Consumes: `Command`/`CommandInput`/`CommandList`/`CommandEmpty`/`CommandGroup`/`CommandItem` from `@/components/ui/command`, `Popover`/`PopoverTrigger`/`PopoverContent` from `@/components/ui/popover`, `Button` from `@/components/ui/button`, `cn` from `@/lib/utils` — all already in the repo.
- Produces: `ComboboxOption { value: string; label: string }` and `Combobox` component with props `{ options: ComboboxOption[]; value: string | null; onChange: (value: string) => void; onAddNew?: (label: string) => void | Promise<void>; placeholder?: string; emptyText?: string; disabled?: boolean; addNewLabel?: (query: string) => string }`. Task 9 (Kelola Wilayah parent pickers) and Task 10 (Warga Terdampak cascading Dusun→RW→RT) both import `Combobox` and `ComboboxOption` from this file.

- [ ] **Step 1: Create the component**

```tsx
// sijagakali-app/src/components/ui/combobox.tsx
import { useState } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  onAddNew?: (label: string) => void | Promise<void>;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  addNewLabel?: (query: string) => string;
}

export function Combobox({
  options,
  value,
  onChange,
  onAddNew,
  placeholder = 'Pilih...',
  emptyText = 'Tidak ada hasil.',
  disabled = false,
  addNewLabel = (q) => `+ Tambah "${q}"`,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const hasExactMatch = options.some((o) => o.label.toLowerCase() === q);
  const showAddNew = Boolean(onAddNew) && q.length > 0 && !hasExactMatch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          {selected ? selected.label : <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Cari atau ketik baru..." value={query} onValueChange={setQuery} />
          <CommandList>
            {filtered.length === 0 && !showAddNew && <CommandEmpty>{emptyText}</CommandEmpty>}
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(option.value);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                  {option.label}
                </CommandItem>
              ))}
              {showAddNew && (
                <CommandItem
                  value={`__add__${query}`}
                  onSelect={async () => {
                    await onAddNew!(query.trim());
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {addNewLabel(query.trim())}
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/combobox.tsx
git commit -m "feat: add cascading combobox with inline add-new support"
```

---

## Task 7: Kelola Wilayah page (Dusun/RW/RT master data)

**Files:**
- Create: `sijagakali-app/src/pages/KelolaWilayah.tsx`

**Interfaces:**
- Consumes: `getSupabase` from `@/lib/supabase`, `getDefaultDeploymentSlug` from `@/lib/sijagakaliEnv`, `useAuth` from `@/lib/authContext`, `WilayahDusun`/`WilayahRw`/`WilayahRt` from `@/lib/banjir/types` (Task 5), `Combobox`/`ComboboxOption` are NOT needed here — this page uses the plain `Select` from `@/components/ui/select` for parent pickers (no inline-add needed on the page that IS the source of truth), `AppLayout` from `@/components/AppLayout`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` from `@/components/ui/tabs`, `Table*` from `@/components/ui/table`, `Dialog*`/`AlertDialog*` as in `AdminUsers.tsx`. `POST/PATCH/DELETE /api/wilayah/dusun|rw|rt` from Task 2.
- Produces: default export `KelolaWilayah` component. Task 10 registers its route.

- [ ] **Step 1: Create the page**

```tsx
// sijagakali-app/src/pages/KelolaWilayah.tsx
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/authContext';
import { getSupabase } from '@/lib/supabase';
import { getDefaultDeploymentSlug } from '@/lib/sijagakaliEnv';
import type { WilayahDusun, WilayahRw, WilayahRt } from '@/lib/banjir/types';

const API_BASE = import.meta.env.VITE_SIJAGAKALIAPI_URL ?? '';

export default function KelolaWilayah() {
  const { accessToken } = useAuth();
  const slug = getDefaultDeploymentSlug();

  const [dusunList, setDusunList] = useState<WilayahDusun[]>([]);
  const [rwList, setRwList] = useState<WilayahRw[]>([]);
  const [rtList, setRtList] = useState<WilayahRt[]>([]);
  const [rwParentDusunId, setRwParentDusunId] = useState<string>('');
  const [rtParentRwId, setRtParentRwId] = useState<string>('');

  const [dialog, setDialog] = useState<
    | { kind: 'dusun'; mode: 'add' | 'edit'; target?: WilayahDusun }
    | { kind: 'rw'; mode: 'add' | 'edit'; target?: WilayahRw }
    | { kind: 'rt'; mode: 'add' | 'edit'; target?: WilayahRt }
    | null
  >(null);
  const [formNama, setFormNama] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    { kind: 'dusun' | 'rw' | 'rt'; id: string; label: string } | null
  >(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` }),
    [accessToken],
  );

  const fetchDusun = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('wilayah_dusun')
      .select('id, deployment_slug, nama')
      .eq('deployment_slug', slug)
      .order('nama');
    if (error) return toast.error('Gagal memuat daftar dusun', { description: error.message });
    setDusunList((data ?? []) as WilayahDusun[]);
  }, [slug]);

  const fetchRw = useCallback(async (dusunId: string) => {
    const supabase = getSupabase();
    if (!supabase || !dusunId) return setRwList([]);
    const { data, error } = await supabase
      .from('wilayah_rw')
      .select('id, dusun_id, nama')
      .eq('dusun_id', dusunId)
      .order('nama');
    if (error) return toast.error('Gagal memuat daftar RW', { description: error.message });
    setRwList((data ?? []) as WilayahRw[]);
  }, []);

  const fetchRt = useCallback(async (rwId: string) => {
    const supabase = getSupabase();
    if (!supabase || !rwId) return setRtList([]);
    const { data, error } = await supabase
      .from('wilayah_rt')
      .select('id, rw_id, nama')
      .eq('rw_id', rwId)
      .order('nama');
    if (error) return toast.error('Gagal memuat daftar RT', { description: error.message });
    setRtList((data ?? []) as WilayahRt[]);
  }, []);

  useEffect(() => {
    void fetchDusun();
  }, [fetchDusun]);

  useEffect(() => {
    void fetchRw(rwParentDusunId);
    setRtParentRwId('');
    setRtList([]);
  }, [rwParentDusunId, fetchRw]);

  useEffect(() => {
    void fetchRt(rtParentRwId);
  }, [rtParentRwId, fetchRt]);

  const openAdd = (kind: 'dusun' | 'rw' | 'rt') => {
    setFormNama('');
    setDialog({ kind, mode: 'add' } as never);
  };
  const openEdit = (kind: 'dusun' | 'rw' | 'rt', target: WilayahDusun | WilayahRw | WilayahRt) => {
    setFormNama(target.nama);
    setDialog({ kind, mode: 'edit', target } as never);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    const nama = formNama.trim();
    if (!nama) return toast.error('Nama wajib diisi');
    setSaving(true);
    try {
      if (dialog.kind === 'dusun') {
        const url =
          dialog.mode === 'add' ? `${API_BASE}/api/wilayah/dusun` : `${API_BASE}/api/wilayah/dusun/${dialog.target!.id}`;
        const body = dialog.mode === 'add' ? { deployment_slug: slug, nama } : { nama };
        const res = await fetch(url, { method: dialog.mode === 'add' ? 'POST' : 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menyimpan dusun');
        await fetchDusun();
      } else if (dialog.kind === 'rw') {
        if (!rwParentDusunId) return toast.error('Pilih dusun induk terlebih dahulu');
        const url = dialog.mode === 'add' ? `${API_BASE}/api/wilayah/rw` : `${API_BASE}/api/wilayah/rw/${dialog.target!.id}`;
        const body = dialog.mode === 'add' ? { dusun_id: rwParentDusunId, nama } : { nama };
        const res = await fetch(url, { method: dialog.mode === 'add' ? 'POST' : 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menyimpan RW');
        await fetchRw(rwParentDusunId);
      } else {
        if (!rtParentRwId) return toast.error('Pilih RW induk terlebih dahulu');
        const url = dialog.mode === 'add' ? `${API_BASE}/api/wilayah/rt` : `${API_BASE}/api/wilayah/rt/${dialog.target!.id}`;
        const body = dialog.mode === 'add' ? { rw_id: rtParentRwId, nama } : { nama };
        const res = await fetch(url, { method: dialog.mode === 'add' ? 'POST' : 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menyimpan RT');
        await fetchRt(rtParentRwId);
      }
      toast.success('Tersimpan');
      setDialog(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const url = `${API_BASE}/api/wilayah/${confirmDelete.kind}/${confirmDelete.id}`;
      const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menghapus');
      toast.success(`"${confirmDelete.label}" dihapus`);
      if (confirmDelete.kind === 'dusun') await fetchDusun();
      else if (confirmDelete.kind === 'rw') await fetchRw(rwParentDusunId);
      else await fetchRt(rtParentRwId);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Kelola Wilayah</h1>
        <p className="text-sm text-muted-foreground">Master data Dusun, RW, dan RT untuk pendataan warga terdampak</p>
      </div>

      <Tabs defaultValue="dusun">
        <TabsList>
          <TabsTrigger value="dusun">Dusun/Kampung/Perumahan</TabsTrigger>
          <TabsTrigger value="rw">RW</TabsTrigger>
          <TabsTrigger value="rt">RT</TabsTrigger>
        </TabsList>

        <TabsContent value="dusun" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" className="gap-1" onClick={() => openAdd('dusun')}>
              <Plus className="h-4 w-4" /> Tambah Dusun
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dusunList.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.nama}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit('dusun', d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setConfirmDelete({ kind: 'dusun', id: d.id, label: d.nama })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {dusunList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    Belum ada data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="rw" className="space-y-3">
          <Select value={rwParentDusunId} onValueChange={setRwParentDusunId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Pilih dusun induk" />
            </SelectTrigger>
            <SelectContent>
              {dusunList.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end">
            <Button size="sm" className="gap-1" disabled={!rwParentDusunId} onClick={() => openAdd('rw')}>
              <Plus className="h-4 w-4" /> Tambah RW
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rwList.map((rw) => (
                <TableRow key={rw.id}>
                  <TableCell>{rw.nama}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit('rw', rw)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setConfirmDelete({ kind: 'rw', id: rw.id, label: rw.nama })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rwParentDusunId && rwList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    Belum ada data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="rt" className="space-y-3">
          <Select value={rwParentDusunId} onValueChange={setRwParentDusunId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Pilih dusun induk" />
            </SelectTrigger>
            <SelectContent>
              {dusunList.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={rtParentRwId} onValueChange={setRtParentRwId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="Pilih RW induk" />
            </SelectTrigger>
            <SelectContent>
              {rwList.map((rw) => (
                <SelectItem key={rw.id} value={rw.id}>
                  {rw.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end">
            <Button size="sm" className="gap-1" disabled={!rtParentRwId} onClick={() => openAdd('rt')}>
              <Plus className="h-4 w-4" /> Tambah RT
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rtList.map((rt) => (
                <TableRow key={rt.id}>
                  <TableCell>{rt.nama}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit('rt', rt)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setConfirmDelete({ kind: 'rt', id: rt.id, label: rt.nama })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rtParentRwId && rtList.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    Belum ada data
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'add' ? 'Tambah' : 'Edit'} {dialog?.kind === 'dusun' ? 'Dusun' : dialog?.kind === 'rw' ? 'RW' : 'RT'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input value={formNama} onChange={(e) => setFormNama(e.target.value)} placeholder="Nama" required autoFocus />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus "{confirmDelete?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Tidak bisa dihapus jika masih dipakai oleh data di bawahnya (RW/RT/warga terdampak).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executeDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Menghapus…' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/KelolaWilayah.tsx
git commit -m "feat: add Kelola Wilayah page for dusun/rw/rt master data"
```

(This page isn't reachable yet — routing is wired up in Task 10. Manual click-through verification also happens then.)

---

## Task 8: Kejadian Banjir page

**Files:**
- Create: `sijagakali-app/src/pages/KejadianBanjir.tsx`

**Interfaces:**
- Consumes: `BanjirEvent` from `@/lib/banjir/types` (Task 5), `POST/PATCH/DELETE /api/banjir/events` from Task 3. Same UI pattern as `AdminUsers.tsx`.
- Produces: default export `KejadianBanjir` component. Task 10 registers its route; Task 10's Warga Terdampak page reads `banjir_events` directly via Supabase (not from this component) for its event picker.

- [ ] **Step 1: Create the page**

```tsx
// sijagakali-app/src/pages/KejadianBanjir.tsx
import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/authContext';
import { getSupabase } from '@/lib/supabase';
import { getDefaultDeploymentSlug } from '@/lib/sijagakaliEnv';
import type { BanjirEvent } from '@/lib/banjir/types';

const API_BASE = import.meta.env.VITE_SIJAGAKALIAPI_URL ?? '';

type FormState = { nama: string; tanggal_mulai: string; tanggal_selesai: string; keterangan: string };
const EMPTY_FORM: FormState = { nama: '', tanggal_mulai: '', tanggal_selesai: '', keterangan: '' };

export default function KejadianBanjir() {
  const { accessToken } = useAuth();
  const slug = getDefaultDeploymentSlug();
  const [events, setEvents] = useState<BanjirEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<BanjirEvent | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<BanjirEvent | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` }),
    [accessToken],
  );

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('banjir_events')
      .select('id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan')
      .eq('deployment_slug', slug)
      .order('tanggal_mulai', { ascending: false });
    setLoading(false);
    if (error) return toast.error('Gagal memuat kejadian banjir', { description: error.message });
    setEvents((data ?? []) as BanjirEvent[]);
  }, [slug]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditTarget(null);
    setDialogMode('add');
  };
  const openEdit = (ev: BanjirEvent) => {
    setForm({
      nama: ev.nama,
      tanggal_mulai: ev.tanggal_mulai,
      tanggal_selesai: ev.tanggal_selesai ?? '',
      keterangan: ev.keterangan ?? '',
    });
    setEditTarget(ev);
    setDialogMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nama.trim()) return toast.error('Nama kejadian wajib diisi');
    if (!form.tanggal_mulai) return toast.error('Tanggal mulai wajib diisi');
    setSaving(true);
    try {
      const url = dialogMode === 'add' ? `${API_BASE}/api/banjir/events` : `${API_BASE}/api/banjir/events/${editTarget!.id}`;
      const body =
        dialogMode === 'add'
          ? {
              deployment_slug: slug,
              nama: form.nama.trim(),
              tanggal_mulai: form.tanggal_mulai,
              tanggal_selesai: form.tanggal_selesai || null,
              keterangan: form.keterangan.trim() || null,
            }
          : {
              nama: form.nama.trim(),
              tanggal_mulai: form.tanggal_mulai,
              tanggal_selesai: form.tanggal_selesai || null,
              keterangan: form.keterangan.trim() || null,
            };
      const res = await fetch(url, { method: dialogMode === 'add' ? 'POST' : 'PATCH', headers: authHeaders(), body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menyimpan');
      toast.success('Kejadian banjir tersimpan');
      setDialogMode(null);
      await fetchEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/banjir/events/${confirmDelete.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menghapus');
      toast.success(`"${confirmDelete.nama}" dihapus`);
      setConfirmDelete(null);
      await fetchEvents();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Kejadian Banjir</h1>
          <p className="text-sm text-muted-foreground">Daftar kejadian banjir untuk pendataan warga terdampak</p>
        </div>
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" /> Tambah Kejadian
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead>Tanggal Mulai</TableHead>
            <TableHead>Tanggal Selesai</TableHead>
            <TableHead>Keterangan</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Memuat...
              </TableCell>
            </TableRow>
          ) : events.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                Belum ada kejadian banjir
              </TableCell>
            </TableRow>
          ) : (
            events.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="font-medium">{ev.nama}</TableCell>
                <TableCell>{ev.tanggal_mulai}</TableCell>
                <TableCell>{ev.tanggal_selesai ?? <span className="text-muted-foreground">Masih berlangsung</span>}</TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">{ev.keterangan ?? '—'}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(ev)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(ev)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Tambah Kejadian Banjir' : 'Edit Kejadian Banjir'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Kejadian</label>
              <Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} placeholder="Banjir Januari 2026" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Tanggal Mulai</label>
                <Input type="date" value={form.tanggal_mulai} onChange={(e) => setForm({ ...form, tanggal_mulai: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Tanggal Selesai (opsional)</label>
                <Input type="date" value={form.tanggal_selesai} onChange={(e) => setForm({ ...form, tanggal_selesai: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Keterangan</label>
              <Textarea value={form.keterangan} onChange={(e) => setForm({ ...form, keterangan: e.target.value })} placeholder="Opsional" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus "{confirmDelete?.nama}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua data warga terdampak yang tercatat pada kejadian ini akan ikut terhapus permanen. Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executeDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Menghapus…' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/KejadianBanjir.tsx
git commit -m "feat: add Kejadian Banjir page"
```

---

## Task 9: Warga Terdampak page (main CRUD + stats)

**Files:**
- Create: `sijagakali-app/src/pages/WargaTerdampak.tsx`

**Interfaces:**
- Consumes: `WargaTerdampak`, `BanjirEvent`, `WilayahDusun`, `WilayahRw`, `WilayahRt`, `StatusSaatIni`, `STATUS_SAAT_INI_LABEL`, `hitungUmur` from `@/lib/banjir/types` (Task 5); `Combobox`, `ComboboxOption` from `@/components/ui/combobox` (Task 6); `POST/PATCH/DELETE /api/wilayah/dusun|rw|rt` (Task 2, for inline add-new), `POST/PATCH/DELETE /api/banjir/warga` (Task 4, exact body field names from `WargaBody` in `api/src/routes/wargaTerdampak.ts`).
- Produces: default export `WargaTerdampak` component. Task 10 registers its route.

- [ ] **Step 1: Create the page**

```tsx
// sijagakali-app/src/pages/WargaTerdampak.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { useAuth } from '@/lib/authContext';
import { getSupabase } from '@/lib/supabase';
import { getDefaultDeploymentSlug } from '@/lib/sijagakaliEnv';
import {
  hitungUmur,
  STATUS_SAAT_INI_LABEL,
  type BanjirEvent,
  type StatusSaatIni,
  type WargaTerdampak as WargaTerdampakRow,
  type WilayahDusun,
  type WilayahRw,
  type WilayahRt,
} from '@/lib/banjir/types';

const API_BASE = import.meta.env.VITE_SIJAGAKALIAPI_URL ?? '';

type FormState = {
  nik: string;
  nama_lengkap: string;
  tanggal_lahir: string;
  jenis_kelamin: 'laki-laki' | 'perempuan';
  no_kk: string;
  kontak_hp: string;
  status_saat_ini: StatusSaatIni;
  dusun_id: string;
  rw_id: string;
  rt_id: string;
  detail_alamat: string;
  catatan: string;
};

const EMPTY_FORM: FormState = {
  nik: '',
  nama_lengkap: '',
  tanggal_lahir: '',
  jenis_kelamin: 'laki-laki',
  no_kk: '',
  kontak_hp: '',
  status_saat_ini: 'di_rumah',
  dusun_id: '',
  rw_id: '',
  rt_id: '',
  detail_alamat: '',
  catatan: '',
};

export default function WargaTerdampak() {
  const { accessToken } = useAuth();
  const slug = getDefaultDeploymentSlug();

  const [events, setEvents] = useState<BanjirEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [warga, setWarga] = useState<WargaTerdampakRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [dusunList, setDusunList] = useState<WilayahDusun[]>([]);
  const [rwList, setRwList] = useState<WilayahRw[]>([]);
  const [rtList, setRtList] = useState<WilayahRt[]>([]);
  // Nama RW/RT per baris tabel — beda dari rwList/rtList di atas, yang cuma
  // berisi opsi combobox untuk dusun/RW yang sedang dipilih DI FORM, bukan
  // RW/RT milik tiap baris warga (yang dusun/RW induknya bisa berbeda-beda).
  const [rwNameById, setRwNameById] = useState<Map<string, string>>(new Map());
  const [rtNameById, setRtNameById] = useState<Map<string, string>>(new Map());

  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<WargaTerdampakRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WargaTerdampakRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` }),
    [accessToken],
  );

  // ---- Load kejadian banjir; default to the most recent still-open one ----
  const fetchEvents = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('banjir_events')
      .select('id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan')
      .eq('deployment_slug', slug)
      .order('tanggal_mulai', { ascending: false });
    if (error) return toast.error('Gagal memuat kejadian banjir', { description: error.message });
    const list = (data ?? []) as BanjirEvent[];
    setEvents(list);
    setSelectedEventId((prev) => prev || list.find((e) => !e.tanggal_selesai)?.id || list[0]?.id || '');
  }, [slug]);

  // ---- Load wilayah master data (needed for the cascading combobox + address display) ----
  const fetchDusun = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('wilayah_dusun')
      .select('id, deployment_slug, nama')
      .eq('deployment_slug', slug)
      .order('nama');
    if (error) return toast.error('Gagal memuat dusun', { description: error.message });
    setDusunList((data ?? []) as WilayahDusun[]);
  }, [slug]);

  const fetchRwFor = useCallback(async (dusunId: string): Promise<WilayahRw[]> => {
    const supabase = getSupabase();
    if (!supabase || !dusunId) return [];
    const { data, error } = await supabase.from('wilayah_rw').select('id, dusun_id, nama').eq('dusun_id', dusunId).order('nama');
    if (error) {
      toast.error('Gagal memuat RW', { description: error.message });
      return [];
    }
    return (data ?? []) as WilayahRw[];
  }, []);

  const fetchRtFor = useCallback(async (rwId: string): Promise<WilayahRt[]> => {
    const supabase = getSupabase();
    if (!supabase || !rwId) return [];
    const { data, error } = await supabase.from('wilayah_rt').select('id, rw_id, nama').eq('rw_id', rwId).order('nama');
    if (error) {
      toast.error('Gagal memuat RT', { description: error.message });
      return [];
    }
    return (data ?? []) as WilayahRt[];
  }, []);

  // ---- Load RW/RT display names for whichever rw_id/rt_id values appear in the loaded rows ----
  const fetchNameLookups = useCallback(async (rows: WargaTerdampakRow[]) => {
    const supabase = getSupabase();
    if (!supabase || rows.length === 0) {
      setRwNameById(new Map());
      setRtNameById(new Map());
      return;
    }
    const rwIds = [...new Set(rows.map((r) => r.rw_id))];
    const rtIds = [...new Set(rows.map((r) => r.rt_id))];
    const [{ data: rwRows }, { data: rtRows }] = await Promise.all([
      supabase.from('wilayah_rw').select('id, nama').in('id', rwIds),
      supabase.from('wilayah_rt').select('id, nama').in('id', rtIds),
    ]);
    setRwNameById(new Map(((rwRows ?? []) as { id: string; nama: string }[]).map((r) => [r.id, r.nama])));
    setRtNameById(new Map(((rtRows ?? []) as { id: string; nama: string }[]).map((r) => [r.id, r.nama])));
  }, []);

  // ---- Load warga for the selected event ----
  const fetchWarga = useCallback(
    async (eventId: string) => {
      if (!eventId) {
        setWarga([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const supabase = getSupabase();
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('warga_terdampak')
        .select(
          'id, banjir_event_id, deployment_slug, nik, nama_lengkap, tanggal_lahir, jenis_kelamin, no_kk, kontak_hp, status_saat_ini, dusun_id, rw_id, rt_id, detail_alamat, catatan',
        )
        .eq('banjir_event_id', eventId)
        .order('nama_lengkap');
      setLoading(false);
      if (error) return toast.error('Gagal memuat data warga', { description: error.message });
      const rows = (data ?? []) as WargaTerdampakRow[];
      setWarga(rows);
      await fetchNameLookups(rows);
    },
    [fetchNameLookups],
  );

  useEffect(() => {
    void fetchEvents();
    void fetchDusun();
  }, [fetchEvents, fetchDusun]);

  useEffect(() => {
    void fetchWarga(selectedEventId);
  }, [selectedEventId, fetchWarga]);

  // ---- Stats for the selected event ----
  const stats = useMemo(() => {
    const total = warga.length;
    const totalKk = new Set(warga.map((w) => w.no_kk).filter((v): v is string => !!v)).size;
    const mengungsi = warga.filter((w) => w.status_saat_ini === 'mengungsi').length;
    const diRumah = warga.filter((w) => w.status_saat_ini === 'di_rumah').length;
    const perDusun = new Map<string, number>();
    for (const w of warga) perDusun.set(w.dusun_id, (perDusun.get(w.dusun_id) ?? 0) + 1);
    const topDusun = [...perDusun.entries()]
      .map(([dusunId, count]) => ({ nama: dusunList.find((d) => d.id === dusunId)?.nama ?? '—', count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    return { total, totalKk, mengungsi, diRumah, topDusun };
  }, [warga, dusunList]);

  const dusunOptions: ComboboxOption[] = dusunList.map((d) => ({ value: d.id, label: d.nama }));
  const rwOptions: ComboboxOption[] = rwList.map((r) => ({ value: r.id, label: r.nama }));
  const rtOptions: ComboboxOption[] = rtList.map((r) => ({ value: r.id, label: r.nama }));

  const namaFor = (id: string, list: { id: string; nama: string }[]) => list.find((x) => x.id === id)?.nama ?? '—';

  // ---- Cascading combobox handlers (form state) ----
  const setFormDusun = async (dusunId: string) => {
    setForm((f) => ({ ...f, dusun_id: dusunId, rw_id: '', rt_id: '' }));
    setRtList([]);
    setRwList(await fetchRwFor(dusunId));
  };
  const addNewDusun = async (nama: string) => {
    const res = await fetch(`${API_BASE}/api/wilayah/dusun`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ deployment_slug: slug, nama }),
    });
    if (!res.ok) return toast.error(((await res.json()) as { error?: string }).error ?? 'Gagal menambah dusun');
    const { dusun } = (await res.json()) as { dusun: WilayahDusun };
    setDusunList((prev) => [...prev, dusun].sort((a, b) => a.nama.localeCompare(b.nama)));
    await setFormDusun(dusun.id);
  };

  const setFormRw = async (rwId: string) => {
    setForm((f) => ({ ...f, rw_id: rwId, rt_id: '' }));
    setRtList(await fetchRtFor(rwId));
  };
  const addNewRw = async (nama: string) => {
    if (!form.dusun_id) return toast.error('Pilih Dusun terlebih dahulu');
    const res = await fetch(`${API_BASE}/api/wilayah/rw`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ dusun_id: form.dusun_id, nama }),
    });
    if (!res.ok) return toast.error(((await res.json()) as { error?: string }).error ?? 'Gagal menambah RW');
    const { rw } = (await res.json()) as { rw: WilayahRw };
    setRwList((prev) => [...prev, rw].sort((a, b) => a.nama.localeCompare(b.nama)));
    await setFormRw(rw.id);
  };

  const setFormRt = (rtId: string) => setForm((f) => ({ ...f, rt_id: rtId }));
  const addNewRt = async (nama: string) => {
    if (!form.rw_id) return toast.error('Pilih RW terlebih dahulu');
    const res = await fetch(`${API_BASE}/api/wilayah/rt`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rw_id: form.rw_id, nama }),
    });
    if (!res.ok) return toast.error(((await res.json()) as { error?: string }).error ?? 'Gagal menambah RT');
    const { rt } = (await res.json()) as { rt: WilayahRt };
    setRtList((prev) => [...prev, rt].sort((a, b) => a.nama.localeCompare(b.nama)));
    setFormRt(rt.id);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setRwList([]);
    setRtList([]);
    setEditTarget(null);
    setDialogMode('add');
  };

  const openEdit = async (w: WargaTerdampakRow) => {
    setForm({
      nik: w.nik ?? '',
      nama_lengkap: w.nama_lengkap,
      tanggal_lahir: w.tanggal_lahir,
      jenis_kelamin: w.jenis_kelamin,
      no_kk: w.no_kk ?? '',
      kontak_hp: w.kontak_hp ?? '',
      status_saat_ini: w.status_saat_ini,
      dusun_id: w.dusun_id,
      rw_id: w.rw_id,
      rt_id: w.rt_id,
      detail_alamat: w.detail_alamat ?? '',
      catatan: w.catatan ?? '',
    });
    setRwList(await fetchRwFor(w.dusun_id));
    setRtList(await fetchRtFor(w.rw_id));
    setEditTarget(w);
    setDialogMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return toast.error('Pilih kejadian banjir terlebih dahulu');
    if (!form.nama_lengkap.trim()) return toast.error('Nama lengkap wajib diisi');
    if (!form.tanggal_lahir) return toast.error('Tanggal lahir wajib diisi');
    if (!form.dusun_id || !form.rw_id || !form.rt_id) return toast.error('Dusun, RW, dan RT wajib dipilih');
    if (form.nik && !/^\d{16}$/.test(form.nik)) return toast.error('NIK harus 16 digit angka');

    setSaving(true);
    try {
      const payload = {
        banjir_event_id: selectedEventId,
        deployment_slug: slug,
        nik: form.nik.trim() || null,
        nama_lengkap: form.nama_lengkap.trim(),
        tanggal_lahir: form.tanggal_lahir,
        jenis_kelamin: form.jenis_kelamin,
        no_kk: form.no_kk.trim() || null,
        kontak_hp: form.kontak_hp.trim() || null,
        status_saat_ini: form.status_saat_ini,
        dusun_id: form.dusun_id,
        rw_id: form.rw_id,
        rt_id: form.rt_id,
        detail_alamat: form.detail_alamat.trim() || null,
        catatan: form.catatan.trim() || null,
      };
      const url = dialogMode === 'add' ? `${API_BASE}/api/banjir/warga` : `${API_BASE}/api/banjir/warga/${editTarget!.id}`;
      const res = await fetch(url, { method: dialogMode === 'add' ? 'POST' : 'PATCH', headers: authHeaders(), body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menyimpan');
      toast.success('Data warga tersimpan');
      setDialogMode(null);
      await fetchWarga(selectedEventId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/banjir/warga/${confirmDelete.id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal menghapus');
      toast.success(`"${confirmDelete.nama_lengkap}" dihapus`);
      setConfirmDelete(null);
      await fetchWarga(selectedEventId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppLayout>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Warga Terdampak Banjir</h1>
          <p className="text-sm text-muted-foreground">Pendataan warga terdampak per kejadian banjir</p>
        </div>
        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue placeholder="Pilih kejadian banjir" />
          </SelectTrigger>
          <SelectContent>
            {events.map((ev) => (
              <SelectItem key={ev.id} value={ev.id}>
                {ev.nama} {!ev.tanggal_selesai && '(berlangsung)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {events.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Belum ada kejadian banjir. Buat kejadian banjir dulu di menu "Kejadian Banjir".
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total Warga</p>
              <p className="text-2xl font-bold">{stats.total}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total KK</p>
              <p className="text-2xl font-bold">{stats.totalKk}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Mengungsi</p>
              <p className="text-2xl font-bold">{stats.mengungsi}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Di Rumah</p>
              <p className="text-2xl font-bold">{stats.diRumah}</p>
            </Card>
          </div>

          <div className="mb-4 flex justify-end">
            <Button onClick={openAdd} className="gap-2">
              <Plus className="h-4 w-4" /> Tambah Warga
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>NIK</TableHead>
                <TableHead>Umur</TableHead>
                <TableHead>Alamat</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Memuat...
                  </TableCell>
                </TableRow>
              ) : warga.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Belum ada data warga untuk kejadian ini
                  </TableCell>
                </TableRow>
              ) : (
                warga.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.nama_lengkap}</TableCell>
                    <TableCell className="font-mono text-xs">{w.nik ?? '—'}</TableCell>
                    <TableCell>{hitungUmur(w.tanggal_lahir)} th</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {namaFor(w.dusun_id, dusunList)} / RW {rwNameById.get(w.rw_id) ?? '—'} / RT {rtNameById.get(w.rt_id) ?? '—'}
                      {w.detail_alamat ? ` — ${w.detail_alamat}` : ''}
                    </TableCell>
                    <TableCell>{STATUS_SAAT_INI_LABEL[w.status_saat_ini]}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => void openEdit(w)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(w)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </>
      )}

      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && setDialogMode(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogMode === 'add' ? 'Tambah Warga Terdampak' : 'Edit Warga Terdampak'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">NIK (opsional, 16 digit)</label>
              <Input value={form.nik} onChange={(e) => setForm({ ...form, nik: e.target.value })} placeholder="3204xxxxxxxxxxxx" maxLength={16} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nama Lengkap</label>
              <Input value={form.nama_lengkap} onChange={(e) => setForm({ ...form, nama_lengkap: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Tanggal Lahir</label>
                <Input type="date" value={form.tanggal_lahir} onChange={(e) => setForm({ ...form, tanggal_lahir: e.target.value })} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Jenis Kelamin</label>
                <Select value={form.jenis_kelamin} onValueChange={(v) => setForm({ ...form, jenis_kelamin: v as 'laki-laki' | 'perempuan' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="laki-laki">Laki-laki</SelectItem>
                    <SelectItem value="perempuan">Perempuan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">No. KK (opsional)</label>
                <Input value={form.no_kk} onChange={(e) => setForm({ ...form, no_kk: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Kontak HP (opsional)</label>
                <Input value={form.kontak_hp} onChange={(e) => setForm({ ...form, kontak_hp: e.target.value })} placeholder="08xxxxxxxxxx" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status Saat Ini</label>
              <Select value={form.status_saat_ini} onValueChange={(v) => setForm({ ...form, status_saat_ini: v as StatusSaatIni })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_SAAT_INI_LABEL) as StatusSaatIni[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {STATUS_SAAT_INI_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Dusun/Kampung</label>
                <Combobox options={dusunOptions} value={form.dusun_id || null} onChange={(v) => void setFormDusun(v)} onAddNew={addNewDusun} placeholder="Pilih dusun" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">RW</label>
                <Combobox
                  options={rwOptions}
                  value={form.rw_id || null}
                  onChange={(v) => void setFormRw(v)}
                  onAddNew={addNewRw}
                  placeholder="Pilih RW"
                  disabled={!form.dusun_id}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">RT</label>
                <Combobox options={rtOptions} value={form.rt_id || null} onChange={setFormRt} onAddNew={addNewRt} placeholder="Pilih RT" disabled={!form.rw_id} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Detail Alamat (opsional)</label>
              <Input value={form.detail_alamat} onChange={(e) => setForm({ ...form, detail_alamat: e.target.value })} placeholder="No. rumah, patokan, dll" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Catatan (opsional)</label>
              <Textarea value={form.catatan} onChange={(e) => setForm({ ...form, catatan: e.target.value })} placeholder="Kerusakan, kebutuhan khusus, dll" />
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogMode(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && !deleting && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus data "{confirmDelete?.nama_lengkap}"?</AlertDialogTitle>
            <AlertDialogDescription>Tindakan ini tidak dapat dibatalkan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void executeDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? 'Menghapus…' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/WargaTerdampak.tsx
git commit -m "feat: add Warga Terdampak page with stats and cascading wilayah combobox"
```

---

## Task 10: Navigation wiring — sidebar, mobile nav, routes

**Files:**
- Modify: `sijagakali-app/src/components/AppSidebar.tsx`
- Modify: `sijagakali-app/src/components/MobileNav.tsx`
- Modify: `sijagakali-app/src/App.tsx`

**Interfaces:**
- Consumes: `KelolaWilayah` (Task 7), `KejadianBanjir` (Task 8), `WargaTerdampak` (Task 9) default exports; `SidebarMenuSub`, `SidebarMenuSubItem`, `SidebarMenuSubButton` from `@/components/ui/sidebar` (already exported, confirmed present); `Collapsible`, `CollapsibleContent`, `CollapsibleTrigger` from `@/components/ui/collapsible` (already in the repo).
- Produces: routes `/banjir/kejadian`, `/banjir/warga`, `/banjir/wilayah`, reachable from the sidebar and (for `/banjir/warga` only) the mobile bottom nav.

- [ ] **Step 1: Add routes to `App.tsx`**

In `sijagakali-app/src/App.tsx`, add imports next to the other page imports:
```typescript
import KejadianBanjir from "./pages/KejadianBanjir";
import WargaTerdampak from "./pages/WargaTerdampak";
import KelolaWilayah from "./pages/KelolaWilayah";
```
And add routes next to the other `<ProtectedRoute>`-wrapped routes (before the `path="*"` catch-all):
```tsx
                  <Route path="/banjir/kejadian" element={<ProtectedRoute><KejadianBanjir /></ProtectedRoute>} />
                  <Route path="/banjir/warga" element={<ProtectedRoute><WargaTerdampak /></ProtectedRoute>} />
                  <Route path="/banjir/wilayah" element={<ProtectedRoute><KelolaWilayah /></ProtectedRoute>} />
```

- [ ] **Step 2: Add a collapsible "Data Bencana" group to `AppSidebar.tsx`**

Replace the flat `items` array approach with a group for the 3 new pages, keeping existing top-level items as-is. Add these imports:
```typescript
import { HeartHandshake, ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
```
Add a `banjirItems` array next to the existing `items` array:
```typescript
const banjirItems = [
  { title: 'Kejadian Banjir', url: '/banjir/kejadian' },
  { title: 'Warga Terdampak', url: '/banjir/warga' },
  { title: 'Kelola Wilayah', url: '/banjir/wilayah' },
];
```
Inside `<SidebarMenu>`, after the `{items.map(...)}` block and before its closing `</SidebarMenu>`, add:
```tsx
              <Collapsible defaultOpen={location.pathname.startsWith('/banjir')}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Data Bencana">
                      <HeartHandshake className="h-4 w-4" />
                      <span>Data Bencana</span>
                      <ChevronDown className="ml-auto h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {banjirItems.map((item) => {
                        const active = location.pathname.startsWith(item.url);
                        return (
                          <SidebarMenuSubItem key={item.title}>
                            <SidebarMenuSubButton asChild isActive={active}>
                              <NavLink to={item.url} className={cn(active && 'font-medium')}>
                                <span>{item.title}</span>
                              </NavLink>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
```

- [ ] **Step 3: Add a single entry to `MobileNav.tsx`**

The bottom mobile nav is a fixed horizontal bar (already 5 items) — add only the primary page (`Warga Terdampak`), not all 3, to avoid overcrowding it. `Kejadian Banjir` and `Kelola Wilayah` stay reachable from the desktop sidebar (and, once on `/banjir/warga`, the empty-state message on that page already links users to create a Kejadian Banjir first).

Add `HeartHandshake` to the `lucide-react` import and one entry to `navItems`:
```typescript
import { LayoutDashboard, Server, Bell, FileText, Users, HeartHandshake } from 'lucide-react';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/devices', label: 'Perangkat', icon: Server },
  { to: '/banjir/warga', label: 'Warga', icon: HeartHandshake },
  { to: '/alerts', label: 'Alert', icon: Bell },
  { to: '/logs', label: 'Logs', icon: FileText },
  { to: '/admin/users', label: 'Admin', icon: Users },
];
```

- [ ] **Step 4: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 5: Manual click-through (this is where the full feature gets exercised end-to-end for the first time)**

Prerequisite: Task 1's migration must already be applied (Task 1 Step 3).

Run: `cd sijagakali-app && npm run dev`, and in the other repo `cd sijagakali-api/api && npm run dev`. Log in as an admin, then:
1. Go to **Data Bencana → Kejadian Banjir**, add a new kejadian (e.g. "Banjir Uji Coba", tanggal mulai hari ini). Confirm it appears in the table.
2. Go to **Data Bencana → Warga Terdampak**. Confirm the new kejadian is selected by default and stat cards show all zeros.
3. Click **Tambah Warga**. Fill the form; in the Dusun combobox type a brand-new name and pick "+ Tambah" — confirm it gets selected automatically and the RW combobox becomes enabled. Repeat for RW and RT. Submit.
4. Confirm the new resident appears in the table with the correct computed age, and stat cards update (Total Warga = 1).
5. Edit the resident, change status to "Mengungsi", save — confirm the stat cards update (Mengungsi = 1).
6. Go to **Data Bencana → Kelola Wilayah**, confirm the Dusun/RW/RT created via the inline combobox appear there too, and edit/delete works.
7. Delete the test resident, then delete the test kejadian banjir — confirm both succeed and the UI reflects the removal.
8. On mobile width (or the mobile nav), confirm the "Warga" bottom-nav icon opens `/banjir/warga` directly.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/AppSidebar.tsx src/components/MobileNav.tsx
git commit -m "feat: wire up navigation for warga terdampak banjir pages"
```

---

## Post-plan: finishing the branch

Once all 10 tasks are complete and Task 10 Step 5's manual walkthrough passes, use **superpowers:finishing-a-development-branch** to decide how to integrate the work (this touches two separate repos — `sijagakali-api` and `sijagakali-app` — so that skill's branch/PR steps need to run once per repo).
