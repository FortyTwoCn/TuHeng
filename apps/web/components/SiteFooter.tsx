import { connection } from 'next/server';
import { database } from '@tuheng/database';
import { readSiteSettings } from '@tuheng/domain';

export async function SiteFooter() {
  await connection();
  let filingNumber = '';
  try {
    ({ filingNumber } = await readSiteSettings(database));
  } catch {
    // Public pages, especially login, remain usable during a settings/database outage.
    console.error(JSON.stringify({ event: 'site-footer-settings-unavailable' }));
  }
  return (
    <footer className="site-footer" aria-label="网站信息">
      <span>图衡 TuHeng</span>
      {filingNumber && <span className="site-filing-number">{filingNumber}</span>}
    </footer>
  );
}
