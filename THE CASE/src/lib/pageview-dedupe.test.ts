import { describe, it, expect } from 'vitest';
import { decidePageview } from './pageview-dedupe';

describe('decidePageview', () => {
  it('первый рендер (prevKey=null) → отправляем', () => {
    const d = decidePageview(null, '/');
    expect(d).toEqual({ send: true, nextKey: '/' });
  });

  it('тот же маршрут (повторный прогон эффекта / strict-mode) → НЕ отправляем', () => {
    const d = decidePageview('/catalog', '/catalog');
    expect(d).toEqual({ send: false, nextKey: '/catalog' });
  });

  it('смена маршрута → отправляем с новым ключом', () => {
    const d = decidePageview('/', '/catalog');
    expect(d).toEqual({ send: true, nextKey: '/catalog' });
  });

  it('возврат на корень после ухода → снова отправляем (новое посещение)', () => {
    const d = decidePageview('/catalog', '/');
    expect(d).toEqual({ send: true, nextKey: '/' });
  });

  it('симуляция последовательности переходов: считает только уникальные смены', () => {
    const visits = ['/', '/', '/catalog', '/catalog', '/', '/contacts'];
    let prev: string | null = null;
    let sent = 0;
    for (const path of visits) {
      const d = decidePageview(prev, path);
      if (d.send) sent += 1;
      prev = d.nextKey;
    }
    // '/', '/catalog', '/', '/contacts' → 4 отправки (дубли подряд отсеяны)
    expect(sent).toBe(4);
  });
});
