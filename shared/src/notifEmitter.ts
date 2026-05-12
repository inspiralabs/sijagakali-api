import { EventEmitter } from 'node:events';

/** Satu bus in-proses: data-processing emit, notification-gateway subscribe. */
export const notifEmitter = new EventEmitter();
