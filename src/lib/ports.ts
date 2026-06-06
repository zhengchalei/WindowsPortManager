import type { KillRecord, PortFilter, PortUsage, ProtocolFilter } from "../types";

export const QUICK_PORTS = [3000, 5173, 8000, 8080, 5432, 6379] as const;

export function isWebDevPort(port: number): boolean {
  return QUICK_PORTS.includes(port as (typeof QUICK_PORTS)[number]);
}

export function rowMatchesSearch(row: PortUsage, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = [
    row.port.toString(),
    row.protocol,
    row.localAddress,
    row.pid?.toString() ?? "",
    row.processName ?? "",
    row.executablePath ?? "",
    row.commandLine ?? "",
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalized);
}

type FilterPortsArgs = {
  rows: PortUsage[];
  activeFilter: PortFilter;
  protocolFilter: ProtocolFilter;
  search: string;
  selectedQuickPort: number | null;
  favorites: Set<string>;
  recentlyKilled: KillRecord[];
  occupiedOnly: boolean;
};

export function filterPorts({
  rows,
  activeFilter,
  protocolFilter,
  search,
  selectedQuickPort,
  favorites,
  recentlyKilled,
  occupiedOnly,
}: FilterPortsArgs): PortUsage[] {
  const recentlyKilledPids = new Set(recentlyKilled.map((item) => item.pid));

  return rows
    .filter((row) => {
      if (protocolFilter !== "ALL" && row.protocol !== protocolFilter) return false;
      if (selectedQuickPort !== null && row.port !== selectedQuickPort) return false;
      if (occupiedOnly && row.pid === null) return false;
      if (!rowMatchesSearch(row, search)) return false;

      if (activeFilter === "web") return isWebDevPort(row.port);
      if (activeFilter === "favorites") return favorites.has(row.id);
      if (activeFilter === "recentlyKilled") {
        return row.pid !== null && recentlyKilledPids.has(row.pid);
      }

      return true;
    })
    .sort((a, b) => {
      if (a.port !== b.port) return a.port - b.port;
      if (a.protocol !== b.protocol) return a.protocol.localeCompare(b.protocol);
      return a.localAddress.localeCompare(b.localAddress);
    });
}

export function summarizePorts(rows: PortUsage[], emptyLabel = "No ports"): string {
  const ports = [...new Set(rows.map((row) => row.port))].sort((a, b) => a - b);
  if (ports.length === 0) return emptyLabel;
  if (ports.length <= 3) return ports.join(", ");
  return `${ports.slice(0, 3).join(", ")} +${ports.length - 3}`;
}

export function groupByPid(rows: PortUsage[]): Map<number, PortUsage[]> {
  return rows.reduce((map, row) => {
    if (row.pid === null) return map;
    const current = map.get(row.pid) ?? [];
    current.push(row);
    map.set(row.pid, current);
    return map;
  }, new Map<number, PortUsage[]>());
}

export function getPermissionLabel(
  row: PortUsage,
  labels = {
    needsElevation: "Needs elevation",
    limited: "Limited",
    ready: "Ready",
  },
): string {
  if (row.permissionState === "needsElevation") return labels.needsElevation;
  if (row.permissionState === "limited") return labels.limited;
  return labels.ready;
}
