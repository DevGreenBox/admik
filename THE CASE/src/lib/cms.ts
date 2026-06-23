/**
 * CMS-страницы на витрине (G-13). Серверный, мемоизированный на запрос доступ к
 * опубликованным страницам Admik (getPage). Грациозная деградация: любая ошибка/
 * отсутствие/выключенный модуль cms → null (страница падает на статический фолбэк
 * витрины или 404). Мемоизация (cache) дедуплицирует вызовы generateMetadata и
 * компонента страницы в одном рендере.
 */

import { cache } from 'react';
import { getPage, type AdmikPageDto } from '@/lib/admik';

export const getCmsPage = cache(async (slug: string): Promise<AdmikPageDto | null> => {
  try {
    return await getPage(slug);
  } catch {
    return null;
  }
});
