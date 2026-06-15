import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

/**
 * Быстрый барьер доступа к /admin/* (docs/04 §5.3, задача 1.4).
 *
 * Middleware — лишь БЫСТРАЯ проверка НАЛИЧИЯ cookie сессии (без обращения к БД,
 * т.к. middleware работает в edge-окружении без драйвера postgres). Полную
 * валидацию сессии (срок, статус пользователя, права) делает серверный layout
 * через requireUser() (§6.2). Так мы дёшево отсекаем заведомо неавторизованных
 * до рендера, а настоящее решение о доступе остаётся на сервере (двойная защита).
 *
 * Исключение: /admin/login доступен без сессии (иначе нельзя войти).
 */

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Страница логина — единственный публичный путь под /admin.
  if (pathname === '/admin/login') {
    return NextResponse.next();
  }

  const hasSession = Boolean(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!hasSession) {
    const loginUrl = new URL('/admin/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Применяем middleware ко всем путям /admin/* (включая корень /admin).
 * Статика и API сюда не попадают.
 */
export const config = {
  matcher: ['/admin/:path*'],
};
