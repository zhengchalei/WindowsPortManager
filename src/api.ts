import { invoke } from "@tauri-apps/api/core";
import type { AppError, PortUsage } from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

function unavailable(message: string): AppError {
  return { code: "Unavailable", message };
}

function previewRows(): PortUsage[] {
  return [
    {
      id: "TCP-127.0.0.1-3000-4242",
      protocol: "TCP",
      localAddress: "127.0.0.1",
      port: 3000,
      pid: 4242,
      processName: "node",
      executablePath: "C:\\Projects\\web-app\\node.exe",
      commandLine: "node server.js",
      status: "listening",
      permissionState: "available",
      readErrors: [],
    },
    {
      id: "TCP-0.0.0.0-5173-5173",
      protocol: "TCP",
      localAddress: "0.0.0.0",
      port: 5173,
      pid: 5173,
      processName: "vite",
      executablePath: "C:\\Projects\\web-app\\node_modules\\.bin\\vite.cmd",
      commandLine: "vite --host 127.0.0.1",
      status: "listening",
      permissionState: "available",
      readErrors: [],
    },
    {
      id: "TCP-0.0.0.0-5432-15432",
      protocol: "TCP",
      localAddress: "0.0.0.0",
      port: 5432,
      pid: 15432,
      processName: "postgres",
      executablePath: null,
      commandLine: null,
      status: "listening",
      permissionState: "limited",
      readErrors: ["executable path unavailable outside the desktop runtime"],
    },
  ];
}

export async function listPortUsage(): Promise<PortUsage[]> {
  if (!isTauriRuntime()) return previewRows();
  return invoke<PortUsage[]>("list_port_usage");
}

export async function refreshProcess(pid: number): Promise<PortUsage[]> {
  if (!isTauriRuntime()) return previewRows().filter((row) => row.pid === pid);
  return invoke<PortUsage[]>("refresh_process", { pid });
}

export async function killProcess(pid: number, elevated = false): Promise<void> {
  if (!isTauriRuntime()) throw unavailable("Killing processes is available in the desktop app.");
  return invoke<void>("kill_process", { pid, elevated });
}

export async function revealProcess(path: string | null, pid?: number | null): Promise<void> {
  if (!isTauriRuntime()) throw unavailable("Revealing files is available in the desktop app.");
  return invoke<void>("reveal_process", { path, pid });
}
