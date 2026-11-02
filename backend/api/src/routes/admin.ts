import type { FastifyInstance } from 'fastify';
import { query, withTransaction } from '@hi/db';
import {
  createAdminSchema,
  hashPassword,
  permissionUpdateSchema,
  settingSchema,
} from '@hi/shared';
import { audit, requirePermission } from '../auth';
import { fail } from '../lib/errors';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/users', { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    requirePermission(actor, 'users.create_admin');
    const body = createAdminSchema.parse(request.body);

    const id = await withTransaction(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO users (first_name, last_name, email, password_hash)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.firstName, body.lastName, body.email, hashPassword(body.password)],
      );
      const userId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO user_roles (user_id, role, assigned_by) VALUES ($1, 'admin', $2)`,
        [userId, actor.id],
      );
      for (const permission of body.permissions) {
        await client.query(
          `INSERT INTO user_permissions (user_id, permission_key, granted_by, effect)
           VALUES ($1, $2, $3, 'allow')`,
          [userId, permission, actor.id],
        );
      }
      await audit(client, actor.id, 'admin.create', 'user', userId, {
        permissions: body.permissions,
      });
      return userId;
    });

    return reply.code(201).send({ id });
  });

  app.get('/admin/users', { preHandler: app.authenticate }, async (request) => {
    requirePermission(request.actor!, 'users.list');
    return query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status, u.created_at,
              COALESCE(json_agg(DISTINCT ur.role) FILTER (WHERE ur.role IS NOT NULL), '[]') AS roles,
              EXISTS (SELECT 1 FROM identity_verifications v
                      WHERE v.user_id = u.id AND v.status = 'verified') AS kyc_verified,
              (SELECT cm.company_id FROM company_members cm
               WHERE cm.user_id = u.id LIMIT 1) AS company_id,
              (SELECT c.company_name FROM company_members cm
               JOIN companies c ON c.id = cm.company_id
               WHERE cm.user_id = u.id LIMIT 1) AS company_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
    );
  });

  app.patch(
    '/admin/users/:id/permissions',
    { preHandler: app.authenticate },
    async (request) => {
      const actor = request.actor!;
      requirePermission(actor, 'permissions.manage');
      const userId = (request.params as { id: string }).id;
      const body = permissionUpdateSchema.parse(request.body);

      await withTransaction(async (client) => {
        for (const grant of body.grants) {
          await client.query(
            `INSERT INTO user_permissions (user_id, permission_key, granted_by, effect)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, permission_key)
             DO UPDATE SET effect = EXCLUDED.effect, granted_by = EXCLUDED.granted_by`,
            [userId, grant.permissionKey, actor.id, grant.effect],
          );
        }
        await audit(client, actor.id, 'permissions.update', 'user', userId, {
          grants: body.grants,
        });
      });
      return { ok: true };
    },
  );

  app.get('/admin/audit', { preHandler: app.authenticate }, async (request) => {
    requirePermission(request.actor!, 'audit.view');
    return query(
      `SELECT al.id, al.action, al.entity_type, al.entity_id, al.details, al.created_at,
              u.first_name, u.last_name, u.email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_id
       ORDER BY al.created_at DESC
       LIMIT 200`,
    );
  });

  app.get('/settings', { preHandler: app.authenticate }, async (request) => {
    requirePermission(request.actor!, 'applications.view');
    const rows = await query<{ key: string; value: unknown }>(
      'SELECT key, value FROM platform_settings ORDER BY key',
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  app.put('/settings/:key', { preHandler: app.authenticate }, async (request) => {
    const actor = request.actor!;
    requirePermission(actor, 'settings.manage');
    const key = (request.params as { key: string }).key;
    if (!/^[a-z_]{2,100}$/.test(key)) return fail(400, 'Invalid setting key');
    const body = settingSchema.parse(request.body);

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO platform_settings (key, value, updated_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [key, JSON.stringify(body.value), actor.id],
      );
      await audit(client, actor.id, 'settings.update', 'platform_setting', key, {
        value: body.value,
      });
    });
    return { key, value: body.value };
  });

  app.get('/meta', { preHandler: app.authenticate }, async () => {
    const [jobRoles, skills] = await Promise.all([
      query('SELECT id, title FROM job_roles WHERE status = true ORDER BY title'),
      query('SELECT id, skill_name FROM skills ORDER BY skill_name'),
    ]);
    return { jobRoles, skills };
  });
}
