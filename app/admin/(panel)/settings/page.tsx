import { getEffectiveSettings } from '@/lib/config/settings';
import { getSetting } from '@/lib/settings/repository';
import { getEnabledModules } from '@/lib/config/modules';
import { parseSettingValue, type ModuleOverrides } from '@/lib/settings/schemas';

import { Forbidden } from '../_components/Forbidden';
import { guardSettings } from './_components/guard';
import { BrandingForm } from './_components/BrandingForm';
import { CurrencyUnitsForm } from './_components/CurrencyUnitsForm';
import { LegalContactsForm } from './_components/LegalContactsForm';
import { CatalogOrdersForm } from './_components/CatalogOrdersForm';
import { ModulesForm } from './_components/ModulesForm';

/**
 * Раздел «Настройки магазина» (docs/11 §5.4.5).
 *
 * Серверная страница: guard settings.manage (core, без модуля — не гейтится
 * ADMIK_MODULES, иначе self-lock). Рендерит формы по разделам, передавая текущие
 * эффективные значения (env ⊕ БД). Каждая форма мутирует свой ключ через
 * Server Action settings.manage.
 *
 * force-dynamic: читает БД/cookies — не пререндерить статически при build.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const guard = await guardSettings('settings.manage');
  if (!guard.ok) {
    return <Forbidden permission={guard.permission} />;
  }

  const eff = await getEffectiveSettings();
  // Сырой module_overrides для формы (что именно переопределено vs наследуется env).
  const rawOverrides = await getSetting('module_overrides');
  const overrides: ModuleOverrides =
    parseSettingValue('module_overrides', rawOverrides?.value) ?? {};
  const envEnabled = getEnabledModules();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-gray-900">Настройки магазина</h1>
      <p className="mt-1 text-sm text-gray-500">
        Значения по умолчанию берутся из окружения (env); заданное здесь переопределяет их в БД.
      </p>

      <Section title="Брендинг">
        <BrandingForm branding={eff.branding} />
      </Section>

      <Section title="Валюта и единицы измерения">
        <CurrencyUnitsForm currency={eff.currency} units={eff.units} />
      </Section>

      <Section title="Реквизиты и контакты">
        <LegalContactsForm legalEntity={eff.legalEntity} contacts={eff.contacts} />
      </Section>

      <Section title="Каталог, доставка, заказы">
        <CatalogOrdersForm catalog={eff.catalog} delivery={eff.delivery} orders={eff.orders} />
      </Section>

      <Section title="Модули">
        <ModulesForm overrides={overrides} envEnabled={envEnabled} />
      </Section>

      <Section title="SEO">
        <p className="text-sm text-gray-600">
          Домен, шаблон заголовка, sitemap/robots и дефолты SEO — в отдельном
          разделе.{' '}
          <a href="/admin/settings/seo" className="font-medium text-gray-900 underline">
            Открыть SEO-настройки →
          </a>
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}
