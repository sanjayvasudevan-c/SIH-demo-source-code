import { Prisma, PrismaClient } from '@prisma/client';

/** Connection dropped under us (for example a demo reset recreated the database). */
function isConnectionLost(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return ['P1001', 'P1017'].includes(err?.code ?? '') || /terminating connection|server has closed the connection|connection (is )?closed/i.test(err?.message ?? '');
}

function makeClient(): PrismaClient {
  const base = new PrismaClient({ log: process.env.NODE_ENV === 'test' ? [] : ['warn'] });
  // Retry a single model operation once when its pooled connection was terminated; the pool reconnects.
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args);
          } catch (e) {
            if (!isConnectionLost(e)) throw e;
            return query(args);
          }
        },
      },
    },
  }) as unknown as PrismaClient;
}

// Live binding: reconnect() swaps the client after a demo reset recreates the database.
export let prisma: PrismaClient = makeClient();

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export async function reconnect(): Promise<void> {
  const old = prisma;
  prisma = makeClient();
  await old.$disconnect().catch(() => undefined);
}

export const TX_OPTIONS = { maxWait: 15_000, timeout: 30_000 } as const;
