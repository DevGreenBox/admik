/**
 * Обработка изображений через sharp (docs/05 §3.2, §3.4 шаг 3).
 *
 * Генерирует основное изображение и thumbnail, читает реальные размеры.
 * Битое/не-изображение → понятная ошибка (вызывающий обрабатывает отказ).
 */

import sharp from 'sharp';

/** Целевая ширина основного изображения. */
export const MAIN_MAX_WIDTH = 1600;
/** Целевая ширина thumbnail. */
export const THUMBNAIL_MAX_WIDTH = 320;

/** Метаданные изображения. */
export interface ImageMeta {
  width: number;
  height: number;
  format: string;
}

/** Одно сгенерированное превью. */
export interface RenderedImage {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

/** Результат генерации превью. */
export interface PreviewSet {
  main: RenderedImage;
  thumbnail: RenderedImage;
}

/** Опции генерации превью. */
export interface GeneratePreviewsOptions {
  /** Ширина основного изображения. */
  mainWidth?: number;
  /** Ширина thumbnail. */
  thumbnailWidth?: number;
}

/**
 * Читает реальные размеры/формат изображения.
 * @throws если буфер не является валидным изображением.
 */
export async function readImageMeta(buffer: Buffer): Promise<ImageMeta> {
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch (cause) {
    throw new Error('Не удалось прочитать изображение (битый файл).', {
      cause,
    });
  }
  if (!meta.width || !meta.height || !meta.format) {
    throw new Error('Изображение не содержит корректных размеров/формата.');
  }
  return { width: meta.width, height: meta.height, format: meta.format };
}

/**
 * Ресайзит изображение до заданной ширины (без увеличения), конвертируя в webp.
 */
async function resizeToWebp(
  buffer: Buffer,
  width: number,
): Promise<RenderedImage> {
  const pipeline = sharp(buffer)
    .rotate() // нормализация ориентации по EXIF
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 });

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    width: info.width,
    height: info.height,
    format: info.format,
  };
}

/**
 * Генерирует основное изображение и thumbnail.
 * @throws если буфер не является валидным изображением.
 */
export async function generatePreviews(
  buffer: Buffer,
  opts: GeneratePreviewsOptions = {},
): Promise<PreviewSet> {
  // Сначала валидируем, что это вообще изображение — даёт понятную ошибку.
  await readImageMeta(buffer);

  const mainWidth = opts.mainWidth ?? MAIN_MAX_WIDTH;
  const thumbnailWidth = opts.thumbnailWidth ?? THUMBNAIL_MAX_WIDTH;

  const [main, thumbnail] = await Promise.all([
    resizeToWebp(buffer, mainWidth),
    resizeToWebp(buffer, thumbnailWidth),
  ]);

  return { main, thumbnail };
}
