import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';
import { getEnv } from '@/lib/config/env';

import { LoginForm } from './LoginForm';

/**
 * Страница логина (docs/04 §6.4). ВНЕ admin-layout группы (panel): этот файл —
 * сиблинг группы `(panel)`, поэтому не наследует layout с requireUser(), и
 * остаётся публичным. Без admin-навигации (§6.1).
 *
 * Если пользователь уже авторизован — сразу redirect на /admin.
 *
 * force-dynamic: читает cookie/сессию — не пререндерить статически при build.
 */
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect('/admin');
  }

  const env = getEnv();
  const shopName = env.SHOP_NAME ?? 'Admik';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          {env.SHOP_LOGO_URL ? (
            // eslint-disable-next-line @next/next/no-img-element -- логотип из произвольного внешнего URL (.env)
            <img
              src={env.SHOP_LOGO_URL}
              alt={`Логотип: ${shopName}`}
              className="h-10 w-auto"
            />
          ) : null}
          <h1 className="text-xl font-semibold text-gray-900">{shopName}</h1>
          <p className="text-sm text-gray-500">Вход в панель управления</p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
