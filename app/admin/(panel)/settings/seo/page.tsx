import { getEffectiveSettings } from '@/lib/config/settings';

import { Forbidden } from '../../_components/Forbidden';
import { guardSettings } from '../_components/guard';
import { SeoSettingsForm } from '../_components/SeoSettingsForm';

/**
 * Раздел «Настройки → SEO» (docs/11 §5.3.5).
 *
 * Серверная страница: guard settings.manage (core, без модуля). Рендерит форму
 * SEO-настроек магазина (site_url/title_template/og/robots/noindex), передавая
 * эффективные значения (env ⊕ БД). Мутация — updateShopSeoSettings.
 *
 * force-dynamic: читает БД/cookies — не пререндерить статически при build.
 */
export const dynamic = 'force-dynamic';

export default async function SeoSettingsPage() {
  const guard = await guardSettings('settings.manage');
  if (!guard.ok) {
    return <Forbidden permission={guard.permission} />;
  }

  const eff = await getEffectiveSettings();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900">SEO-настройки</h1>
      <p className="mt-1 text-sm text-gray-500">
        Домен, шаблон заголовка и дефолты SEO. Используются в sitemap.xml,
        robots.txt и метатегах витрины. Значения по умолчанию — из окружения.
      </p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <SeoSettingsForm seo={eff.seo} />
      </section>
    </div>
  );
}
