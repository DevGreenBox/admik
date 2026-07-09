import { describe, it, expect } from 'vitest';
import { CdekError, isNetworkError } from '@/lib/cdek/errors';

/** Юнит-тесты класса ошибки СДЭК (docs/08 §2). Без БД/сети. */
describe('cdek/errors — CdekError', () => {
  it('несёт code и message; cdekErrors/httpStatus по умолчанию пустые', () => {
    const err = new CdekError('network', 'нет связи');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CdekError');
    expect(err.code).toBe('network');
    expect(err.message).toBe('нет связи');
    expect(err.cdekErrors).toEqual([]);
    expect(err.httpStatus).toBeNull();
  });

  it('пробрасывает cdekErrors и httpStatus из ответа СДЭК', () => {
    const err = new CdekError('bad_request', 'ошибка валидации', {
      cdekErrors: [{ code: 'v2_field', message: 'поле обязательно' }],
      httpStatus: 400,
    });
    expect(err.httpStatus).toBe(400);
    expect(err.cdekErrors).toHaveLength(1);
    expect(err.cdekErrors[0]).toEqual({ code: 'v2_field', message: 'поле обязательно' });
  });

  it('ловится как Error (для defineAction/try-catch)', () => {
    try {
      throw new CdekError('mock', 'mock-ошибка');
    } catch (e) {
      expect(e).toBeInstanceOf(CdekError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});

describe('cdek/errors — isNetworkError (общий предикат client/token-cache)', () => {
  it('TypeError fetch («fetch failed») → true', () => {
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
  });

  it('AbortError (таймаут через AbortController) → true', () => {
    expect(isNetworkError(new DOMException('The operation was aborted', 'AbortError'))).toBe(true);
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(isNetworkError(err)).toBe(true);
  });

  it('обычная Error / не-Error → false', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
    expect(isNetworkError(new CdekError('x', 'y'))).toBe(false);
    expect(isNetworkError('строка')).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
