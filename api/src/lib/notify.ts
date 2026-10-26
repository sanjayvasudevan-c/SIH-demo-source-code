import type { Tx } from './db.js';
import { now } from './clock.js';

export interface NotificationMessage {
  applicationId?: string | null;
  kind: string;
  message: string;
}

/** Delivery channel. Only the in-app channel exists in this build (email and SMS are phase 8). */
export interface NotificationChannel {
  send(tx: Tx, userIds: string[], msg: NotificationMessage): Promise<number>;
}

export const inAppChannel: NotificationChannel = {
  async send(tx, userIds, msg) {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return 0;
    const at = now();
    await tx.notification.createMany({
      data: unique.map((userId) => ({
        userId,
        applicationId: msg.applicationId ?? null,
        kind: msg.kind,
        message: msg.message,
        createdAt: at,
      })),
    });
    return unique.length;
  },
};

const channels: NotificationChannel[] = [inAppChannel];

export async function notify(tx: Tx, userIds: string[], msg: NotificationMessage): Promise<number> {
  let sent = 0;
  for (const c of channels) sent = Math.max(sent, await c.send(tx, userIds, msg));
  return sent;
}
