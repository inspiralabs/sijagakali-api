import mqtt, { type MqttClient } from 'mqtt';
import { ENV } from './env.js';

/**
 * Buat koneksi MQTT baru. Setiap service membuat koneksinya sendiri
 * dengan clientId unik agar tidak bentrok di broker.
 */
export function createMqttClient(serviceId: string): MqttClient {
  const clientId = `${ENV.MQTT_CLIENT_ID_PREFIX}-${serviceId}-${Date.now()}`;

  const opts: mqtt.IClientOptions = {
    clientId,
    clean: true,
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
