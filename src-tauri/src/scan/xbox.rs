//! Xbox / Microsoft Store (PC Game Pass) games: installed GDK games, found by
//! looking for a MicrosoftGame.config in each Store package. There is no
//! public API for the full owned library, so only installed games appear.

#[allow(unused_imports)]
use super::{Game, Launch};

#[cfg(windows)]
const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$names = @{}
foreach ($s in Get-StartApps) { if ($s.AppID) { $names[$s.AppID] = $s.Name } }
$out = @()
foreach ($p in Get-AppxPackage) {
  if ($p.IsFramework -or $p.SignatureKind -ne 'Store') { continue }
  $loc = $p.InstallLocation
  if (-not $loc) { continue }
  $cfg = Join-Path $loc 'MicrosoftGame.config'
  if (-not (Test-Path -LiteralPath $cfg)) { continue }
  $x = $null
  try { [xml]$x = Get-Content -LiteralPath $cfg -Raw } catch { }
  $appId = 'Game'
  try { $appId = @((Get-AppxPackageManifest $p).Package.Applications.Application)[0].Id } catch { }
  $aumid = "$($p.PackageFamilyName)!$appId"
  $name = $names[$aumid]
  if (-not $name -and $x) { $name = $x.Game.ShellVisuals.DefaultDisplayName }
  if (-not $name -or $name -like 'ms-resource*') { $name = $p.Name }
  $logo = $null
  if ($x) {
    $logo = $x.Game.ShellVisuals.Square480x480Logo
    if (-not $logo) { $logo = $x.Game.ShellVisuals.Square150x150Logo }
  }
  $out += [pscustomobject]@{ name = $name; aumid = $aumid; pfn = $p.PackageFamilyName; loc = $loc; logo = $logo }
}
ConvertTo-Json -InputObject @($out) -Compress
"#;

#[cfg(not(windows))]
pub fn scan() -> Result<Option<Vec<Game>>, String> {
    Ok(None)
}

#[cfg(windows)]
pub fn scan() -> Result<Option<Vec<Game>>, String> {
    use std::path::Path;

    let out = super::hidden_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .output()
        .map_err(|e| format!("couldn't run PowerShell: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.trim().trim_start_matches('\u{feff}');
    if text.is_empty() {
        return Ok(None);
    }
    let v: serde_json::Value = serde_json::from_str(text).map_err(|e| format!("unexpected output: {e}"))?;
    let list = match v {
        serde_json::Value::Array(a) => a,
        o @ serde_json::Value::Object(_) => vec![o],
        _ => vec![],
    };
    if list.is_empty() {
        return Ok(None);
    }
    let games = list
        .into_iter()
        .filter_map(|g| {
            let name = g["name"].as_str()?.to_string();
            let aumid = g["aumid"].as_str()?.to_string();
            let pfn = g["pfn"].as_str().unwrap_or(&aumid).to_string();
            let loc = g["loc"].as_str().unwrap_or("").to_string();
            let cover = g["logo"]
                .as_str()
                .map(|l| Path::new(&loc).join(l))
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().into_owned());
            Some(Game {
                id: format!("xbox:{pfn}"),
                source: "Xbox".into(),
                title: name,
                installed: true,
                launch: Launch::Uri { uri: format!(r"shell:AppsFolder\{aumid}") },
                install_dir: (!loc.is_empty()).then_some(loc),
                cover,
                playtime_min: None,
                last_played: None,
                store_url: None,
                size_bytes: None,
            })
        })
        .collect();
    Ok(Some(games))
}
