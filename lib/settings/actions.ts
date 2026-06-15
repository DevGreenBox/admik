'use server';

/**
 * Server Actions настроек магазина (docs/11 §5.4.3) — прод-обёртки.
 *
 * Файл 'use server' экспортирует ТОЛЬКО async-функции. Вся логика — в фабрике
 * lib/settings/action-factory.ts (createSettingsActions), классы ошибок — в
 * lib/settings/errors.ts, схемы — в lib/settings/schemas.ts. Здесь — лишь тонкие
 * async-обёртки над прод-экземпляром (дефолтные зависимости: реальная БД).
 */

import {
  createSettingsActions,
  productionSettingsDeps,
} from '@/lib/settings/action-factory';

const prod = createSettingsActions(productionSettingsDeps());

export async function updateBrandingSettings(raw: unknown) {
  return prod.updateBrandingSettings(raw);
}
export async function updateCurrencyAndUnits(raw: unknown) {
  return prod.updateCurrencyAndUnits(raw);
}
export async function updateLegalAndContacts(raw: unknown) {
  return prod.updateLegalAndContacts(raw);
}
export async function updateCatalogOrdersSettings(raw: unknown) {
  return prod.updateCatalogOrdersSettings(raw);
}
export async function updateModuleOverrides(raw: unknown) {
  return prod.updateModuleOverrides(raw);
}
export async function updateShopSeoSettings(raw: unknown) {
  return prod.updateShopSeoSettings(raw);
}
export async function resetSetting(raw: unknown) {
  return prod.resetSetting(raw);
}
