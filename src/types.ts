export type PortProtocol = "TCP" | "UDP";

export type PermissionState = "available" | "limited" | "needsElevation";

export type PortUsage = {
  id: string;
  protocol: PortProtocol;
  localAddress: string;
  port: number;
  pid: number | null;
  processName: string | null;
  executablePath: string | null;
  commandLine: string | null;
  status: "listening" | "unknown";
  permissionState: PermissionState;
  readErrors: string[];
};

export type AppErrorCode =
  | "NeedsElevation"
  | "NotFound"
  | "InvalidInput"
  | "Unavailable"
  | "Unknown";

export type AppError = {
  code: AppErrorCode;
  message: string;
  detail?: string | null;
};

export type PortFilter = "all" | "web" | "favorites" | "recentlyKilled";

export type ProtocolFilter = "ALL" | PortProtocol;

export type KillRecord = {
  pid: number;
  processName: string | null;
  ports: number[];
  killedAt: string;
};
