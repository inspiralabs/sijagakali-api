# Menu "Mock Data" di Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only "Mock Data" page for live presentations: preview/send a test WhatsApp flood notification, run a self-cleaning "live" chart demo on a real device (visible on both admin and public dashboards), and seed/clean sample warga-terdampak data.

**Architecture:** 3 new Fastify endpoints (`api/src/routes/mockData.ts`) drive an in-memory chart-demo session that feeds synthetic readings into the *real* ingestion pipeline (`sijagakali.mqtt_ingestion`) so `data-processing`'s existing `calcWaterStatus()`/`shouldNotify()` logic handles status computation and WhatsApp notification exactly as it would for a real device — no notification logic is duplicated. The frontend adds one admin page with 3 tabs and one small polling banner component shared by the admin and public dashboards.

**Tech Stack:** Fastify 5 + `@supabase/supabase-js` (backend, `sijagakali-api/api`), React + Vite + shadcn/ui (frontend, `sijagakali-app`). No new dependencies in either repo. No new database migrations.

**Spec:** `docs/superpowers/specs/2026-08-23-mock-data-admin-design.md`

## Global Constraints

- No new DB migrations — reuses `mqtt_ingestion`, `sensor_readings`, `wilayah_dusun/rw/rt`, `banjir_events`, `warga_terdampak` as-is.
- Chart demo ramp: `baseline = max(0, threshold_waspada_cm - 10)`, `target = threshold_waspada_cm + 3`, 12 ticks at 5000ms intervals (~1 minute ramp), then **hold flat** (identical value, no jitter) — this is what guarantees exactly one real notification per session, not a hardcoded anti-spam guard.
- Auto-stop after 15 minutes (`900_000` ms) from session start, or earlier via manual stop — same code path either way.
- On stop: `DELETE` demo rows from `sensor_readings` and `mqtt_ingestion` by tracked `correlation_id`. **Never delete `notification_logs`** — a real WhatsApp send during a demo must stay in the audit trail.
- `GET /api/mock-data/chart/status` is intentionally public (no `requireAdmin`) — the public dashboard has no login and needs to know when to show the demo banner. Response contains only `{active, device_id, deployment_slug, started_at}`, nothing sensitive.
- Only one chart-demo session may be active system-wide at a time (in-memory `let activeSession`, not per-admin, not persisted across server restarts — acceptable for a live-presentation feature).
- Wilayah/kejadian seed data uses the exact literal names `[DEMO] Dusun A`, `[DEMO] Dusun B`, `[DEMO] RW 01`, `[DEMO] RT 01`, and event name `Banjir Demo` — cleanup matches on these exact strings (`LIKE '[DEMO]%'` for wilayah, exact match for the event).
- Wilayah cleanup order is RT → RW → Dusun (children first) — the schema's `ON DELETE RESTRICT` FKs mean deleting a Dusun while its RW/RT still exist fails.
- No new npm dependencies in either repo.
- **Known pre-existing baseline TypeScript errors in `sijagakali-app`, unrelated to this feature — do not fix them as part of this plan:** `npx tsc --noEmit -p tsconfig.app.json` reports errors confined to exactly 2 files, `src/lib/sijagakali/fetchDashboard.ts` and `src/lib/supabase.ts` (pre-existing `@supabase/supabase-js` typing fragility). The bar for every task's `tsc --noEmit` step: **zero errors in any file the task creates or modifies**; an error in any other file is a real regression.

---

## Task 1: Backend — Mock Data chart demo routes

**Files:**
- Create: `api/src/routes/mockData.ts`
- Modify: `api/src/app.ts`

**Interfaces:**
- Consumes: `RouteDeps` from `api/src/types/deps.ts` (`supabase`, `requireAdmin`) — unchanged. Reads `device_configs.threshold_waspada_cm` for the chosen device.
- Produces: `registerMockDataRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void>`, registering `POST /api/mock-data/chart/start` (`requireAdmin`), `POST /api/mock-data/chart/stop` (`requireAdmin`), `GET /api/mock-data/chart/status` (public, no auth). Task 3 (frontend Grafik Realtime tab) and Task 4 (frontend `DemoModeBanner`) consume these by exact path and response shape `{ active: boolean; device_id: string | null; deployment_slug: string | null; started_at: string | null }`.

- [ ] **Step 1: Create the route file**

```typescript
// api/src/routes/mockData.ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

const TICK_MS = 5_000;
const RAMP_TICKS = 12;
const AUTO_STOP_MS = 15 * 60_000;

interface ChartDemoSession {
  deploymentSlug: string;
  deviceId: string;
  correlationIds: string[];
  currentLevel: number;
  targetLevel: number;
  step: number;
  startedAt: number;
  tickTimer: NodeJS.Timeout;
  stopTimer: NodeJS.Timeout;
}

let activeSession: ChartDemoSession | null = null;

export async function registerMockDataRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  async function stopSession() {
    const session = activeSession;
    if (!session) return;
    clearInterval(session.tickTimer);
    clearTimeout(session.stopTimer);
    activeSession = null;

    if (session.correlationIds.length > 0) {
      await supabase.from('sensor_readings').delete().in('correlation_id', session.correlationIds);
      await supabase.from('mqtt_ingestion').delete().in('correlation_id', session.correlationIds);
    }
  }

  async function tick() {
    const session = activeSession;
    if (!session) return;
    session.currentLevel = Math.min(session.targetLevel, session.currentLevel + session.step);
    const correlationId = randomUUID();
    session.correlationIds.push(correlationId);
    const { error } = await supabase.from('mqtt_ingestion').insert({
      deployment_slug: session.deploymentSlug,
      device_id: session.deviceId,
      correlation_id: correlationId,
      message_type: 'sensor_data',
      ingest_status: 'parsed_ok',
      payload_json: {
        water_level_cm: session.currentLevel,
        timestamp: new Date().toISOString(),
      },
    });
    if (error) {
      app.log.error({ msg: 'INSERT mqtt_ingestion (mock-data) error', error: error.message });
    }
  }

  app.post<{ Body: { device_id: string; deployment_slug: string } }>(
    '/api/mock-data/chart/start',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (activeSession) {
        return reply.code(409).send({ error: 'Demo sedang berjalan untuk device lain, hentikan dulu.' });
      }

      const deviceId = req.body.device_id;
      const deploymentSlug = req.body.deployment_slug;
      if (!deviceId || !deploymentSlug) {
        return reply.code(400).send({ error: 'device_id dan deployment_slug wajib diisi' });
      }

      const { data: cfg, error } = await supabase
        .from('device_configs')
        .select('threshold_waspada_cm')
        .eq('deployment_slug', deploymentSlug)
        .eq('device_id', deviceId)
        .maybeSingle();

      if (error || !cfg) {
        return reply.code(400).send({ error: 'Device tidak ditemukan' });
      }

      const baseline = Math.max(0, cfg.threshold_waspada_cm - 10);
      const target = cfg.threshold_waspada_cm + 3;

      activeSession = {
        deploymentSlug,
        deviceId,
        correlationIds: [],
        currentLevel: baseline,
        targetLevel: target,
        step: (target - baseline) / RAMP_TICKS,
        startedAt: Date.now(),
        tickTimer: setInterval(() => void tick(), TICK_MS),
        stopTimer: setTimeout(() => void stopSession(), AUTO_STOP_MS),
      };

      return reply.code(201).send({ ok: true });
    },
  );

  app.post('/api/mock-data/chart/stop', { preHandler: requireAdmin }, async (_req, reply) => {
    await stopSession();
    return reply.send({ ok: true });
  });

  app.get('/api/mock-data/chart/status', async (_req, reply) => {
    if (!activeSession) {
      return reply.send({ active: false, device_id: null, deployment_slug: null, started_at: null });
    }
    return reply.send({
      active: true,
      device_id: activeSession.deviceId,
      deployment_slug: activeSession.deploymentSlug,
      started_at: new Date(activeSession.startedAt).toISOString(),
    });
  });
}
```

- [ ] **Step 2: Register the route in `app.ts`**

Add the import next to the other route imports:
```typescript
import { registerMockDataRoutes } from './routes/mockData.js';
```
And register it next to the other `await register*Routes(app, deps);` calls:
```typescript
  await registerMockDataRoutes(app, deps);
```

- [ ] **Step 3: Type-check**

Run: `cd api && npm run build`
Expected: compiles with no errors.

- [ ] **Step 4: Smoke-test route registration and auth gating**

Run: `cd api && npm run dev`, then in another terminal:
```bash
curl -i -X POST http://localhost:3100/api/mock-data/chart/start -H "Content-Type: application/json" -d '{}'
curl -i -X POST http://localhost:3100/api/mock-data/chart/stop
curl -i http://localhost:3100/api/mock-data/chart/status
```
Expected: first two return `401` with `{"error":"Authorization header diperlukan"}` (confirms `requireAdmin` gates start/stop); the third returns `200` with `{"active":false,"device_id":null,"deployment_slug":null,"started_at":null}` (confirms the status endpoint is genuinely public — this is a deliberate design decision, not an oversight, so this check matters).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/mockData.ts api/src/app.ts
git commit -m "feat: add mock-data chart demo endpoints (start/stop/status)"
```

---

## Task 2: Frontend — DemoModeBanner component

**Files:**
- Create: `sijagakali-app/src/components/DemoModeBanner.tsx`

**Interfaces:**
- Consumes: `GET /api/mock-data/chart/status` from Task 1, by exact response shape.
- Produces: default export `DemoModeBanner` component (no props). Task 4 mounts it in both `Dashboard.tsx` and `PublicDashboard.tsx`.

- [ ] **Step 1: Create the component**

```tsx
// sijagakali-app/src/components/DemoModeBanner.tsx
import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_SIJAGAKALIAPI_URL ?? '';
const POLL_MS = 5_000;

export default function DemoModeBanner() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/mock-data/chart/status`);
        if (!res.ok) return;
        const data = (await res.json()) as { active: boolean };
        if (!cancelled) setActive(data.active);
      } catch {
        // abaikan kegagalan poll — banner cukup tidak tampil
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!active) return null;

  return (
    <div className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-xs font-semibold text-amber-700 dark:text-amber-400">
      ⚠️ MODE DEMO AKTIF — data tidak mencerminkan kondisi asli
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DemoModeBanner.tsx
git commit -m "feat: add DemoModeBanner component polling mock-data status"
```

(Not mounted anywhere yet — that happens in Task 4.)

---

## Task 3: Frontend — Mock Data admin page (3 tabs)

**Files:**
- Create: `sijagakali-app/src/pages/MockData.tsx`

**Interfaces:**
- Consumes: `useAuth` from `@/lib/authContext` (`accessToken`), `getSupabase` from `@/lib/supabase`, `getDefaultDeploymentSlug` from `@/lib/sijagakaliEnv`, `WilayahDusun`/`WilayahRw`/`WilayahRt`/`BanjirEvent`/`StatusSaatIni` from `@/lib/banjir/types` (existing, from the warga-terdampak-banjir feature). Calls the existing `POST /api/notification/test` (unchanged, `api/src/routes/notification.ts`), the Task 1 endpoints (`/api/mock-data/chart/*`), and the existing wilayah/banjir/warga endpoints (`/api/wilayah/dusun|rw|rt`, `/api/banjir/events`, `/api/banjir/warga`) from the warga-terdampak-banjir feature.
- Produces: default export `MockData` component. Task 4 registers its route and sidebar entry.

- [ ] **Step 1: Create the page**

```tsx
// sijagakali-app/src/pages/MockData.tsx
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import type { StatusSaatIni, WilayahDusun, WilayahRw, WilayahRt, BanjirEvent } from '@/lib/banjir/types';

const API_BASE = import.meta.env.VITE_SIJAGAKALIAPI_URL ?? '';

type DeviceOption = { device_id: string; location_name: string };
type AuthHeaders = () => Record<string, string>;

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase belum dikonfigurasi');
  return supabase;
}

const WATER_STATUS_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'waspada', label: 'Waspada' },
  { value: 'siaga', label: 'Siaga' },
  { value: 'bahaya', label: 'Bahaya' },
];

function NotifikasiTab({ devices, slug, authHeaders }: { devices: DeviceOption[]; slug: string; authHeaders: AuthHeaders }) {
  const [deviceId, setDeviceId] = useState('');
  const [waterStatus, setWaterStatus] = useState('waspada');
  const [waterLevelCm, setWaterLevelCm] = useState('');
  const [includeCctv, setIncludeCctv] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  const buildBody = (send: boolean) => ({
    device_id: deviceId,
    deployment_slug: slug,
    water_level_cm: Number(waterLevelCm) || 0,
    water_status: waterStatus,
    include_cctv: includeCctv,
    send,
    message_text: messageText.trim() || undefined,
  });

  const handlePreview = async () => {
    if (!deviceId) return toast.error('Pilih device terlebih dahulu');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/notification/test`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(buildBody(false)),
      });
      const json = (await res.json()) as { preview?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Gagal membuat pratinjau');
      setPreview(json.preview ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSendReal = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/notification/test`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(buildBody(true)),
      });
      const json = (await res.json()) as { preview?: string; sent?: boolean; error?: string; gatewayError?: string };
      if (!res.ok) throw new Error(json.error ?? 'Gagal mengirim');
      if (json.sent) {
        toast.success('Notifikasi terkirim ke WhatsApp');
      } else {
        toast.error(json.gatewayError ?? 'Gagal mengirim ke WhatsApp');
      }
      setPreview(json.preview ?? preview);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setConfirmSend(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-4 p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Device</label>
        <Select value={deviceId} onValueChange={setDeviceId}>
          <SelectTrigger>
            <SelectValue placeholder="Pilih device" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.device_id} value={d.device_id}>
                {d.location_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
          <Select value={waterStatus} onValueChange={setWaterStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WATER_STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Level Air (cm)</label>
          <Input type="number" value={waterLevelCm} onChange={(e) => setWaterLevelCm(e.target.value)} placeholder="120" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={includeCctv} onChange={(e) => setIncludeCctv(e.target.checked)} />
        Sertakan foto CCTV terakhir
      </label>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Teks Pesan (opsional)</label>
        <Textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} placeholder="Kosongkan untuk pakai template default" />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={loading} onClick={() => void handlePreview()}>
          Pratinjau
        </Button>
        <Button type="button" variant="destructive" disabled={loading || !deviceId} onClick={() => setConfirmSend(true)}>
          Kirim ke WhatsApp (Asli)
        </Button>
      </div>
      {preview && <Card className="whitespace-pre-wrap bg-muted/50 p-3 text-sm">{preview}</Card>}

      <AlertDialog open={confirmSend} onOpenChange={(o) => !o && setConfirmSend(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kirim pesan asli?</AlertDialogTitle>
            <AlertDialogDescription>
              Ini akan mengirim pesan asli ke channel WhatsApp produksi. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSendReal();
              }}
              disabled={loading}
            >
              {loading ? 'Mengirim…' : 'Kirim'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type ChartStatus = { active: boolean; device_id: string | null; deployment_slug: string | null; started_at: string | null };

const AUTO_STOP_MIN = 15;
const STATUS_POLL_MS = 5_000;

function GrafikTab({ devices, slug, authHeaders }: { devices: DeviceOption[]; slug: string; authHeaders: AuthHeaders }) {
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState<ChartStatus>({ active: false, device_id: null, deployment_slug: null, started_at: null });
  const [loading, setLoading] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mock-data/chart/status`);
      if (!res.ok) return;
      setStatus((await res.json()) as ChartStatus);
    } catch {
      // abaikan — status tetap seperti sebelumnya
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const remainingMinutes = status.started_at
    ? Math.max(0, Math.ceil(AUTO_STOP_MIN - (Date.now() - new Date(status.started_at).getTime()) / 60_000))
    : 0;

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/mock-data/chart/start`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ device_id: deviceId, deployment_slug: slug }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Gagal memulai demo');
      toast.success('Demo grafik dimulai');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setConfirmStart(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/mock-data/chart/stop`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error('Gagal menghentikan demo');
      toast.success('Demo grafik dihentikan');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-4 p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Device</label>
        <Select value={deviceId} onValueChange={setDeviceId} disabled={status.active}>
          <SelectTrigger>
            <SelectValue placeholder="Pilih device" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.device_id} value={d.device_id}>
                {d.location_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">
        Status:{' '}
        {status.active ? (
          <span className="font-medium text-amber-600">Aktif — sisa ~{remainingMinutes} menit</span>
        ) : (
          <span className="font-medium">Tidak aktif</span>
        )}
      </p>
      <div className="flex gap-2">
        <Button type="button" disabled={loading || status.active || !deviceId} onClick={() => setConfirmStart(true)}>
          Mulai
        </Button>
        <Button type="button" variant="outline" disabled={loading || !status.active} onClick={() => void handleStop()}>
          Hentikan
        </Button>
      </div>

      <AlertDialog open={confirmStart} onOpenChange={(o) => !o && setConfirmStart(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mulai demo grafik?</AlertDialogTitle>
            <AlertDialogDescription>
              Ini akan menampilkan status air palsu di dashboard PUBLIK untuk pos ini selama maks. 15 menit, dan akan
              mengirim notifikasi WhatsApp ASLI ke channel produksi kalau levelnya melewati ambang waspada. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleStart();
              }}
              disabled={loading}
            >
              {loading ? 'Memulai…' : 'Mulai'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const DEMO_DUSUN_NAMES = ['[DEMO] Dusun A', '[DEMO] Dusun B'];
const DEMO_EVENT_NAME = 'Banjir Demo';

type DemoWarga = {
  nik: string;
  nama_lengkap: string;
  tanggal_lahir: string;
  jenis_kelamin: 'laki-laki' | 'perempuan';
  status_saat_ini: StatusSaatIni;
  dusunIndex: 0 | 1;
};

const DEMO_WARGA: DemoWarga[] = [
  { nik: '3200000000000001', nama_lengkap: 'Budi Santoso', tanggal_lahir: '1985-03-20', jenis_kelamin: 'laki-laki', status_saat_ini: 'mengungsi', dusunIndex: 0 },
  { nik: '3200000000000002', nama_lengkap: 'Siti Aminah', tanggal_lahir: '1990-07-12', jenis_kelamin: 'perempuan', status_saat_ini: 'di_rumah', dusunIndex: 0 },
  { nik: '3200000000000003', nama_lengkap: 'Ahmad Fauzi', tanggal_lahir: '1978-11-05', jenis_kelamin: 'laki-laki', status_saat_ini: 'mengungsi', dusunIndex: 0 },
  { nik: '3200000000000004', nama_lengkap: 'Dewi Lestari', tanggal_lahir: '2001-01-30', jenis_kelamin: 'perempuan', status_saat_ini: 'di_rumah', dusunIndex: 1 },
  { nik: '3200000000000005', nama_lengkap: 'Eko Prasetyo', tanggal_lahir: '1995-09-18', jenis_kelamin: 'laki-laki', status_saat_ini: 'mengungsi', dusunIndex: 1 },
  { nik: '3200000000000006', nama_lengkap: 'Fitriani', tanggal_lahir: '1988-04-25', jenis_kelamin: 'perempuan', status_saat_ini: 'di_rumah', dusunIndex: 1 },
];

function WargaSeedTab({ slug, authHeaders }: { slug: string; authHeaders: AuthHeaders }) {
  const [seeding, setSeeding] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const ensureDusun = async (nama: string): Promise<WilayahDusun> => {
    const supabase = requireSupabase();
    const { data: existing } = await supabase
      .from('wilayah_dusun')
      .select('id, deployment_slug, nama')
      .eq('deployment_slug', slug)
      .eq('nama', nama)
      .maybeSingle();
    if (existing) return existing as WilayahDusun;
    const res = await fetch(`${API_BASE}/api/wilayah/dusun`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ deployment_slug: slug, nama }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `Gagal membuat dusun ${nama}`);
    const { dusun } = (await res.json()) as { dusun: WilayahDusun };
    return dusun;
  };

  const ensureRw = async (dusunId: string, nama: string): Promise<WilayahRw> => {
    const supabase = requireSupabase();
    const { data: existing } = await supabase
      .from('wilayah_rw')
      .select('id, dusun_id, nama')
      .eq('dusun_id', dusunId)
      .eq('nama', nama)
      .maybeSingle();
    if (existing) return existing as WilayahRw;
    const res = await fetch(`${API_BASE}/api/wilayah/rw`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ dusun_id: dusunId, nama }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `Gagal membuat RW ${nama}`);
    const { rw } = (await res.json()) as { rw: WilayahRw };
    return rw;
  };

  const ensureRt = async (rwId: string, nama: string): Promise<WilayahRt> => {
    const supabase = requireSupabase();
    const { data: existing } = await supabase
      .from('wilayah_rt')
      .select('id, rw_id, nama')
      .eq('rw_id', rwId)
      .eq('nama', nama)
      .maybeSingle();
    if (existing) return existing as WilayahRt;
    const res = await fetch(`${API_BASE}/api/wilayah/rt`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ rw_id: rwId, nama }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `Gagal membuat RT ${nama}`);
    const { rt } = (await res.json()) as { rt: WilayahRt };
    return rt;
  };

  const ensureBanjirEvent = async (): Promise<BanjirEvent> => {
    const supabase = requireSupabase();
    const { data: existing } = await supabase
      .from('banjir_events')
      .select('id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan')
      .eq('deployment_slug', slug)
      .eq('nama', DEMO_EVENT_NAME)
      .maybeSingle();
    if (existing) return existing as BanjirEvent;
    const res = await fetch(`${API_BASE}/api/banjir/events`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        deployment_slug: slug,
        nama: DEMO_EVENT_NAME,
        tanggal_mulai: new Date().toISOString().slice(0, 10),
        keterangan: 'Data contoh untuk presentasi/demo',
      }),
    });
    if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? 'Gagal membuat kejadian demo');
    const { event } = (await res.json()) as { event: BanjirEvent };
    return event;
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const dusuns = await Promise.all(DEMO_DUSUN_NAMES.map((nama) => ensureDusun(nama)));
      const rws = await Promise.all(dusuns.map((d) => ensureRw(d.id, '[DEMO] RW 01')));
      const rts = await Promise.all(rws.map((rw) => ensureRt(rw.id, '[DEMO] RT 01')));
      const event = await ensureBanjirEvent();

      const supabase = requireSupabase();
      const { count } = await supabase
        .from('warga_terdampak')
        .select('id', { count: 'exact', head: true })
        .eq('banjir_event_id', event.id);

      if (!count) {
        for (const w of DEMO_WARGA) {
          const res = await fetch(`${API_BASE}/api/banjir/warga`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              banjir_event_id: event.id,
              deployment_slug: slug,
              nik: w.nik,
              nama_lengkap: w.nama_lengkap,
              tanggal_lahir: w.tanggal_lahir,
              jenis_kelamin: w.jenis_kelamin,
              status_saat_ini: w.status_saat_ini,
              dusun_id: dusuns[w.dusunIndex].id,
              rw_id: rws[w.dusunIndex].id,
              rt_id: rts[w.dusunIndex].id,
            }),
          });
          if (!res.ok) {
            throw new Error(((await res.json()) as { error?: string }).error ?? `Gagal menambah warga ${w.nama_lengkap}`);
          }
        }
      }
      toast.success('Data contoh warga terdampak siap');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const supabase = requireSupabase();
      const { data: event } = await supabase
        .from('banjir_events')
        .select('id')
        .eq('deployment_slug', slug)
        .eq('nama', DEMO_EVENT_NAME)
        .maybeSingle();
      if (event) {
        const res = await fetch(`${API_BASE}/api/banjir/events/${event.id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) toast.error(((await res.json()) as { error?: string }).error ?? 'Gagal menghapus kejadian demo');
      }

      const { data: rts } = await supabase.from('wilayah_rt').select('id, rw_id, nama').like('nama', '[DEMO]%');
      for (const rt of rts ?? []) {
        const res = await fetch(`${API_BASE}/api/wilayah/rt/${rt.id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) toast.error(((await res.json()) as { error?: string }).error ?? `Gagal menghapus RT ${rt.nama}`);
      }
      const { data: rws } = await supabase.from('wilayah_rw').select('id, dusun_id, nama').like('nama', '[DEMO]%');
      for (const rw of rws ?? []) {
        const res = await fetch(`${API_BASE}/api/wilayah/rw/${rw.id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) toast.error(((await res.json()) as { error?: string }).error ?? `Gagal menghapus RW ${rw.nama}`);
      }
      const { data: dusuns } = await supabase
        .from('wilayah_dusun')
        .select('id, deployment_slug, nama')
        .eq('deployment_slug', slug)
        .like('nama', '[DEMO]%');
      for (const d of dusuns ?? []) {
        const res = await fetch(`${API_BASE}/api/wilayah/dusun/${d.id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) toast.error(((await res.json()) as { error?: string }).error ?? `Gagal menghapus dusun ${d.nama}`);
      }
      toast.success('Pembersihan data contoh selesai');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCleaning(false);
    }
  };

  return (
    <Card className="max-w-xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Membuat 2 dusun, kejadian "{DEMO_EVENT_NAME}", dan 6 warga contoh berlabel <span className="font-mono">[DEMO]</span>.
        Aman diklik berkali-kali.
      </p>
      <div className="flex gap-2">
        <Button type="button" disabled={seeding} onClick={() => void handleSeed()}>
          {seeding ? 'Mengisi…' : 'Isi Data Contoh'}
        </Button>
        <Button type="button" variant="outline" disabled={cleaning} onClick={() => void handleCleanup()}>
          {cleaning ? 'Menghapus…' : 'Hapus Data Contoh'}
        </Button>
      </div>
    </Card>
  );
}

export default function MockData() {
  const { accessToken } = useAuth();
  const slug = getDefaultDeploymentSlug();
  const [devices, setDevices] = useState<DeviceOption[]>([]);

  const authHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` }),
    [accessToken],
  );

  useEffect(() => {
    const fetchDevices = async () => {
      const supabase = getSupabase();
      if (!supabase) return;
      const { data, error } = await supabase
        .from('device_configs')
        .select('device_id, location_name')
        .eq('deployment_slug', slug)
        .eq('is_active', true)
        .order('location_name');
      if (error) return toast.error('Gagal memuat daftar perangkat', { description: error.message });
      setDevices((data ?? []) as DeviceOption[]);
    };
    void fetchDevices();
  }, [slug]);

  return (
    <AppLayout>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">Mock Data</h1>
        <p className="text-sm text-muted-foreground">
          Data contoh untuk presentasi/demo — notifikasi, grafik realtime, dan warga terdampak.
        </p>
      </div>
      <Tabs defaultValue="notifikasi">
        <TabsList>
          <TabsTrigger value="notifikasi">Notifikasi</TabsTrigger>
          <TabsTrigger value="grafik">Grafik Realtime</TabsTrigger>
          <TabsTrigger value="warga">Warga Terdampak</TabsTrigger>
        </TabsList>
        <TabsContent value="notifikasi" className="space-y-4">
          <NotifikasiTab devices={devices} slug={slug} authHeaders={authHeaders} />
        </TabsContent>
        <TabsContent value="grafik" className="space-y-4">
          <GrafikTab devices={devices} slug={slug} authHeaders={authHeaders} />
        </TabsContent>
        <TabsContent value="warga" className="space-y-4">
          <WargaSeedTab slug={slug} authHeaders={authHeaders} />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors (baseline exceptions from Global Constraints excluded).

- [ ] **Step 3: Commit**

```bash
git add src/pages/MockData.tsx
git commit -m "feat: add Mock Data admin page (notification, chart demo, warga seed tabs)"
```

(Not reachable yet — routing happens in Task 4.)

---

## Task 4: Navigation wiring — sidebar, routes, and demo banner mounting

**Files:**
- Modify: `sijagakali-app/src/App.tsx`
- Modify: `sijagakali-app/src/components/AppSidebar.tsx`
- Modify: `sijagakali-app/src/pages/Dashboard.tsx`
- Modify: `sijagakali-app/src/pages/PublicDashboard.tsx`

**Interfaces:**
- Consumes: `MockData` default export (Task 3), `DemoModeBanner` default export (Task 2).
- Produces: route `/admin/mock-data` reachable from the sidebar; `DemoModeBanner` visible on both `/dashboard` and `/public` whenever a chart demo is active.

- [ ] **Step 1: Add the route to `App.tsx`**

Add the import next to the other page imports:
```typescript
import MockData from "./pages/MockData";
```
Add the route next to `/admin/users`:
```tsx
                  <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
                  <Route path="/admin/mock-data" element={<ProtectedRoute><MockData /></ProtectedRoute>} />
```

- [ ] **Step 2: Add a sidebar entry in `AppSidebar.tsx`**

Add `FlaskConical` to the `lucide-react` import:
```typescript
import { LayoutDashboard, Server, Bell, FileText, LogOut, Users, HeartHandshake, ChevronDown, FlaskConical } from 'lucide-react';
```
Add one entry to the `items` array:
```typescript
const items = [
  { title: 'Dashboard', url: '/dashboard', icon: LayoutDashboard },
  { title: 'Perangkat', url: '/devices', icon: Server },
  { title: 'Peringatan', url: '/alerts', icon: Bell },
  { title: 'Logs', url: '/logs', icon: FileText },
  { title: 'Manajemen Admin', url: '/admin/users', icon: Users },
  { title: 'Mock Data', url: '/admin/mock-data', icon: FlaskConical },
];
```

- [ ] **Step 3: Mount the banner in `Dashboard.tsx`**

Add the import:
```typescript
import DemoModeBanner from '@/components/DemoModeBanner';
```
Mount it as the first child inside `<AppLayout>`:
```tsx
    <AppLayout>
      <DemoModeBanner />
      <div className="flex w-full flex-col gap-8 pb-2">
```

- [ ] **Step 4: Mount the banner in `PublicDashboard.tsx`**

Add the import:
```typescript
import DemoModeBanner from '@/components/DemoModeBanner';
```
Mount it right before the `<header>`, after the existing `supabaseError` block:
```tsx
      <DangerAlarm devices={devices} />
      {supabaseError && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
          Koneksi data: {supabaseError}
        </div>
      )}
      <DemoModeBanner />

      <header className="sticky top-0 z-40 border-b border-border/80 bg-card/90 px-4 py-3 shadow-sm backdrop-blur-md sm:px-6">
```

- [ ] **Step 5: Type-check**

Run: `cd sijagakali-app && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors (baseline exceptions from Global Constraints excluded).

- [ ] **Step 6: Manual click-through (full feature exercised end-to-end)**

Prerequisite: `data-processing` and `notification-gateway` must be running (`npm run dev` at the `sijagakali-api` root starts all services together) for the chart demo to actually reach `sensor_readings` and WhatsApp.

Run: `cd sijagakali-app && npm run dev`, and `cd sijagakali-api && npm run dev`. Log in as admin, then:
1. Go to **Mock Data → Notifikasi**. Pick a device, click **Pratinjau** — confirm the formatted WA text appears in the card below. Do *not* click "Kirim ke WhatsApp (Asli)" unless you intend to actually send a real message.
2. Go to **Warga Terdampak** tab, click **Isi Data Contoh** — confirm success toast. Go to `/banjir/wilayah` and `/banjir/warga`, confirm the `[DEMO]` wilayah and "Banjir Demo" event with 6 warga rows appear. Click **Isi Data Contoh** again — confirm no duplicates are created (idempotent).
3. Click **Hapus Data Contoh** — confirm the demo event, warga rows (via cascade), and `[DEMO]` wilayah rows are gone from `/banjir/warga` and `/banjir/wilayah`.
4. Go to **Grafik Realtime** tab, pick a device, click **Mulai** — confirm the dialog warns about the public dashboard and real WhatsApp send, confirm it. Confirm status changes to "Aktif — sisa ~15 menit".
5. Open `/public` (or `/dashboard`) in another tab — confirm the **"⚠️ MODE DEMO AKTIF"** banner appears, and the chosen device's water level chart visibly climbs over about a minute then holds steady.
6. If the device's `threshold_waspada_cm` is crossed, confirm exactly one WhatsApp message arrives on the configured channel (check `notification_logs` via Supabase or the channel itself) — not a stream of repeated messages.
7. Click **Hentikan** in the Mock Data page — confirm status returns to "Tidak aktif", the banner disappears from `/public`, and the device's chart history no longer shows the demo spike (confirms cleanup of `sensor_readings`/`mqtt_ingestion` worked).

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/AppSidebar.tsx src/pages/Dashboard.tsx src/pages/PublicDashboard.tsx
git commit -m "feat: wire up navigation and demo banner for Mock Data admin page"
```

---

## Post-plan: finishing the branch

Once both tasks in `sijagakali-api` and all three tasks in `sijagakali-app` are complete and Task 4 Step 6's manual walkthrough passes, use **superpowers:finishing-a-development-branch** to decide how to integrate the work — this touches two separate repos, so run that skill once per repo.
