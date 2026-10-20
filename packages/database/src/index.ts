import { PrismaClient, Prisma } from '@prisma/client';
import { SafePrismaPg } from './pg-adapter';
import type { DataPort, Entities, Table, Where } from '@tuheng/domain';
const globalDb = globalThis as unknown as { tuhengDb?: PrismaClient };
export const prisma =
  globalDb.tuhengDb ??
  new PrismaClient({ adapter: new SafePrismaPg({ connectionString: process.env.DATABASE_URL! }) });
if (process.env.NODE_ENV !== 'production') globalDb.tuhengDb = prisma;
interface Delegate {
  findUnique(a: unknown): Promise<unknown>;
  findMany(a: unknown): Promise<unknown[]>;
  create(a: unknown): Promise<unknown>;
  update(a: unknown): Promise<unknown>;
}
class PrismaDataPort implements DataPort {
  constructor(
    private client: PrismaClient | Prisma.TransactionClient = prisma,
    private nested = false,
  ) {}
  private table(name: Table) {
    return (this.client as unknown as Record<Table, Delegate>)[name];
  }
  async get<K extends Table>(name: K, id: string) {
    return (await this.table(name).findUnique({ where: { id } })) as Entities[K] | null;
  }
  async list<K extends Table>(
    name: K,
    where: Where<Entities[K]> = {},
    options: { take?: number; orderBy?: keyof Entities[K]; desc?: boolean } = {},
  ) {
    return (await this.table(name).findMany({
      where,
      take: options.take ?? 10000,
      ...(options.orderBy ? { orderBy: { [options.orderBy]: options.desc ? 'desc' : 'asc' } } : {}),
    })) as Entities[K][];
  }
  async create<K extends Table>(name: K, data: Partial<Entities[K]>) {
    return (await this.table(name).create({ data })) as Entities[K];
  }
  async update<K extends Table>(name: K, id: string, data: Partial<Entities[K]>) {
    return (await this.table(name).update({ where: { id }, data })) as Entities[K];
  }
  async transaction<T>(work: (tx: DataPort) => Promise<T>): Promise<T> {
    if (this.nested) return work(this);
    for (let i = 0; i < 8; i++) {
      try {
        return await prisma.$transaction((tx) => work(new PrismaDataPort(tx, true)), {
          isolationLevel: 'Serializable',
          timeout: 15000,
        });
      } catch (e) {
        if (
          ((e instanceof Prisma.PrismaClientKnownRequestError &&
            ['P2034', 'P2002'].includes(e.code)) ||
            (e instanceof Error &&
              e.name === 'DriverAdapterError' &&
              (e as Error & { cause?: { kind?: string } }).cause?.kind ===
                'TransactionWriteConflict')) &&
          i < 7
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(150, 10 * 2 ** i) + Math.floor(Math.random() * 20)),
          );
          continue;
        }
        throw e;
      }
    }
    throw new Error('TRANSACTION_RETRY_EXHAUSTED');
  }
}
export const database: DataPort = new PrismaDataPort();
