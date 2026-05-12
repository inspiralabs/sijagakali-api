import Fastify from 'fastify';
import { getSupabaseStorage, getSupabase, ENV } from '@sijagaair/shared';
import { registerCors } from './plugins/corsPlugin.js';
import { createRequireAdmin } from './hooks/requireAdmin.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerCctvRoutes } from './routes/cctv.js';
import { registerDeviceRoutes } from './routes/device.js';
import { registerNotificationRoutes } from './routes/notification.js';
import { registerDeploymentRoutes } from './routes/deployment.js';
import { registerAdminRoutes } from './routes/admins.js';
import type { RouteDeps } from './types/deps.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  const supabaseStorage = getSupabaseStorage();
  const supabase = getSupabase();
  const bucket = ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES;
  const requireAdmin = createRequireAdmin(supabase);

  const deps: RouteDeps = {
    supabase,
    supabaseStorage,
    bucket,
    requireAdmin,
  };

  await registerCors(app, ENV);

  await registerHealthRoutes(app);
  await registerCctvRoutes(app, deps);
  await registerDeviceRoutes(app, deps);
  await registerNotificationRoutes(app, deps);
  await registerDeploymentRoutes(app, deps);
  await registerAdminRoutes(app, deps);

  return app;
}
