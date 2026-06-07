import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Compass,
  ExternalLink,
  Eye,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Square,
  Star,
  StarOff,
  TerminalSquare,
  Trash2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { killProcess, listPortUsage, refreshProcess, revealProcess } from "./api";
import { useI18n, type TranslationKey } from "./i18n";
import {
  filterPorts,
  getPermissionLabel,
  groupByPid,
  isWebDevPort,
  QUICK_PORTS,
  summarizePorts,
} from "./lib/ports";
import type { AppError, KillRecord, PortFilter, PortUsage, ProtocolFilter } from "./types";
import "./styles.css";

const filters: Array<{ id: PortFilter; labelKey: TranslationKey; icon: typeof Activity }> = [
  { id: "all", labelKey: "filter.all", icon: Activity },
  { id: "web", labelKey: "filter.web", icon: Server },
  { id: "favorites", labelKey: "filter.favorites", icon: Star },
  { id: "recentlyKilled", labelKey: "filter.recentlyKilled", icon: Trash2 },
];

type RefreshFrequency = "1000" | "5000" | "10000" | "off";

const refreshFrequencyStorageKey = "windowsPortManager.refreshFrequency";

const refreshOptions: Array<{ value: RefreshFrequency; labelKey: TranslationKey }> = [
  { value: "1000", labelKey: "refresh.1s" },
  { value: "5000", labelKey: "refresh.5s" },
  { value: "10000", labelKey: "refresh.10s" },
  { value: "off", labelKey: "refresh.off" },
];

function readInitialRefreshFrequency(): RefreshFrequency {
  if (typeof localStorage === "undefined") return "1000";
  const stored = localStorage.getItem(refreshFrequencyStorageKey);
  return stored === "1000" || stored === "5000" || stored === "10000" || stored === "off"
    ? stored
    : "1000";
}

function normalizeError(error: unknown): AppError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    return error as AppError;
  }

  return {
    code: "Unknown",
    message: error instanceof Error ? error.message : String(error),
  };
}

function formatPath(path: string | null, unavailableLabel: string): string {
  if (!path) return unavailableLabel;
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.length <= 4) return path;
  return `.../${parts.slice(-3).join("/")}`;
}

function getRowTitle(row: PortUsage, unknownProcessLabel: string, noPidLabel: string): string {
  const process = row.processName ?? unknownProcessLabel;
  const pid = row.pid === null ? noPidLabel : `PID ${row.pid}`;
  return `${process} · ${pid}`;
}

export default function App() {
  const { locale, preference, setPreference, t } = useI18n();
  const [rows, setRows] = useState<PortUsage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<PortFilter>("all");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>("ALL");
  const [refreshFrequency, setRefreshFrequencyState] = useState<RefreshFrequency>(
    readInitialRefreshFrequency,
  );
  const [search, setSearch] = useState("");
  const [selectedQuickPort, setSelectedQuickPort] = useState<number | null>(null);
  const [occupiedOnly, setOccupiedOnly] = useState(true);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [recentlyKilled, setRecentlyKilled] = useState<KillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionPid, setActionPid] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pendingKill, setPendingKill] = useState<PortUsage | null>(null);
  const [needsElevation, setNeedsElevation] = useState<PortUsage | null>(null);
  const scanningRef = useRef(false);

  const loadPorts = useCallback(
    async (keepSelection = true, showSpinner = true) => {
      if (scanningRef.current) return;
      scanningRef.current = true;
      if (showSpinner) setLoading(true);
      setError(null);

      try {
        const nextRows = await listPortUsage();
        setRows(nextRows);
        setSelectedId((current) => {
          if (keepSelection && current && nextRows.some((row) => row.id === current)) return current;
          return nextRows[0]?.id ?? null;
        });
      } catch (err) {
        setError(normalizeError(err));
      } finally {
        if (showSpinner) setLoading(false);
        scanningRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    void loadPorts(false);
  }, [loadPorts]);

  useEffect(() => {
    if (refreshFrequency === "off") return;

    const interval = window.setInterval(() => {
      void loadPorts(true, false);
    }, Number(refreshFrequency));

    return () => window.clearInterval(interval);
  }, [loadPorts, refreshFrequency]);

  const visibleRows = useMemo(
    () =>
      filterPorts({
        rows,
        activeFilter,
        protocolFilter,
        search,
        selectedQuickPort,
        favorites,
        recentlyKilled,
        occupiedOnly,
      }),
    [activeFilter, favorites, occupiedOnly, protocolFilter, recentlyKilled, rows, search, selectedQuickPort],
  );

  const selectedRow = useMemo(() => {
    if (selectedId) {
      const selected = rows.find((row) => row.id === selectedId);
      if (selected) return selected;
    }
    return visibleRows[0] ?? null;
  }, [rows, selectedId, visibleRows]);

  const rowsByPid = useMemo(() => groupByPid(rows), [rows]);
  const selectedPidRows = selectedRow?.pid === null || !selectedRow ? [] : rowsByPid.get(selectedRow.pid) ?? [];
  const occupiedCount = rows.filter((row) => row.pid !== null).length;
  const limitedCount = rows.filter((row) => row.permissionState !== "available").length;

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function permissionLabel(row: PortUsage): string {
    return getPermissionLabel(row, {
      needsElevation: t("status.needsElevation"),
      limited: t("status.limited"),
      ready: t("status.ready"),
    });
  }

  function errorMessage(error: AppError): string {
    if (error.code === "NeedsElevation") return t("error.needsElevation");
    if (error.code === "NotFound") return t("error.notFound");
    if (error.code === "InvalidInput") return t("error.invalidInput");
    if (error.code === "Unavailable") return error.message || t("error.unavailable");
    return error.message || t("error.unknown");
  }

  function rowTitle(row: PortUsage): string {
    return getRowTitle(row, t("process.unknownProcess"), t("process.noPid"));
  }

  function setRefreshFrequency(nextFrequency: RefreshFrequency) {
    setRefreshFrequencyState(nextFrequency);
    localStorage.setItem(refreshFrequencyStorageKey, nextFrequency);
  }

  function refreshLabel(frequency: RefreshFrequency): string {
    return t(refreshOptions.find((option) => option.value === frequency)?.labelKey ?? "refresh.1s");
  }

  function toggleFavorite(row: PortUsage) {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.add(row.id);
      }
      return next;
    });
  }

  async function handleReveal(row: PortUsage) {
    if (!row.executablePath) return;
    setActionPid(row.pid);
    setError(null);

    try {
      await revealProcess(row.executablePath);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionPid(null);
    }
  }

  async function handleKill(row: PortUsage, elevated = false) {
    if (row.pid === null) return;
    setActionPid(row.pid);
    setError(null);

    try {
      await killProcess(row.pid, elevated);
      setRecentlyKilled((current) => [
        {
          pid: row.pid!,
          processName: row.processName,
          ports: (rowsByPid.get(row.pid!) ?? [row]).map((item) => item.port),
          killedAt: new Date().toISOString(),
        },
        ...current.filter((item) => item.pid !== row.pid).slice(0, 9),
      ]);
      const nextRows = await listPortUsage();
      setRows(nextRows);
      setSelectedId(nextRows.find((item) => item.id === row.id)?.id ?? nextRows[0]?.id ?? null);
      setPendingKill(null);
      setNeedsElevation(null);
    } catch (err) {
      const appError = normalizeError(err);
      if (appError.code === "NeedsElevation") {
        setNeedsElevation(row);
      }
      setError(appError);
    } finally {
      setActionPid(null);
    }
  }

  async function handleRefreshProcess(row: PortUsage) {
    if (row.pid === null) {
      await loadPorts(true);
      return;
    }

    setActionPid(row.pid);
    setError(null);

    try {
      const refreshed = await refreshProcess(row.pid);
      setRows((current) => {
        const withoutPid = current.filter((item) => item.pid !== row.pid);
        return [...withoutPid, ...refreshed];
      });
      setSelectedId(refreshed[0]?.id ?? selectedId);
    } catch (err) {
      setError(normalizeError(err));
    } finally {
      setActionPid(null);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Compass size={21} />
          </div>
          <div>
            <div className="brand-title">{t("app.brand")}</div>
            <div className="brand-subtitle">{t("app.subtitle")}</div>
          </div>
        </div>

        <nav className="nav-list" aria-label={t("nav.aria")}>
          {filters.map((filter) => {
            const Icon = filter.icon;
            const isActive = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                className={`nav-item ${isActive ? "active" : ""}`}
                type="button"
                onClick={() => setActiveFilter(filter.id)}
              >
                <Icon size={18} />
                <span>{t(filter.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <section className="sidebar-section">
          <div className="section-label">{t("quickPorts.title")}</div>
          <div className="quick-grid">
            {QUICK_PORTS.map((port) => (
              <button
                key={port}
                className={`quick-port ${selectedQuickPort === port ? "selected" : ""}`}
                type="button"
                onClick={() => setSelectedQuickPort(selectedQuickPort === port ? null : port)}
              >
                {port}
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section sidebar-stats">
          <div>
            <span>{t("stats.occupied")}</span>
            <strong>{occupiedCount}</strong>
          </div>
          <div>
            <span>{t("stats.limited")}</span>
            <strong>{limitedCount}</strong>
          </div>
        </section>
      </aside>

      <main className="workspace">
        <header className="toolbar">
          <div className="search-box">
            <Search size={17} />
            <input
              aria-label={t("search.aria")}
              placeholder={t("search.placeholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="toolbar-actions">
            <select
              aria-label={t("protocol.aria")}
              value={protocolFilter}
              onChange={(event) => setProtocolFilter(event.target.value as ProtocolFilter)}
            >
              <option value="ALL">{t("protocol.all")}</option>
              <option value="TCP">TCP</option>
              <option value="UDP">UDP</option>
            </select>

            <select
              aria-label={t("language.aria")}
              value={preference}
              onChange={(event) => setPreference(event.target.value as typeof preference)}
            >
              <option value="system">{t("language.system")}</option>
              <option value="en">{t("language.english")}</option>
              <option value="zh-CN">{t("language.chinese")}</option>
            </select>

            <select
              aria-label={t("refresh.aria")}
              value={refreshFrequency}
              onChange={(event) => setRefreshFrequency(event.target.value as RefreshFrequency)}
            >
              {refreshOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>

            <label className="toggle">
              <input
                type="checkbox"
                checked={occupiedOnly}
                onChange={(event) => setOccupiedOnly(event.target.checked)}
              />
              <span>{t("stats.occupied")}</span>
            </label>

            <button className="icon-button" type="button" title={t("action.refresh")} onClick={() => void loadPorts(true)}>
              {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
          </div>
        </header>

        {error ? (
          <div className="error-banner" role="alert">
            <AlertTriangle size={18} />
            <span>{errorMessage(error)}</span>
          </div>
        ) : null}

        <section className="content-grid">
          <div className="table-region">
            <div className="table-header">
              <div>
                <h1>{t("table.title")}</h1>
                <p>{t("table.summary", { visible: visibleRows.length, total: rows.length })}</p>
              </div>
              <div className={`live-pill ${refreshFrequency === "off" ? "paused" : ""}`}>
                <span />
                {refreshFrequency === "off"
                  ? t("table.paused")
                  : t("table.live", { interval: refreshLabel(refreshFrequency) })}
              </div>
            </div>

            <div className="port-table" role="table" aria-label={t("table.aria")}>
              <div className="table-row table-heading" role="row">
                <span>{t("column.port")}</span>
                <span>{t("column.protocol")}</span>
                <span>{t("column.address")}</span>
                <span>{t("column.process")}</span>
                <span>{t("column.path")}</span>
                <span>{t("column.status")}</span>
                <span>{t("column.actions")}</span>
              </div>

              {loading && rows.length === 0 ? (
                <div className="empty-state">
                  <Loader2 className="spin" size={24} />
                  <span>{t("empty.scanning")}</span>
                </div>
              ) : null}

              {!loading && visibleRows.length === 0 ? (
                <div className="empty-state">
                  <Eye size={24} />
                  <span>{t("empty.noMatches")}</span>
                </div>
              ) : null}

              {visibleRows.map((row) => {
                const isSelected = selectedRow?.id === row.id;
                const isFavorite = favorites.has(row.id);
                const busy = actionPid !== null && row.pid === actionPid;

                return (
                  <button
                    key={row.id}
                    className={`table-row data-row ${isSelected ? "selected" : ""}`}
                    type="button"
                    role="row"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <span className="port-cell">
                      <strong>{row.port}</strong>
                      {isWebDevPort(row.port) ? <Zap size={13} /> : null}
                    </span>
                    <span>{row.protocol}</span>
                    <span className="mono">{row.localAddress}</span>
                    <span>
                      <strong>{row.processName ?? t("process.unknown")}</strong>
                      <small>{row.pid === null ? t("process.noPid") : `PID ${row.pid}`}</small>
                    </span>
                    <span className="path-cell" title={row.executablePath ?? undefined}>
                      {formatPath(row.executablePath, t("path.unavailable"))}
                    </span>
                    <span>
                      <span className={`status-badge ${row.permissionState}`}>
                        {row.permissionState === "available" ? <CheckCircle2 size={13} /> : <ShieldAlert size={13} />}
                        {permissionLabel(row)}
                      </span>
                    </span>
                    <span className="row-actions">
                      <button
                        className="icon-button compact"
                        type="button"
                        title={isFavorite ? t("favorite.remove") : t("favorite.add")}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavorite(row);
                        }}
                      >
                        {isFavorite ? <StarOff size={15} /> : <Star size={15} />}
                      </button>
                      <button
                        className="icon-button compact"
                        type="button"
                        title={row.executablePath ? t("action.revealLocation") : t("path.unavailable")}
                        disabled={!row.executablePath || busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleReveal(row);
                        }}
                      >
                        <FolderOpen size={15} />
                      </button>
                      <button
                        className="icon-button compact danger"
                        type="button"
                        title={row.pid === null ? t("process.noPidAvailable") : t("action.killProcess")}
                        disabled={row.pid === null || busy}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingKill(row);
                        }}
                      >
                        {busy ? <Loader2 className="spin" size={15} /> : <Square size={15} />}
                      </button>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="inspector">
            {selectedRow ? (
              <>
                <div className="inspector-head">
                  <div className="process-icon">
                    <TerminalSquare size={23} />
                  </div>
                  <div>
                    <h2>{selectedRow.processName ?? t("process.unknownProcess")}</h2>
                    <p>{selectedRow.pid === null ? t("process.pidUnavailable") : `PID ${selectedRow.pid}`}</p>
                  </div>
                </div>

                <div className="inspector-actions">
                  <button
                    type="button"
                    disabled={!selectedRow.executablePath || selectedRow.pid === actionPid}
                    onClick={() => void handleReveal(selectedRow)}
                  >
                    <FolderOpen size={16} />
                    {t("action.reveal")}
                  </button>
                  <button
                    type="button"
                    disabled={selectedRow.pid === null || selectedRow.pid === actionPid}
                    onClick={() => void handleRefreshProcess(selectedRow)}
                  >
                    <RefreshCw size={16} />
                    {t("action.refresh")}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={selectedRow.pid === null || selectedRow.pid === actionPid}
                    onClick={() => setPendingKill(selectedRow)}
                  >
                    <Trash2 size={16} />
                    {t("action.kill")}
                  </button>
                </div>

                <dl className="detail-list">
                  <div>
                    <dt>{t("detail.ports")}</dt>
                    <dd>{summarizePorts(selectedPidRows.length ? selectedPidRows : [selectedRow], t("ports.none"))}</dd>
                  </div>
                  <div>
                    <dt>{t("detail.address")}</dt>
                    <dd className="mono">{selectedRow.localAddress}</dd>
                  </div>
                  <div>
                    <dt>{t("detail.executable")}</dt>
                    <dd title={selectedRow.executablePath ?? undefined}>{selectedRow.executablePath ?? t("value.unavailable")}</dd>
                  </div>
                  <div>
                    <dt>{t("detail.command")}</dt>
                    <dd>{selectedRow.commandLine ?? t("value.unavailable")}</dd>
                  </div>
                </dl>

                {selectedRow.readErrors.length > 0 ? (
                  <div className="notice">
                    <ShieldAlert size={16} />
                    <div>
                      <strong>{t("notice.limitedMetadata")}</strong>
                      <p>{selectedRow.readErrors.join("; ")}</p>
                    </div>
                  </div>
                ) : null}

                <div className="socket-list">
                  <div className="section-label">{t("sockets.title")}</div>
                  {(selectedPidRows.length ? selectedPidRows : [selectedRow]).map((socket) => (
                    <div className="socket-item" key={socket.id}>
                      <span>
                        {socket.protocol} {socket.localAddress}:{socket.port}
                      </span>
                      <ExternalLink size={13} />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-inspector">{t("empty.selectPort")}</div>
            )}
          </aside>
        </section>
      </main>

      {pendingKill ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingKill(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="kill-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon danger">
              <Trash2 size={22} />
            </div>
            <h2 id="kill-title">{t("modal.kill.title")}</h2>
            <p>{t("modal.kill.body", { process: rowTitle(pendingKill), port: pendingKill.port })}</p>
            <div className="modal-path">{pendingKill.executablePath ?? t("path.unavailable")}</div>
            <div className="modal-actions">
              <button type="button" onClick={() => setPendingKill(null)}>
                {t("action.cancel")}
              </button>
              <button className="danger" type="button" onClick={() => void handleKill(pendingKill)}>
                {t("action.killProcess")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {needsElevation ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setNeedsElevation(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="elevation-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon warning">
              <ShieldAlert size={22} />
            </div>
            <h2 id="elevation-title">{t("modal.elevation.title")}</h2>
            <p>{t("modal.elevation.body", { process: rowTitle(needsElevation) })}</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setNeedsElevation(null)}>
                {t("action.cancel")}
              </button>
              <button className="danger" type="button" onClick={() => void handleKill(needsElevation, true)}>
                {t("action.elevateKill")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
