import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "./i18n";

describe("i18n", () => {
  it("resolves explicit language preferences", () => {
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(resolveLocale("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("resolves system language to supported locales", () => {
    expect(resolveLocale("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
  });

  it("interpolates translated strings", () => {
    expect(translate("en", "table.summary", { visible: 3, total: 9 })).toBe(
      "3 visible · 9 total",
    );
    expect(translate("zh-CN", "table.summary", { visible: 3, total: 9 })).toBe(
      "显示 3 条 / 共 9 条",
    );
  });
});
