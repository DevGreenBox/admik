import { describe, it, expect, vi } from 'vitest';
import { submitNewsletter, NEWSLETTER_ERROR } from './newsletter-form';

/**
 * Находка S-nav #10 — форма подписки футера НЕ должна молча проглатывать ошибку.
 * Логика вынесена из компонента в чистую функцию (node-окружение vitest, без
 * testing-library): проверяем, что сбой даёт сообщение, а не «ложный успех».
 */
describe('submitNewsletter (форма подписки футера, #10)', () => {
  it('успех → ok:true, подписка вызвана с обрезанным email', async () => {
    const subscribe = vi.fn().mockResolvedValue(undefined);
    const res = await submitNewsletter('  user@test.ru  ', subscribe);
    expect(res).toEqual({ ok: true });
    expect(subscribe).toHaveBeenCalledWith('user@test.ru');
  });

  it('ошибка сети/сервера → ok:false с сообщением (не проглатывается молча)', async () => {
    const subscribe = vi.fn().mockRejectedValue(new Error('500'));
    const res = await submitNewsletter('user@test.ru', subscribe);
    expect(res).toEqual({ ok: false, error: NEWSLETTER_ERROR });
  });

  it('пустой/пробельный email → ok:false без сообщения и без обращения к сети', async () => {
    const subscribe = vi.fn();
    const res = await submitNewsletter('   ', subscribe);
    expect(res).toEqual({ ok: false, error: '' });
    expect(subscribe).not.toHaveBeenCalled();
  });
});
