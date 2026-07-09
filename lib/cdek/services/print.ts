/**
 * PrintService — печать накладной/ШК (docs/08 §7.3, порт carre PrintService.php;
 * боевой контракт — apidoc.cdek.ru 2026-07-09, выжимка print.md).
 *
 * АСИНХРОННАЯ МОДЕЛЬ ПЕЧАТИ СДЭК (print.md):
 *   1) POST /v2/print/orders|barcodes → 202 {entity.uuid} (задача печати);
 *   2) GET по uuid → entity.statuses[]: ACCEPTED → PROCESSING → READY (есть
 *      entity.url) | INVALID (ошибка формирования) | REMOVED (ссылка протухла);
 *   3) скачивание PDF: GET entity.url (= .../{uuid}.pdf) С Bearer-токеном.
 *
 * БОЕВЫЕ ФИКСЫ (аудит перехода в бой 2026-07-09):
 *   • №1: URL PDF читается из entity.url (раньше — с ВЕРХНЕГО уровня ответа,
 *     которого в боевом API нет → печать всегда падала cdek_print_not_ready);
 *     готовность определяется по statuses[] (READY), INVALID → ошибка с
 *     деталями errors[], REMOVED → отдельный код (формировать заново).
 *   • №3: ссылка на PDF живёт ~1 час и ТРЕБУЕТ Bearer — браузер админа получал
 *     401 по прямому линку. downloadShipmentLabel выкачивает PDF на сервере
 *     (сырой fetch с токеном, НЕ client.request — тело не JSON) и отдаёт байты;
 *     UI открывает наш прокси /admin/cdek/label, а не api.cdek.ru.
 *   • №4: опрос готовности — с нарастающей задержкой (PRINT_POLL_DELAYS_MS,
 *     суммарно ~13.5с) вместо фиксированных 400мс×3; printUuid одной задачи
 *     переиспользуется в рамках запроса (хранения uuid в cdek_shipments нет —
 *     схема repository только с print_url, файл занят другим агентом).
 *
 * Выбор источника — по manager.isMock:
 *   • mock → mockPrintUrl() (фейковый PDF-URL, без сети); скачивание PDF в mock
 *     невозможно → CdekError('cdek_print_mock');
 *   • real → /v2/print/orders (накладная) | /v2/print/barcodes (ШК).
 */

import type { CdekManager } from '../manager';
import { getCdekManager } from '../manager';
import { extractCdekErrors } from '../client';
import { CdekError } from '../errors';
import { getShipmentByOrderId, updateShipmentByOrderId } from '../repository';

export type PrintFormat = 'A4' | 'A5' | 'A6';
export type PrintKind = 'waybill' | 'barcode';

/** Один статус формирования печатной формы (entity.statuses[]). */
interface PrintStatusRaw {
  code?: unknown;
  name?: unknown;
  date_time?: unknown;
}

/** Ответ печати СДЭК: url/statuses живут ВНУТРИ entity (print.md). */
interface PrintEntityRaw {
  entity?: {
    uuid?: unknown;
    url?: unknown;
    statuses?: PrintStatusRaw[];
  };
  requests?: unknown[];
}

/** Базовые пути печати по виду формы. */
const PRINT_BASE: Record<PrintKind, string> = {
  waybill: '/v2/print/orders',
  barcode: '/v2/print/barcodes',
};

/**
 * Нарастающие паузы опроса готовности PDF, мс (фикс №4): 500мс → 1с → 2с → …,
 * суммарно ~13.5с (+время самих GET ≈ до ~15с на весь опрос). Попыток —
 * длина массива + 1.
 */
export const PRINT_POLL_DELAYS_MS: readonly number[] = [500, 1000, 2000, 2000, 2500, 2500, 3000];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Снимок состояния задачи печати после одного GET. */
interface PrintFormState {
  /** entity.url (есть только при READY). */
  url: string | null;
  /** Код ПОСЛЕДНЕГО статуса из entity.statuses[] (хронологический порядок). */
  status: string | null;
  /** Сырой ответ (для деталей ошибок INVALID через extractCdekErrors). */
  raw: PrintEntityRaw;
}

/** Опции PrintService (инъекции для тестов). */
export interface PrintServiceOptions {
  /** Паузы опроса готовности (мс); дефолт PRINT_POLL_DELAYS_MS. */
  pollDelaysMs?: readonly number[];
  /** fetch для СЫРОГО скачивания PDF (не для client.request). Дефолт глобальный. */
  fetchImpl?: typeof fetch;
}

export class PrintService {
  private readonly pollDelaysMs: readonly number[];
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly manager: CdekManager = getCdekManager(),
    opts: PrintServiceOptions = {},
  ) {
    this.pollDelaysMs = opts.pollDelaysMs ?? PRINT_POLL_DELAYS_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ---------------------------------------------------------------------------
  // Шаг 1: постановка задачи печати → printUuid.
  // ---------------------------------------------------------------------------

  /** POST задачи печати (накладная или ШК) → uuid печатной формы. */
  private async requestPrintForm(
    kind: PrintKind,
    orderUuid: string,
    opts: { format?: PrintFormat; copyCount?: number } = {},
  ): Promise<string> {
    const json: Record<string, unknown> = {
      orders: [{ order_uuid: orderUuid }],
      copy_count: opts.copyCount ?? 1,
    };
    if (kind === 'barcode') json.format = opts.format ?? 'A6';

    const raw = await this.manager.client.request<PrintEntityRaw>('POST', PRINT_BASE[kind], {
      json,
    });
    const uuid = raw?.entity?.uuid;
    if (typeof uuid !== 'string' || uuid.length === 0) {
      // Асинхронные методы кладут причину в requests[].errors (напр.
      // v2_entity_not_ready — заказ ещё без номера СДЭК) — показываем её.
      const details = extractCdekErrors(raw)
        .map((e) => `${e.code}: ${e.message}`)
        .join('; ');
      throw new CdekError(
        'cdek_print_no_uuid',
        `СДЭК не вернул uuid задачи печати (${kind}).${details ? ` Детали: ${details}` : ''}`,
      );
    }
    return uuid;
  }

  /** Совместимость: задача на накладную (POST /v2/print/orders) → printUuid. */
  async requestWaybill(orderUuid: string, copyCount = 1): Promise<string> {
    return this.requestPrintForm('waybill', orderUuid, { copyCount });
  }

  /** Совместимость: задача на ШК (POST /v2/print/barcodes) → printUuid. */
  async requestBarcode(orderUuid: string, format: PrintFormat = 'A6', copyCount = 1): Promise<string> {
    return this.requestPrintForm('barcode', orderUuid, { format, copyCount });
  }

  // ---------------------------------------------------------------------------
  // Шаг 2: опрос готовности по statuses[] → entity.url.
  // ---------------------------------------------------------------------------

  /** Один GET состояния задачи печати: entity.url + последний statuses[].code. */
  private async getPrintFormState(kind: PrintKind, printUuid: string): Promise<PrintFormState> {
    const raw = await this.manager.client.request<PrintEntityRaw>(
      'GET',
      `${PRINT_BASE[kind]}/${printUuid}`,
    );
    const entity = raw?.entity;
    const url = typeof entity?.url === 'string' && entity.url.length > 0 ? entity.url : null;
    const statuses = Array.isArray(entity?.statuses) ? entity.statuses : [];
    const last = statuses.length > 0 ? statuses[statuses.length - 1] : undefined;
    const status = typeof last?.code === 'string' ? last.code.toUpperCase() : null;
    return { url, status, raw: raw ?? {} };
  }

  /**
   * Опрос готовности PDF с нарастающими паузами (фикс №4) — переиспользует ОДИН
   * printUuid. READY (или url при отсутствии statuses) → url; INVALID → ошибка
   * с деталями errors[]; REMOVED → «ссылка протухла, формируйте заново»;
   * исчерпание попыток → cdek_print_not_ready.
   */
  private async pollPrintFormReady(kind: PrintKind, printUuid: string): Promise<string> {
    const attempts = this.pollDelaysMs.length + 1;
    for (let i = 0; i < attempts; i++) {
      const state = await this.getPrintFormState(kind, printUuid);

      if (state.status === 'INVALID') {
        const details = extractCdekErrors(state.raw)
          .map((e) => `${e.code}: ${e.message}`)
          .join('; ');
        throw new CdekError(
          'cdek_print_invalid',
          `СДЭК отклонил печатную форму (INVALID).${details ? ` Детали: ${details}` : ''}`,
        );
      }
      if (state.status === 'REMOVED') {
        throw new CdekError(
          'cdek_print_removed',
          'Ссылка на PDF печати истекла (REMOVED, живёт ~1 час) — сформируйте форму заново.',
        );
      }
      if (state.url && (state.status === 'READY' || state.status === null)) {
        // READY по statuses[]; отсутствие statuses при наличии entity.url —
        // толерантность к неполному ответу (edu-контур).
        return state.url;
      }

      if (i < attempts - 1) await sleep(this.pollDelaysMs[i]!);
    }
    throw new CdekError('cdek_print_not_ready', 'PDF печати ещё не готов (повторите позже).');
  }

  // ---------------------------------------------------------------------------
  // Публичные операции.
  // ---------------------------------------------------------------------------

  /** Разрешает отправление заказа с cdek_uuid (или бросает cdek_no_shipment). */
  private async requireShipment(orderId: string): Promise<{ cdekUuid: string; cdekNumber: string | null }> {
    const shipment = await getShipmentByOrderId(orderId);
    if (!shipment?.cdekUuid) {
      throw new CdekError(
        'cdek_no_shipment',
        `Для заказа ${orderId} нет отправления (cdek_uuid) для печати.`,
      );
    }
    return { cdekUuid: shipment.cdekUuid, cdekNumber: shipment.cdekNumber ?? null };
  }

  /** Полный цикл подготовки формы: POST задачи → опрос READY → entity.url. */
  private async preparePrintUrl(
    orderId: string,
    opts: { kind?: PrintKind; format?: PrintFormat; copyCount?: number } = {},
  ): Promise<{ url: string; kind: PrintKind; cdekNumber: string | null }> {
    const kind = opts.kind ?? 'waybill';
    const shipment = await this.requireShipment(orderId);
    const printUuid = await this.requestPrintForm(kind, shipment.cdekUuid, {
      format: opts.format,
      copyCount: opts.copyCount,
    });
    const url = await this.pollPrintFormReady(kind, printUuid);
    await updateShipmentByOrderId(orderId, { printUrl: url });
    return { url, kind, cdekNumber: shipment.cdekNumber };
  }

  /**
   * URL готовой накладной (по умолчанию) либо ШК для заказа (docs/08 §7.3).
   * mock → фейковый PDF-URL; real → POST задачи + опрос statuses до READY.
   * Сохраняет entity.url в cdek_shipments.print_url.
   *
   * ВНИМАНИЕ (фикс №3): возвращаемый боевой URL требует Bearer и живёт ~1 час —
   * он НЕ предназначен для открытия в браузере. UI должен использовать
   * серверный прокси /admin/cdek/label (downloadShipmentLabel).
   */
  async getShipmentLabel(
    orderId: string,
    opts: { kind?: PrintKind; format?: PrintFormat; copyCount?: number } = {},
  ): Promise<{ url: string }> {
    if (this.manager.isMock) {
      const url = this.manager.mock.mockPrintUrl();
      await updateShipmentByOrderId(orderId, { printUrl: url }).catch(() => {});
      return { url };
    }
    const { url } = await this.preparePrintUrl(orderId, opts);
    return { url };
  }

  /**
   * Серверная выкачка PDF печатной формы (фикс №3): готовит форму (POST →
   * опрос READY → entity.url) и скачивает PDF СЫРЫМ fetch с Bearer-токеном
   * (client.request не годится — тело не JSON). 401 → invalidate токена +
   * ровно один повтор со свежим (симметрично client.request).
   *
   * @returns байты PDF + имя файла для Content-Disposition.
   */
  async downloadShipmentLabel(
    orderId: string,
    opts: { kind?: PrintKind; format?: PrintFormat; copyCount?: number } = {},
  ): Promise<{ pdf: Uint8Array; fileName: string; url: string }> {
    if (this.manager.isMock) {
      throw new CdekError(
        'cdek_print_mock',
        'MOCK-режим СДЭК: реальный PDF недоступен (боевые ключи не заданы).',
      );
    }

    const { url, kind, cdekNumber } = await this.preparePrintUrl(orderId, opts);
    const pdf = await this.fetchPdf(url);
    const fileName = `cdek-${kind}-${cdekNumber ?? orderId}.pdf`;
    return { pdf, fileName, url };
  }

  /** Сырое скачивание PDF по entity.url с Bearer (401 → invalidate + 1 повтор). */
  private async fetchPdf(url: string): Promise<Uint8Array> {
    let token = await this.manager.client.getToken();
    let res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      await this.manager.client.invalidateToken();
      token = await this.manager.client.getToken();
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (res.status !== 200 || contentType.includes('application/json')) {
      // Тело может нести документированные errors[] (v2_entity_invalid и т.п.).
      let details = '';
      try {
        const text = await res.text();
        details = extractCdekErrors(JSON.parse(text))
          .map((e) => `${e.code}: ${e.message}`)
          .join('; ');
      } catch {
        /* не-JSON тело ошибки — деталей нет */
      }
      throw new CdekError(
        'cdek_print_download_failed',
        `Не удалось скачать PDF печати (HTTP ${res.status}).${details ? ` Детали: ${details}` : ''}`,
        { httpStatus: res.status },
      );
    }

    return new Uint8Array(await res.arrayBuffer());
  }
}
