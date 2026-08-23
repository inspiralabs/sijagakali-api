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
