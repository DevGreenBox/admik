import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * SECURITY-гейт конфигурации прокси (доработка находок #1/#3, аудит 2026-07-18).
 *
 * ПОЧЕМУ ЭТО ТЕСТ, А НЕ КОММЕНТАРИЙ. Весь код доверия к IP в приложении
 * (`lib/server/request-ip.ts` → `normalizeClientIp`, `extractWebhookIp`) построен
 * на ОДНОМ допущении: заголовок `X-Real-IP` перезаписывает обратный прокси
 * реальным IP пира, поэтому клиент его подделать не может. Само это допущение
 * живёт НЕ в коде, а в `Caddyfile` — и до сих пор ничем не верифицировалось.
 * Достаточно добавить новый `reverse_proxy` без `header_up X-Real-IP`, и
 * приложение молча свалится на leftmost `X-Forwarded-For` (полностью
 * клиент-контролируемый) → обход IP-whitelist вебхуков, обход rate-limit
 * ротацией заголовка, отравление `audit_log.ip`/`orders.ip`. Тесты кода этого
 * НЕ ловят: код остаётся правильным, ломается конфиг.
 *
 * КОНТРАКТ ЛИНТЕРА (scripts/check-caddy-real-ip.sh):
 *   • каждый `reverse_proxy`, ведущий в приложение (app) или витрину
 *     (storefront), обязан внутри своего блока иметь
 *     `header_up X-Real-IP {http.request.remote.host}`;
 *   • DEFAULT-DENY: незнакомый upstream считается приложением и требует заголовок
 *     (новый сервис на платформе не должен «проскочить» молча);
 *   • исключение — только явно перечисленные не-приложенческие upstream'ы
 *     (по умолчанию `minio`; переопределяется CADDY_REALIP_EXEMPT), т.к. раздача
 *     медиа не принимает решений по IP;
 *   • реальный Caddyfile репозитория обязан проходить проверку.
 */

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(PROJECT_ROOT, 'scripts', 'check-caddy-real-ip.sh');

const REAL_IP_LINE = 'header_up X-Real-IP {http.request.remote.host}';

let tmpDir: string;

function run(file: string, env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, file], {
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      env: { ...process.env, ...env },
    });
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function fixture(name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, 'utf8');
  return p;
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'admik-caddylint-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('check-caddy-real-ip.sh — прокси без доверенного X-Real-IP → exit ≠ 0', () => {
  it('АТАКА-СЦЕНАРИЙ: reverse_proxy app без блока вовсе → fail', () => {
    // Ровно этот вид правки («упростили конфиг») снимает гейт доверия IP:
    // приложение начинает верить leftmost X-Forwarded-For от клиента.
    const f = fixture('bad-app-noblock.caddy', 'example.com {\n\treverse_proxy app:3000\n}\n');
    const r = run(f);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/X-Real-IP/);
  });

  it('reverse_proxy storefront без блока → fail', () => {
    const f = fixture(
      'bad-store-noblock.caddy',
      ':80 {\n\treverse_proxy storefront:3000\n}\n',
    );
    expect(run(f).code).not.toBe(0);
  });

  it('блок есть, но header_up X-Real-IP отсутствует → fail', () => {
    const f = fixture(
      'bad-block-nohdr.caddy',
      'example.com {\n\treverse_proxy app:3000 {\n\t\theader_up Host {host}\n\t}\n}\n',
    );
    expect(run(f).code).not.toBe(0);
  });

  it('ПОДМЕНА ИСТОЧНИКА: header_up X-Real-IP из клиентского XFF → fail', () => {
    // Значение обязано браться из адреса соединения. Проброс клиентского
    // заголовка возвращает ровно ту дыру, которую чинили.
    const f = fixture(
      'bad-src.caddy',
      'example.com {\n\treverse_proxy app:3000 {\n\t\theader_up X-Real-IP {http.request.header.X-Forwarded-For}\n\t}\n}\n',
    );
    const r = run(f);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/remote\.host/);
  });

  it('DEFAULT-DENY: незнакомый upstream (новый сервис) без заголовка → fail', () => {
    const f = fixture(
      'bad-unknown.caddy',
      'example.com {\n\treverse_proxy newservice:8080\n}\n',
    );
    expect(run(f).code).not.toBe(0);
  });

  it('одна дыра среди нескольких корректных блоков → fail (не «первый прошёл — всё ок»)', () => {
    const f = fixture(
      'bad-mixed.caddy',
      `a.com {\n\treverse_proxy app:3000 {\n\t\t${REAL_IP_LINE}\n\t}\n}\n` +
        'b.com {\n\treverse_proxy storefront:3000\n}\n',
    );
    expect(run(f).code).not.toBe(0);
  });
});

describe('check-caddy-real-ip.sh — корректная конфигурация → exit 0', () => {
  it('app и storefront с доверенным X-Real-IP → pass', () => {
    const f = fixture(
      'ok.caddy',
      `a.com {\n\treverse_proxy app:3000 {\n\t\t${REAL_IP_LINE}\n\t}\n}\n` +
        `b.com {\n\treverse_proxy storefront:3000 {\n\t\t${REAL_IP_LINE}\n\t}\n}\n`,
    );
    expect(run(f).code).toBe(0);
  });

  it('маршрут в minio без заголовка → pass (исключён: не принимает решений по IP)', () => {
    const f = fixture(
      'ok-minio.caddy',
      'a.com {\n\thandle_path /media/* {\n\t\treverse_proxy minio:9000\n\t}\n' +
        `\thandle {\n\t\treverse_proxy app:3000 {\n\t\t\t${REAL_IP_LINE}\n\t\t}\n\t}\n}\n`,
    );
    expect(run(f).code).toBe(0);
  });

  it('список исключений настраивается (мультитенантность имён upstream)', () => {
    const f = fixture('ok-exempt.caddy', 'a.com {\n\treverse_proxy cdn:8080\n}\n');
    expect(run(f).code).not.toBe(0);
    expect(run(f, { CADDY_REALIP_EXEMPT: 'minio|cdn' }).code).toBe(0);
  });

  it('закомментированный reverse_proxy не считается маршрутом', () => {
    const f = fixture('ok-comment.caddy', 'a.com {\n\t# reverse_proxy app:3000\n}\n');
    expect(run(f).code).toBe(0);
  });
});

describe('check-caddy-real-ip.sh — реальный Caddyfile репозитория', () => {
  it('боевой Caddyfile проходит проверку (допущение кода о X-Real-IP выполнено)', () => {
    const r = run(join(PROJECT_ROOT, 'Caddyfile'));
    expect(r.out).not.toMatch(/✗/);
    expect(r.code).toBe(0);
  });

  it('отсутствующий файл → fail (гейт не «зеленеет» на пустом месте)', () => {
    expect(run(join(tmpDir, 'nope.caddy')).code).not.toBe(0);
  });
});
