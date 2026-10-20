import { PrismaPg } from '@prisma/adapter-pg';
/** Prisma 6 JS engine can omit adapter cleanup when PostgreSQL rejects COMMIT.
 * Release the rolled-back connection exactly once so retries cannot exhaust the pool.
 * PostgreSQL has already rolled back a transaction whose COMMIT returns 40001.
 */
export class SafePrismaPg extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const start = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = async (level) => {
      const tx = await start(level);
      const commit = tx.commit.bind(tx),
        rollback = tx.rollback.bind(tx);
      let released = false;
      tx.commit = async () => {
        if (!released) {
          released = true;
          await commit();
        }
      };
      tx.rollback = async () => {
        if (!released) {
          released = true;
          await rollback();
        }
      };
      const execute = tx.executeRaw.bind(tx);
      tx.executeRaw = async (query) => {
        try {
          return await execute(query);
        } catch (e) {
          if (query.sql.trim().toUpperCase() === 'COMMIT') await tx.rollback();
          throw e;
        }
      };
      return tx;
    };
    return adapter;
  }
}
