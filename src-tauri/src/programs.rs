//! Programs tab: every app in the Start menu (desktop programs and Store
//! apps), with icons extracted at 128px. Each launches through
//! `shell:AppsFolder\<AppID>`, the same way the Start menu does.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
}

/// Start-menu entries that aren't really apps.
pub fn is_junk(name: &str) -> bool {
    let n = name.to_lowercase();
    const JUNK: &[&str] = &[
        "uninstall", "readme", "read me", "help", "documentation", "release notes", "license",
        "website", "support", "manual", "changelog", "what's new", "setup", "repair", "configure",
        "debug", "crash report", "error report", "safe mode", "migration", "faq", "eula",
        "web site", "homepage", "online", "update", "installer",
    ];
    JUNK.iter().any(|j| n.contains(j))
}

#[cfg_attr(not(windows), allow(dead_code))]
const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class TgIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  public static bool Save(string item, string png, int size) {
    try {
      IShellItemImageFactory f;
      SHCreateItemFromParsingName(item, IntPtr.Zero, new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), out f);
      IntPtr hb;
      if (f.GetImage(new SIZE { cx = size, cy = size }, 0x4, out hb) != 0) return false;
      try {
        using (Bitmap bmp = Image.FromHbitmap(hb)) {
          Rectangle r = new Rectangle(0, 0, bmp.Width, bmp.Height);
          BitmapData d = bmp.LockBits(r, ImageLockMode.ReadOnly, bmp.PixelFormat);
          try {
            using (Bitmap a = new Bitmap(d.Width, d.Height, d.Stride, PixelFormat.Format32bppArgb, d.Scan0)) { a.Save(png, ImageFormat.Png); }
          } finally { bmp.UnlockBits(d); }
        }
      } finally { DeleteObject(hb); }
      return true;
    } catch { return false; }
  }
}
'@
$iconDir = '__ICON_DIR__'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
$out = @()
foreach ($a in Get-StartApps) {
  if (-not $a.AppID -or -not $a.Name) { continue }
  $safe = ($a.AppID -replace '[^A-Za-z0-9]', '_')
  if ($safe.Length -gt 100) { $safe = $safe.Substring($safe.Length - 100) }
  $png = Join-Path $iconDir ($safe + '.png')
  if (-not (Test-Path -LiteralPath $png)) { [void][TgIcon]::Save("shell:AppsFolder\$($a.AppID)", $png, 128) }
  $icon = $null
  if (Test-Path -LiteralPath $png) { $icon = $png }
  $out += [pscustomobject]@{ id = $a.AppID; name = $a.Name; icon = $icon }
}
ConvertTo-Json -InputObject @($out) -Compress
"#;

#[cfg(windows)]
pub fn scan(icon_dir: &std::path::Path) -> Result<Vec<Program>, String> {
    let dir = icon_dir.to_string_lossy().replace('\'', "''");
    let list = crate::scan::json_list(&crate::scan::run_powershell(&SCRIPT.replace("__ICON_DIR__", &dir))?)?;
    Ok(collect(list))
}

#[cfg(not(windows))]
pub fn scan(_icon_dir: &std::path::Path) -> Result<Vec<Program>, String> {
    Ok(vec![])
}

#[cfg_attr(not(windows), allow(dead_code))]
fn collect(list: Vec<serde_json::Value>) -> Vec<Program> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<Program> = list
        .into_iter()
        .filter_map(|p| {
            let id = p["id"].as_str()?.to_string();
            let name = p["name"].as_str()?.trim().to_string();
            if name.is_empty() || is_junk(&name) || !seen.insert(name.to_lowercase()) {
                return None;
            }
            Some(Program { id, name, icon: p["icon"].as_str().map(str::to_string) })
        })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn filters_junk_and_dupes() {
        let list = vec![
            serde_json::json!({"id":"Chrome","name":"Google Chrome","icon":"C:/i/Chrome.png"}),
            serde_json::json!({"id":"X","name":"Uninstall Foo"}),
            serde_json::json!({"id":"Y","name":"Foo Help"}),
            serde_json::json!({"id":"Chrome2","name":"google chrome"}),
            serde_json::json!({"id":"Spotify","name":"Spotify"}),
        ];
        let p = super::collect(list);
        assert_eq!(p.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Google Chrome", "Spotify"]);
    }
}
