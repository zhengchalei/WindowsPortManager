# WindowsPortManager

A Tauri 2 desktop app for developer port triage. It shows occupied TCP/UDP ports, the owning process, executable path, command line, and actions for refresh, reveal, and kill.

## Commands

```powershell
npm install
npm run test
npm run build
cargo test --manifest-path .\src-tauri\Cargo.toml
npm run tauri build
```

## Runtime Notes

- Desktop builds use Rust commands for real socket/process data.
- Browser preview uses sample rows so the UI can be checked without Tauri internals.
- Kill and reveal actions are only enabled in the desktop app.
- Permission-limited process data is shown as partial metadata instead of failing the scan.
