/**
 * Egasining claude.ai'dagi Meta Ads ulagichi bilan jonli tekshiruv — FAQAT O'QISH (pulga va kabinetga tegmaydi):
 * ulagich topiladimi, ijrochi aniq argumentlar bilan chaqira oladimi, javoblar Palantir shakliga to'g'ri o'qiladimi.
 * Ishga tushirish (obunaga kirilgan kompyuterda): npx tsx scripts/live-claudeai-probe.ts [ad_account_id] [page_id] [campaign_id]
 */
import { apiOf } from '../server/ads/backend';
import { connector } from '../server/ads/claudeai';
import { campaignOf } from '../server/ads/entity';
import { listAssets } from '../server/ads/hubConnect';
import type { AdsConnection } from '../server/ads/store';

const [accountArg, pageArg, campaignArg] = process.argv.slice(2);
const t = async <T>(label: string, f: () => Promise<T>): Promise<T | null> => {
  const t0 = Date.now();
  try {
    const v = await f();
    console.log(`✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s):`, typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v);
    return v;
  } catch (e) {
    console.log(`✗ ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s):`, (e as Error).message);
    return null;
  }
};

const k = await t('ulagich', () => connector(true));
if (k?.state !== 'connected') process.exit(1);
const assets = await t('kabinetlar va sahifalar', async () => {
  const a = await listAssets('', 'claudeai');
  return { accounts: a.accounts.length, active: a.accounts.filter(x => x.active).length, pages: a.pages.length };
});
if (!assets || !accountArg) process.exit(0);
const c = { token: '', adAccountId: accountArg, via: 'claudeai', currency: 'USD' } as AdsConnection;
const api = apiOf(c);
await t('kabinet', () => api.account());
if (pageArg) await t('sahifa nomi', () => api.pageName(pageArg));
await t('bugungi sarf', () => api.spend(`act_${accountArg}`, 'today'));
await t('oylik sarf', () => api.spend(`act_${accountArg}`, 'this_month'));
await t("oxirgi kampaniyalar", () => api.recentCampaigns());
if (campaignArg) {
  await t('kampaniya holati', () => api.status(campaignArg));
  await t('kampaniya (byudjet, muddat)', () => campaignOf(c, campaignArg));
  await t('kampaniya jami sarfi', () => api.spend(campaignArg, 'maximum'));
}
