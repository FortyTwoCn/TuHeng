import { SiteSettings, UpdateSiteSettings } from '@tuheng/contracts';
import type { Actor, DataPort } from './entities';
import { audit, ensure } from './policy';

export async function readSiteSettings(db: DataPort): Promise<SiteSettings> {
  const [current] = await db.list(
    'siteConfigurationVersion',
    {},
    {
      orderBy: 'version',
      desc: true,
      take: 1,
    },
  );
  return SiteSettings.parse({
    filingNumber: current?.filingNumber ?? '',
    version: current?.version ?? 0,
  });
}

export async function saveSiteSettings(db: DataPort, actor: Actor, input: unknown) {
  ensure(
    actor.kind === 'SITE_ADMIN' && actor.realm === 'STAFF' && !actor.onboarding,
    'FORBIDDEN',
    403,
  );
  const data = UpdateSiteSettings.parse(input);
  return db.transaction(async (tx) => {
    const current = await readSiteSettings(tx);
    ensure(current.version === data.expectedVersion, 'CONFIGURATION_CHANGED', 409);
    const row = await tx.create('siteConfigurationVersion', {
      version: current.version + 1,
      filingNumber: data.filingNumber,
    });
    await audit(tx, actor, 'SITE_SETTINGS_UPDATED', row.id, { version: row.version });
    return SiteSettings.parse(row);
  });
}
