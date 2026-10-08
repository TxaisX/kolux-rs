// What the Rust side reports about this running app (see the `app_info` command in src-tauri).
export type AppInfo = { version: string; profileDir: string; startCount: number };

export function windowTitle(info: AppInfo | null): string {
  return info ? `Kolux RS ${info.version}` : "Kolux RS";
}
