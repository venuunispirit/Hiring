import type pg from 'pg';
import { query } from '@hi/db';
import type { Permission, Role } from '@hi/shared';
import type { Actor } from './types';

type UserRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
};

export async function loadActor(userId: string): Promise<Actor | null> {
  const user = await query<UserRow>(
    'SELECT id, email, first_name, last_name, status FROM users WHERE id = $1',
    [userId],
  );
  const row = user[0];
  if (!row) return null;

  const roles = await query<{ role: Role; is_active: boolean }>(
    'SELECT role, is_active FROM user_roles WHERE user_id = $1 ORDER BY role',
    [userId],
  );

  const effective = await query<{ permission_key: Permission }>(
    `SELECT DISTINCT permission_key FROM (
       SELECT rp.permission_key
       FROM role_permissions rp
       JOIN user_roles ur ON ur.role = rp.role
       WHERE ur.user_id = $1 AND ur.is_active
       UNION
       SELECT up.permission_key
       FROM user_permissions up
       WHERE up.user_id = $1 AND up.effect = 'allow'
     ) allowed
     WHERE permission_key NOT IN (
       SELECT permission_key FROM user_permissions
       WHERE user_id = $1 AND effect = 'deny'
     )`,
    [userId],
  );

  const membership = await query<{ company_id: number }>(
    'SELECT company_id FROM company_members WHERE user_id = $1 ORDER BY company_id LIMIT 1',
    [userId],
  );

  const kyc = await query<{ id: number }>(
    `SELECT id FROM identity_verifications
     WHERE user_id = $1 AND status = 'verified' ORDER BY id DESC LIMIT 1`,
    [userId],
  );

  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
    roles: roles.map((r) => ({ role: r.role, isActive: r.is_active })),
    permissions: effective.map((p) => p.permission_key),
    companyId: membership[0]?.company_id ?? null,
    kycVerified: kyc.length > 0,
  };
}

export function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.some((r) => r.role === role && r.isActive);
}

export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.some((role) => hasRole(actor, role))) {
    throw Object.assign(new Error(`Requires role: ${roles.join(' or ')}`), { statusCode: 403 });
  }
}

export function can(actor: Actor, permission: Permission): boolean {
  return actor.permissions.includes(permission);
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) {
    throw Object.assign(new Error(`Missing permission: ${permission}`), { statusCode: 403 });
  }
}

export function requireKyc(actor: Actor): void {
  if (!actor.kycVerified) {
    throw Object.assign(new Error('Identity verification required before this action'), {
      statusCode: 403,
    });
  }
}

export async function audit(
  db: Pick<pg.PoolClient, 'query'>,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, action, entityType, entityId === null ? null : String(entityId), JSON.stringify(details)],
  );
}

export async function notify(
  db: Pick<pg.PoolClient, 'query'>,
  userId: string,
  message: string,
  type: string,
): Promise<void> {
  await db.query(
    'INSERT INTO notifications (user_id, message, notification_type) VALUES ($1, $2, $3)',
    [userId, message, type],
  );
}

export async function enqueue(
  db: Pick<pg.PoolClient, 'query'>,
  type: string,
  payload: Record<string, unknown>,
  runAt?: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO jobs (type, payload, run_at) VALUES ($1, $2, COALESCE($3, now()))`,
    [type, JSON.stringify(payload), runAt ?? null],
  );
}
