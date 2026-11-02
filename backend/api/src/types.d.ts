import type { Permission, Role } from '@hi/shared';

export type Actor = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  roles: { role: Role; isActive: boolean }[];
  permissions: Permission[];
  companyId: number | null;
  kycVerified: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}
