import { describe, it, expect } from 'vitest';

import { toMediaDto } from '@/lib/storefront/dto';
import type { ProductMedia } from '@/lib/catalog/types';

/**
 * MediaDto.variantId (правка владельца 2026-07-22, п.2 — «при выборе цвета
 * меняется фото»).
 *
 * Привязка медиа к варианту в БД была с самого начала (product_media.variant_id,
 * миграция 0009), но публичный DTO её ОТБРАСЫВАЛ — витрина получала плоский
 * список картинок и физически не могла показать фото выбранного цвета.
 *
 * DTO-изоляция (§7) при этом сохраняется: наружу уходит только идентификатор
 * связи, а storage_key/mime/размеры/байты остаются приватными.
 */
function media(over: Partial<ProductMedia> = {}): ProductMedia {
  return {
    id: 'm-1',
    productId: 'p-1',
    variantId: null,
    storageKey: 'products/p-1/a.webp',
    url: 'https://cdn.example/a.webp',
    type: 'image',
    mime: 'image/webp',
    alt: 'Костюм',
    width: 1200,
    height: 1600,
    sizeBytes: 45000,
    sort: 0,
    isPrimary: true,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...over,
  } as ProductMedia;
}

describe('toMediaDto — привязка к варианту', () => {
  it('отдаёт variantId, когда фото привязано к варианту', () => {
    const dto = toMediaDto(media({ variantId: 'v-white-44' }));
    expect(dto.variantId).toBe('v-white-44');
  });

  it('общее фото товара (без привязки) → variantId = null', () => {
    expect(toMediaDto(media({ variantId: null })).variantId).toBeNull();
  });

  it('приватные поля наружу не уходят', () => {
    const dto = toMediaDto(media({ variantId: 'v-1' }));
    expect(dto).toEqual({
      url: 'https://cdn.example/a.webp',
      type: 'image',
      alt: 'Костюм',
      isPrimary: true,
      variantId: 'v-1',
    });
    // Явная проверка: ключ хранилища и метаданные файла — приватные.
    expect('storageKey' in dto).toBe(false);
    expect('mime' in dto).toBe(false);
    expect('sizeBytes' in dto).toBe(false);
  });
});
