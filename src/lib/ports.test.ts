import { describe, expect, it } from "vitest";
import type { KillRecord, PortUsage } from "../types";
import { filterPorts, getPermissionLabel, rowMatchesSearch, summarizePorts } from "./ports";

const baseRows: PortUsage[] = [
  {
    id: "TCP-127.0.0.1-3000-10",
    protocol: "TCP",
    localAddress: "127.0.0.1",
    port: 3000,
    pid: 10,
    processName: "node",
    executablePath: "C:/Program Files/node/node.exe",
    commandLine: "node server.js",
    status: "listening",
    permissionState: "available",
    readErrors: [],
  },
  {
    id: "TCP-0.0.0.0-5432-11",
    protocol: "TCP",
    localAddress: "0.0.0.0",
    port: 5432,
    pid: 11,
    processName: "postgres",
    executablePath: null,
    commandLine: null,
    status: "listening",
    permissionState: "limited",
    readErrors: ["executable path unavailable"],
  },
  {
    id: "UDP-0.0.0.0-1900-null",
    protocol: "UDP",
    localAddress: "0.0.0.0",
    port: 1900,
    pid: null,
    processName: null,
    executablePath: null,
    commandLine: null,
    status: "unknown",
    permissionState: "needsElevation",
    readErrors: ["owner unavailable"],
  },
];

describe("port filtering", () => {
  it("searches by port, process name, pid, path, and command line", () => {
    expect(rowMatchesSearch(baseRows[0], "3000")).toBe(true);
    expect(rowMatchesSearch(baseRows[0], "NODE")).toBe(true);
    expect(rowMatchesSearch(baseRows[0], "server.js")).toBe(true);
    expect(rowMatchesSearch(baseRows[0], "missing")).toBe(false);
  });

  it("filters web developer ports and protocol", () => {
    const result = filterPorts({
      rows: baseRows,
      activeFilter: "web",
      protocolFilter: "TCP",
      search: "",
      selectedQuickPort: null,
      favorites: new Set(),
      recentlyKilled: [],
      occupiedOnly: true,
    });

    expect(result.map((row) => row.port)).toEqual([3000, 5432]);
  });

  it("filters favorites and recently killed rows", () => {
    const killed: KillRecord[] = [
      { pid: 11, processName: "postgres", ports: [5432], killedAt: new Date().toISOString() },
    ];

    expect(
      filterPorts({
        rows: baseRows,
        activeFilter: "favorites",
        protocolFilter: "ALL",
        search: "",
        selectedQuickPort: null,
        favorites: new Set(["TCP-127.0.0.1-3000-10"]),
        recentlyKilled: killed,
        occupiedOnly: false,
      }).map((row) => row.processName),
    ).toEqual(["node"]);

    expect(
      filterPorts({
        rows: baseRows,
        activeFilter: "recentlyKilled",
        protocolFilter: "ALL",
        search: "",
        selectedQuickPort: null,
        favorites: new Set(),
        recentlyKilled: killed,
        occupiedOnly: false,
      }).map((row) => row.processName),
    ).toEqual(["postgres"]);
  });

  it("summarizes ports compactly", () => {
    expect(summarizePorts(baseRows)).toBe("1900, 3000, 5432");
    expect(
      summarizePorts([
        ...baseRows,
        { ...baseRows[0], id: "extra-1", port: 8080 },
        { ...baseRows[0], id: "extra-2", port: 9000 },
      ]),
    ).toBe("1900, 3000, 5432 +2");
  });

  it("maps permission labels", () => {
    expect(getPermissionLabel(baseRows[0])).toBe("Ready");
    expect(getPermissionLabel(baseRows[1])).toBe("Limited");
    expect(getPermissionLabel(baseRows[2])).toBe("Needs elevation");
  });
});
