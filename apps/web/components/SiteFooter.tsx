import { connection } from 'next/server';
import { database } from '@tuheng/database';
import { readSiteSettings } from '@tuheng/domain';

export async function SiteFooter() {
  await connection();
  let filingNumber = '';
  try {
    ({ filingNumber } = await readSiteSettings(database));
  } catch {
    // The brand-only footer is a valid fallback when site settings are unavailable.
    console.warn(JSON.stringify({ event: 'site-footer-settings-unavailable' }));
  }
  return (
    <footer className="site-footer" aria-label="网站信息">
      <span>图衡 TuHeng</span>
      {filingNumber && <span className="site-filing-number">{filingNumber}</span>}
    </footer>
  );
}
