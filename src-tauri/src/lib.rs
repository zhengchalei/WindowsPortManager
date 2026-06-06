use netstat2::{
    get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PortProtocol {
    #[serde(rename = "TCP")]
    Tcp,
    #[serde(rename = "UDP")]
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PermissionState {
    Available,
    Limited,
    NeedsElevation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortUsage {
    pub id: String,
    pub protocol: PortProtocol,
    pub local_address: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub executable_path: Option<String>,
    pub command_line: Option<String>,
    pub status: String,
    pub permission_state: PermissionState,
    pub read_errors: Vec<String>,
}

#[derive(Debug, Error)]
pub enum PortManagerError {
    #[error("Administrator permission is required for this action.")]
    NeedsElevation,
    #[error("Process was not found.")]
    NotFound,
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Operation is unavailable: {0}")]
    Unavailable(String),
    #[error("{0}")]
    Unknown(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedError {
    pub code: &'static str,
    pub message: String,
    pub detail: Option<String>,
}

impl Serialize for PortManagerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let (code, detail) = match self {
            PortManagerError::NeedsElevation => ("NeedsElevation", None),
            PortManagerError::NotFound => ("NotFound", None),
            PortManagerError::InvalidInput(detail) => ("InvalidInput", Some(detail.clone())),
            PortManagerError::Unavailable(detail) => ("Unavailable", Some(detail.clone())),
            PortManagerError::Unknown(detail) => ("Unknown", Some(detail.clone())),
        };

        SerializedError {
            code,
            message: self.to_string(),
            detail,
        }
        .serialize(serializer)
    }
}

type CommandResult<T> = Result<T, PortManagerError>;

#[tauri::command]
fn list_port_usage() -> CommandResult<Vec<PortUsage>> {
    collect_port_usage(None)
}

#[tauri::command]
fn refresh_process(pid: u32) -> CommandResult<Vec<PortUsage>> {
    if pid == 0 {
        return Err(PortManagerError::InvalidInput("pid must be greater than 0".into()));
    }

    collect_port_usage(Some(pid))
}

#[tauri::command]
fn kill_process(app: AppHandle, pid: u32, elevated: bool) -> CommandResult<()> {
    if pid == 0 {
        return Err(PortManagerError::InvalidInput("pid must be greater than 0".into()));
    }

    if elevated {
        return elevated_kill_process(pid);
    }

    match kill_process_normal(pid) {
        Ok(()) => Ok(()),
        Err(error) if looks_like_permission_error(&error) => {
            let _ = app.emit("port-manager://needs-elevation", pid);
            Err(PortManagerError::NeedsElevation)
        }
        Err(error) if looks_like_not_found_error(&error) => Err(PortManagerError::NotFound),
        Err(error) => Err(PortManagerError::Unknown(error)),
    }
}

#[tauri::command]
fn reveal_process(path: Option<String>, pid: Option<u32>) -> CommandResult<()> {
    let path = match path.filter(|value| !value.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => {
            let pid = pid.ok_or_else(|| {
                PortManagerError::InvalidInput("path or pid is required".into())
            })?;
            executable_path_for_pid(pid)?
        }
    };

    if !path.exists() {
        return Err(PortManagerError::NotFound);
    }

    reveal_path(&path)
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_port_usage,
            refresh_process,
            kill_process,
            reveal_process
        ])
        .run(tauri::generate_context!())
        .expect("error while running WindowsPortManager");
}

fn collect_port_usage(pid_filter: Option<u32>) -> CommandResult<Vec<PortUsage>> {
    let address_family_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let protocol_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let sockets = get_sockets_info(address_family_flags, protocol_flags)
        .map_err(|error| PortManagerError::Unavailable(error.to_string()))?;

    let refresh_kind = RefreshKind::nothing().with_processes(ProcessRefreshKind::everything());
    let mut system = System::new_with_specifics(refresh_kind);
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mut rows = Vec::new();

    for socket in sockets {
        let pids = socket.associated_pids;
        let protocol_info = socket.protocol_socket_info;

        if matches!(protocol_info, ProtocolSocketInfo::Tcp(ref tcp) if tcp.state != TcpState::Listen)
        {
            continue;
        }

        let local_address = match &protocol_info {
            ProtocolSocketInfo::Tcp(tcp) => tcp.local_addr.to_string(),
            ProtocolSocketInfo::Udp(udp) => udp.local_addr.to_string(),
        };
        let port = match &protocol_info {
            ProtocolSocketInfo::Tcp(tcp) => tcp.local_port,
            ProtocolSocketInfo::Udp(udp) => udp.local_port,
        };
        let protocol = match &protocol_info {
            ProtocolSocketInfo::Tcp(_) => PortProtocol::Tcp,
            ProtocolSocketInfo::Udp(_) => PortProtocol::Udp,
        };
        let status = match &protocol_info {
            ProtocolSocketInfo::Tcp(_) => "listening",
            ProtocolSocketInfo::Udp(_) => "unknown",
        };

        if pids.is_empty() {
            let row = normalize_port_row(RowInput {
                protocol,
                local_address,
                port,
                pid: None,
                process_name: None,
                executable_path: None,
                command_line: None,
                status: status.into(),
                read_errors: vec!["socket owner unavailable".into()],
            });

            if pid_filter.is_none() {
                rows.push(row);
            }
            continue;
        }

        for pid in pids {
            let pid = pid as u32;
            if pid_filter.is_some_and(|filter| filter != pid) {
                continue;
            }

            let process = system.process(Pid::from_u32(pid));
            let (process_name, executable_path, command_line, mut read_errors) =
                process_metadata(process);

            let row = normalize_port_row(RowInput {
                protocol: protocol.clone(),
                local_address: local_address.clone(),
                port,
                pid: Some(pid),
                process_name,
                executable_path,
                command_line,
                status: status.into(),
                read_errors: {
                    if process.is_none() {
                        read_errors.push("process metadata unavailable".into());
                    }
                    read_errors
                },
            });

            rows.push(row);
        }
    }

    Ok(dedupe_and_sort(rows))
}

struct RowInput {
    protocol: PortProtocol,
    local_address: String,
    port: u16,
    pid: Option<u32>,
    process_name: Option<String>,
    executable_path: Option<String>,
    command_line: Option<String>,
    status: String,
    read_errors: Vec<String>,
}

fn normalize_port_row(input: RowInput) -> PortUsage {
    let permission_state = permission_state_for(input.pid, &input.executable_path, &input.read_errors);
    let protocol_label = match input.protocol {
        PortProtocol::Tcp => "TCP",
        PortProtocol::Udp => "UDP",
    };

    PortUsage {
        id: format!(
            "{}-{}-{}-{}",
            protocol_label,
            input.local_address,
            input.port,
            input.pid
                .map(|pid| pid.to_string())
                .unwrap_or_else(|| "unknown".into())
        ),
        protocol: input.protocol,
        local_address: input.local_address,
        port: input.port,
        pid: input.pid,
        process_name: input.process_name,
        executable_path: input.executable_path,
        command_line: input.command_line,
        status: input.status,
        permission_state,
        read_errors: input.read_errors,
    }
}

fn permission_state_for(
    pid: Option<u32>,
    executable_path: &Option<String>,
    read_errors: &[String],
) -> PermissionState {
    if pid.is_none() {
        return PermissionState::NeedsElevation;
    }

    if executable_path.is_none() || !read_errors.is_empty() {
        return PermissionState::Limited;
    }

    PermissionState::Available
}

fn process_metadata(
    process: Option<&sysinfo::Process>,
) -> (Option<String>, Option<String>, Option<String>, Vec<String>) {
    let Some(process) = process else {
        return (None, None, None, Vec::new());
    };

    let mut errors = Vec::new();
    let process_name = Some(process.name().to_string_lossy().to_string());
    let executable_path = process.exe().map(|path| path.to_string_lossy().to_string());

    if executable_path.is_none() {
        errors.push("executable path unavailable".into());
    }

    let command_line = if process.cmd().is_empty() {
        errors.push("command line unavailable".into());
        None
    } else {
        Some(
            process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
        )
    };

    (process_name, executable_path, command_line, errors)
}

fn executable_path_for_pid(pid: u32) -> CommandResult<PathBuf> {
    if pid == 0 {
        return Err(PortManagerError::InvalidInput("pid must be greater than 0".into()));
    }

    let refresh_kind = RefreshKind::nothing().with_processes(ProcessRefreshKind::everything());
    let mut system = System::new_with_specifics(refresh_kind);
    let pid = Pid::from_u32(pid);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

    let process = system.process(pid).ok_or(PortManagerError::NotFound)?;
    process
        .exe()
        .map(Path::to_path_buf)
        .ok_or_else(|| PortManagerError::Unavailable("executable path unavailable".into()))
}

fn dedupe_and_sort(rows: Vec<PortUsage>) -> Vec<PortUsage> {
    let mut by_id = BTreeMap::new();
    for row in rows {
        by_id.entry(row.id.clone()).or_insert(row);
    }

    by_id
        .into_values()
        .collect::<Vec<_>>()
        .tap_mut(|items| {
            items.sort_by(|a, b| {
                a.port
                    .cmp(&b.port)
                    .then_with(|| protocol_sort_key(&a.protocol).cmp(&protocol_sort_key(&b.protocol)))
                    .then_with(|| a.local_address.cmp(&b.local_address))
                    .then_with(|| a.pid.cmp(&b.pid))
            });
        })
}

fn protocol_sort_key(protocol: &PortProtocol) -> u8 {
    match protocol {
        PortProtocol::Tcp => 0,
        PortProtocol::Udp => 1,
    }
}

trait TapMut: Sized {
    fn tap_mut(mut self, func: impl FnOnce(&mut Self)) -> Self {
        func(&mut self);
        self
    }
}

impl<T> TapMut for T {}

fn kill_process_normal(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|error| error.to_string())?;
        return command_result(output);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        let output = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output()
            .map_err(|error| error.to_string())?;
        return command_result(output);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        Err("kill is not supported on this platform".into())
    }
}

fn elevated_kill_process(pid: u32) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let escaped_command = format!("taskkill /PID {} /T /F", pid).replace('\'', "''");
        let ps_command = format!(
            "Start-Process -FilePath cmd.exe -ArgumentList '/c {}' -Verb RunAs -WindowStyle Hidden -Wait",
            escaped_command
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_command])
            .output()
            .map_err(|error| PortManagerError::Unknown(error.to_string()))?;

        return command_result(output).map_err(|error| {
            if looks_like_permission_error(&error) {
                PortManagerError::NeedsElevation
            } else if looks_like_not_found_error(&error) {
                PortManagerError::NotFound
            } else {
                PortManagerError::Unknown(error)
            }
        });
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"kill -TERM {}\" with administrator privileges",
            pid
        );
        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|error| PortManagerError::Unknown(error.to_string()))?;

        return command_result(output).map_err(|error| {
            if looks_like_permission_error(&error) {
                PortManagerError::NeedsElevation
            } else if looks_like_not_found_error(&error) {
                PortManagerError::NotFound
            } else {
                PortManagerError::Unknown(error)
            }
        });
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("pkexec")
            .args(["kill", "-TERM", &pid.to_string()])
            .output()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    PortManagerError::Unavailable("pkexec is not installed".into())
                } else {
                    PortManagerError::Unknown(error.to_string())
                }
            })?;

        return command_result(output).map_err(|error| {
            if looks_like_permission_error(&error) {
                PortManagerError::NeedsElevation
            } else if looks_like_not_found_error(&error) {
                PortManagerError::NotFound
            } else {
                PortManagerError::Unknown(error)
            }
        });
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = pid;
        Err(PortManagerError::Unavailable(
            "elevated kill is not supported on this platform".into(),
        ))
    }
}

fn command_result(output: std::process::Output) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = match (stderr.is_empty(), stdout.is_empty()) {
        (false, false) => format!("{stderr}; {stdout}"),
        (false, true) => stderr,
        (true, false) => stdout,
        (true, true) => format!("command exited with {}", output.status),
    };
    Err(message)
}

fn looks_like_permission_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("not permitted")
        || lower.contains("operation not permitted")
        || lower.contains("拒绝访问")
        || lower.contains("权限")
}

fn looks_like_not_found_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("not found")
        || lower.contains("no such process")
        || lower.contains("not running")
        || lower.contains("找不到")
}

fn reveal_path(path: &Path) -> CommandResult<()> {
    #[cfg(target_os = "windows")]
    {
        let arg = format!("/select,{}", path.display());
        let output = Command::new("explorer")
            .arg(arg)
            .output()
            .map_err(|error| PortManagerError::Unknown(error.to_string()))?;
        return command_result(output).map_err(PortManagerError::Unknown);
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .output()
            .map_err(|error| PortManagerError::Unknown(error.to_string()))?;
        return command_result(output).map_err(PortManagerError::Unknown);
    }

    #[cfg(target_os = "linux")]
    {
        let target = if path.is_dir() {
            path.to_path_buf()
        } else {
            path.parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| PortManagerError::Unavailable("path has no parent folder".into()))?
        };
        let output = Command::new("xdg-open")
            .arg(target)
            .output()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    PortManagerError::Unavailable("xdg-open is not installed".into())
                } else {
                    PortManagerError::Unknown(error.to_string())
                }
            })?;
        return command_result(output).map_err(PortManagerError::Unknown);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err(PortManagerError::Unavailable(
            "reveal is not supported on this platform".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_id_and_permission_state_are_normalized() {
        let row = normalize_port_row(RowInput {
            protocol: PortProtocol::Tcp,
            local_address: "127.0.0.1".into(),
            port: 3000,
            pid: Some(42),
            process_name: Some("node".into()),
            executable_path: Some("C:/Program Files/node/node.exe".into()),
            command_line: Some("node server.js".into()),
            status: "listening".into(),
            read_errors: Vec::new(),
        });

        assert_eq!(row.id, "TCP-127.0.0.1-3000-42");
        assert_eq!(row.permission_state, PermissionState::Available);
    }

    #[test]
    fn missing_owner_requires_elevation_context() {
        let row = normalize_port_row(RowInput {
            protocol: PortProtocol::Udp,
            local_address: "0.0.0.0".into(),
            port: 1900,
            pid: None,
            process_name: None,
            executable_path: None,
            command_line: None,
            status: "unknown".into(),
            read_errors: vec!["socket owner unavailable".into()],
        });

        assert_eq!(row.id, "UDP-0.0.0.0-1900-unknown");
        assert_eq!(row.permission_state, PermissionState::NeedsElevation);
    }

    #[test]
    fn missing_process_path_is_limited_not_fatal() {
        let row = normalize_port_row(RowInput {
            protocol: PortProtocol::Tcp,
            local_address: "0.0.0.0".into(),
            port: 5432,
            pid: Some(7),
            process_name: Some("postgres".into()),
            executable_path: None,
            command_line: None,
            status: "listening".into(),
            read_errors: vec!["executable path unavailable".into()],
        });

        assert_eq!(row.permission_state, PermissionState::Limited);
    }

    #[test]
    fn error_serialization_uses_frontend_codes() {
        let value = serde_json::to_value(PortManagerError::NeedsElevation).unwrap();

        assert_eq!(value["code"], "NeedsElevation");
        assert_eq!(
            value["message"],
            "Administrator permission is required for this action."
        );
    }

    #[test]
    fn command_error_classification_handles_common_messages() {
        assert!(looks_like_permission_error("Access is denied."));
        assert!(looks_like_permission_error("Operation not permitted"));
        assert!(looks_like_not_found_error("No such process"));
        assert!(looks_like_not_found_error("找不到此进程"));
    }

    #[test]
    fn dedupe_keeps_one_row_per_socket_owner() {
        let row = normalize_port_row(RowInput {
            protocol: PortProtocol::Tcp,
            local_address: "127.0.0.1".into(),
            port: 3000,
            pid: Some(42),
            process_name: Some("node".into()),
            executable_path: Some("node.exe".into()),
            command_line: Some("node server.js".into()),
            status: "listening".into(),
            read_errors: Vec::new(),
        });

        let result = dedupe_and_sort(vec![row.clone(), row]);
        assert_eq!(result.len(), 1);
    }
}
