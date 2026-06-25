import { describe, it, expect, afterEach } from "vitest";
import {
  getSiteUrl,
  isNoindex,
  getSiteUrlFromSources,
  isNoindexFromSources,
} from "@/lib/site-url";

const ORIG_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIG_NOINDEX = process.env.STOREFRONT_NOINDEX;

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("NEXT_PUBLIC_SITE_URL", ORIG_URL);
  restore("STOREFRONT_NOINDEX", ORIG_NOINDEX);
});

describe("getSiteUrl", () => {
  it("использует NEXT_PUBLIC_SITE_URL когда задан (рантайм, не localhost)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://erfgq.website";
    expect(getSiteUrl()).toBe("https://erfgq.website");
  });

  it("фоллбэк на localhost когда env не задан", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("читает env при КАЖДОМ вызове (не кешируется на уровне модуля)", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://a.example";
    expect(getSiteUrl()).toBe("https://a.example");
    process.env.NEXT_PUBLIC_SITE_URL = "https://b.example";
    expect(getSiteUrl()).toBe("https://b.example");
  });
});

describe("isNoindex", () => {
  it.each(["1", "true", "TRUE", "True", " true "])(
    "truthy %j → закрыто от индексации",
    (val) => {
      process.env.STOREFRONT_NOINDEX = val;
      expect(isNoindex()).toBe(true);
    },
  );

  it.each(["", "0", "false", "no", undefined])(
    "не-truthy %j → индексация открыта",
    (val) => {
      restore("STOREFRONT_NOINDEX", val as string | undefined);
      expect(isNoindex()).toBe(false);
    },
  );
});

describe("getSiteUrlFromSources — ENV главнее настроек (Находка-14)", () => {
  it("ENV задан → берётся ENV, настройка игнорируется", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://stand.example";
    expect(getSiteUrlFromSources("https://shop-domain.ru")).toBe("https://stand.example");
  });
  it("ENV пуст → берётся домен из настроек", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(getSiteUrlFromSources("https://shop-domain.ru")).toBe("https://shop-domain.ru");
  });
  it("ENV пуст и настройка пуста → дефолт localhost", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(getSiteUrlFromSources(null)).toBe("http://localhost:3000");
    expect(getSiteUrlFromSources("   ")).toBe("http://localhost:3000");
  });
});

describe("isNoindexFromSources — ENV главнее настроек (staging-защита)", () => {
  it("ENV=1 → закрыто, даже если в настройках открыто (false)", () => {
    process.env.STOREFRONT_NOINDEX = "1";
    expect(isNoindexFromSources(false)).toBe(true);
  });
  it("ENV=0 явно задан → открыто, даже если настройка просит закрыть", () => {
    process.env.STOREFRONT_NOINDEX = "0";
    expect(isNoindexFromSources(true)).toBe(false);
  });
  it("ENV не задан → решает настройка: true закрывает", () => {
    delete process.env.STOREFRONT_NOINDEX;
    expect(isNoindexFromSources(true)).toBe(true);
  });
  it("ENV не задан, настройка false/null → открыто", () => {
    delete process.env.STOREFRONT_NOINDEX;
    expect(isNoindexFromSources(false)).toBe(false);
    expect(isNoindexFromSources(null)).toBe(false);
    expect(isNoindexFromSources(undefined)).toBe(false);
  });
});
