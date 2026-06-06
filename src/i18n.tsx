import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Locale = "en" | "zh-CN";
export type LanguagePreference = "system" | Locale;

const en = {
  "app.brand": "Port Manager",
  "app.subtitle": "Developer ports",
  "filter.all": "All Ports",
  "filter.web": "Web Dev",
  "filter.favorites": "Favorites",
  "filter.recentlyKilled": "Recently Killed",
  "nav.aria": "Port filters",
  "quickPorts.title": "Quick Ports",
  "stats.occupied": "Occupied",
  "stats.limited": "Limited",
  "search.aria": "Search ports",
  "search.placeholder": "Search port, process, PID, or path",
  "protocol.aria": "Protocol filter",
  "protocol.all": "All protocols",
  "language.aria": "Language",
  "language.system": "System",
  "language.english": "English",
  "language.chinese": "中文",
  "action.refresh": "Refresh",
  "action.reveal": "Reveal",
  "action.revealLocation": "Reveal location",
  "action.kill": "Kill",
  "action.killProcess": "Kill Process",
  "action.cancel": "Cancel",
  "action.elevateKill": "Elevate and Kill",
  "favorite.add": "Add favorite",
  "favorite.remove": "Remove favorite",
  "table.title": "Active Ports",
  "table.summary": "{visible} visible · {total} total",
  "table.live": "Live",
  "table.aria": "Active ports",
  "column.port": "Port",
  "column.protocol": "Protocol",
  "column.address": "Address",
  "column.process": "Process",
  "column.path": "Path",
  "column.status": "Status",
  "column.actions": "Actions",
  "empty.scanning": "Scanning ports",
  "empty.noMatches": "No matching ports",
  "empty.selectPort": "Select a port",
  "process.unknown": "Unknown",
  "process.unknownProcess": "Unknown process",
  "process.noPid": "No PID",
  "process.pidUnavailable": "PID unavailable",
  "process.noPidAvailable": "No PID available",
  "path.unavailable": "Path unavailable",
  "value.unavailable": "Unavailable",
  "status.ready": "Ready",
  "status.limited": "Limited",
  "status.needsElevation": "Needs elevation",
  "detail.ports": "Ports",
  "detail.address": "Address",
  "detail.executable": "Executable",
  "detail.command": "Command",
  "notice.limitedMetadata": "Limited metadata",
  "sockets.title": "Sockets for this PID",
  "ports.none": "No ports",
  "modal.kill.title": "Kill this process?",
  "modal.kill.body":
    "{process} is using port {port}. This may stop a local server or database.",
  "modal.elevation.title": "Permission required",
  "modal.elevation.body":
    "{process} could not be terminated with current permissions. Retry with elevated privileges.",
  "error.needsElevation": "Administrator permission is required for this action.",
  "error.notFound": "The process or file was not found.",
  "error.invalidInput": "The request is invalid.",
  "error.unavailable": "This action is available in the desktop app.",
  "error.unknown": "The operation failed.",
} as const;

export type TranslationKey = keyof typeof en;

const zhCN: Record<TranslationKey, string> = {
  "app.brand": "端口管理器",
  "app.subtitle": "开发者端口",
  "filter.all": "全部端口",
  "filter.web": "Web 开发",
  "filter.favorites": "收藏",
  "filter.recentlyKilled": "最近结束",
  "nav.aria": "端口筛选",
  "quickPorts.title": "常用端口",
  "stats.occupied": "已占用",
  "stats.limited": "受限",
  "search.aria": "搜索端口",
  "search.placeholder": "搜索端口、进程、PID 或路径",
  "protocol.aria": "协议筛选",
  "protocol.all": "全部协议",
  "language.aria": "语言",
  "language.system": "跟随系统",
  "language.english": "English",
  "language.chinese": "中文",
  "action.refresh": "刷新",
  "action.reveal": "定位",
  "action.revealLocation": "定位文件位置",
  "action.kill": "结束",
  "action.killProcess": "结束进程",
  "action.cancel": "取消",
  "action.elevateKill": "提权后结束",
  "favorite.add": "添加收藏",
  "favorite.remove": "移除收藏",
  "table.title": "活动端口",
  "table.summary": "显示 {visible} 条 / 共 {total} 条",
  "table.live": "实时",
  "table.aria": "活动端口",
  "column.port": "端口",
  "column.protocol": "协议",
  "column.address": "地址",
  "column.process": "进程",
  "column.path": "路径",
  "column.status": "状态",
  "column.actions": "操作",
  "empty.scanning": "正在扫描端口",
  "empty.noMatches": "没有匹配端口",
  "empty.selectPort": "选择一个端口",
  "process.unknown": "未知",
  "process.unknownProcess": "未知进程",
  "process.noPid": "无 PID",
  "process.pidUnavailable": "PID 不可用",
  "process.noPidAvailable": "无可用 PID",
  "path.unavailable": "路径不可用",
  "value.unavailable": "不可用",
  "status.ready": "可操作",
  "status.limited": "受限",
  "status.needsElevation": "需要提权",
  "detail.ports": "端口",
  "detail.address": "地址",
  "detail.executable": "可执行文件",
  "detail.command": "命令",
  "notice.limitedMetadata": "元数据受限",
  "sockets.title": "此 PID 的套接字",
  "ports.none": "无端口",
  "modal.kill.title": "结束这个进程？",
  "modal.kill.body": "{process} 正在占用端口 {port}。这可能会停止本地服务或数据库。",
  "modal.elevation.title": "需要权限",
  "modal.elevation.body": "{process} 无法用当前权限结束。请提权后重试。",
  "error.needsElevation": "此操作需要管理员权限。",
  "error.notFound": "没有找到进程或文件。",
  "error.invalidInput": "请求参数无效。",
  "error.unavailable": "此操作只能在桌面应用中使用。",
  "error.unknown": "操作失败。",
};

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
  en,
  "zh-CN": zhCN,
};

const storageKey = "windowsPortManager.language";

type TranslationValues = Record<string, string | number>;

type I18nContextValue = {
  locale: Locale;
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function resolveLocale(
  preference: LanguagePreference,
  systemLanguage = typeof navigator === "undefined" ? "en" : navigator.language,
): Locale {
  if (preference === "en" || preference === "zh-CN") return preference;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function translate(locale: Locale, key: TranslationKey, values?: TranslationValues): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  if (!values) return template;

  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

function readInitialPreference(): LanguagePreference {
  if (typeof localStorage === "undefined") return "system";
  const stored = localStorage.getItem(storageKey);
  if (stored === "en" || stored === "zh-CN" || stored === "system") return stored;
  return "system";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(readInitialPreference);
  const [systemLanguage, setSystemLanguage] = useState(
    typeof navigator === "undefined" ? "en" : navigator.language,
  );

  useEffect(() => {
    const handler = () => setSystemLanguage(navigator.language);
    window.addEventListener("languagechange", handler);
    return () => window.removeEventListener("languagechange", handler);
  }, []);

  const locale = resolveLocale(preference, systemLanguage);

  const value = useMemo<I18nContextValue>(() => {
    function setPreference(nextPreference: LanguagePreference) {
      setPreferenceState(nextPreference);
      localStorage.setItem(storageKey, nextPreference);
    }

    return {
      locale,
      preference,
      setPreference,
      t: (key, values) => translate(locale, key, values),
    };
  }, [locale, preference]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider");
  return value;
}
