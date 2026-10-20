import mqtt, { type MqttClient } from 'mqtt';
import { ENV } from './env.js';

/**
 * Buat koneksi MQTT baru. Setiap service membuat koneksinya sendiri
 * dengan clientId unik agar tidak bentrok di broker.
 *
 * persistentSession: clientId tetap + clean=false — broker menyimpan langganan dan pesan QoS 1
 * selama client terputus/restart. Hanya untuk satu instance per serviceId (instance kedua
 * dengan clientId sama menendang yang pertama).
 */
export function createMqttClient(
  serviceId: string,
  { persistentSession = false }: { persistentSession?: boolean } = {}
): MqttClient {
  const clientId = persistentSession
    ? `${ENV.MQTT_CLIENT_ID_PREFIX}-${serviceId}`
    : `${ENV.MQTT_CLIENT_ID_PREFIX}-${serviceId}-${Date.now()}`;

  const opts: mqtt.IClientOptions = {
    clientId,
    clean: !persistentSession,
    reconnectPeriod: 3000,
    connectTimeout: 10_000,
  };

  if (ENV.MQTT_USERNAME) {
    opts.username = ENV.MQTT_USERNAME;
    opts.password = ENV.MQTT_PASSWORD;
  }

  const client = mqtt.connect(ENV.MQTT_BROKER_URL, opts);

  client.on('connect', () => {
    console.log(`[mqtt/${serviceId}] Connected to ${ENV.MQTT_BROKER_URL}`);
  });

  client.on('error', (err) => {
    console.error(`[mqtt/${serviceId}] Error:`, err.message);
  });

  client.on('offline', () => {
    console.warn(`[mqtt/${serviceId}] Broker offline — reconnecting...`);
  });

  return client;
}
