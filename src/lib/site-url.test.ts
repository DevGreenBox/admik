import { describe, it, expect, afterEach } from "vitest";
import { getSiteUrl, isNoindex } from "@/lib/site-url";

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
