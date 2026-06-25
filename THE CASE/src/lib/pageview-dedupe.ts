/**
 * Дедупликация beacon-ов посещения (F23).
 *
 * В React strict-mode (dev) эффекты монтируются дважды, а Next может повторно
 * прогонять эффект на том же маршруте — чтобы не задваивать счётчик посещений,
 * мы шлём beacon ровно один раз на КАЖДЫЙ уникальный ключ маршрута.
 *
 * Чистая функция (без побочных эффектов и DOM) — состояние «последнего отправленного
 * ключа» хранит вызывающий (useRef), а здесь только решаем: слать или нет, и каким
 * стал новый ключ. Так логику легко покрыть юнит-тестом.
 */

export interface PageviewDecision {
  /** Нужно ли отправлять beacon для этого маршрута. */
  send: boolean;
  /** Ключ, который вызывающий должен сохранить как «последний отправленный». */
  nextKey: string;
}

/**
 * Решает, слать ли beacon для текущего маршрута.
 *
 * @param prevKey ключ предыдущего отправленного маршрута (или null при первом рендере)
 * @param pathname текущий pathname из usePathname()
 * @returns send=true только если маршрут изменился относительно prevKey
 */
export function decidePageview(
  prevKey: string | null,
  pathname: string,
): PageviewDecision {
  const nextKey = pathname;
  return { send: prevKey !== nextKey, nextKey };
}
