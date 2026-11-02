import type { FastifyInstance } from 'fastify';
import { query } from '@hi/db';
import { requirePermission } from '../auth';

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/notifications', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requirePermission(actor, 'notifications.view');
    return query(
      `SELECT id, message, notification_type, is_read, created_at
       FROM notifications WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 100`,
      [actor.id],
    );
  });

  app.post('/notifications/:id/read', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    const id = Number((request.params as { id: string }).id);
    await query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [id, actor.id],
    );
    return { ok: true };
  });

  app.post('/notifications/read-all', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    await query('UPDATE notifications SET is_read = true WHERE user_id = $1', [actor.id]);
    return { ok: true };
  });
}
