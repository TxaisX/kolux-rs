<#
.SYNOPSIS
  Clean-room firewall check for the Kolux RS spec files.
.DESCRIPTION
  Greps the behaviour spec for things that must never cross from the old code base:
  source paths, code-file names, camelCase / snake_case / SCREAMING_SNAKE identifiers,
  multi-hump PascalCase component names, code keywords, inline or fenced code that is not a
  `kolux` command, and the old app's library names. Tokens in scripts/firewall-allowlist.txt
  are accepted. Prints every hit as file:line [rule] match and exits 1 when hits > 0.
.EXAMPLE
  powershell -NoProfile -File scripts/firewall-check.ps1            # all spec files
  powershell -NoProfile -File scripts/firewall-check.ps1 -Path spec/03-terminals-panes.md
#>
param(
  [string[]]$Path,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Path -or $Path.Count -eq 0) {
  $Path = @('SPEC.md', 'PRIORITIES.md', 'COMPAT.md', 'DECISIONS.md', 'PROVENANCE.md') |
    ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ }
  $specDir = Join-Path $root 'spec'
  if (Test-Path $specDir) { $Path += (Get-ChildItem $specDir -Filter *.md | ForEach-Object FullName) }
}
$allowFile = Join-Path $PSScriptRoot 'firewall-allowlist.txt'
$allowExact = New-Object 'System.Collections.Generic.HashSet[string]'
$allowRe = @()
foreach ($line in Get-Content $allowFile -Encoding UTF8) {
  $t = $line.Trim()
  if (-not $t -or $t.StartsWith('#')) { continue }
  if ($t.StartsWith('re:')) { $allowRe += $t.Substring(3) } else { [void]$allowExact.Add($t) }
}
function Allowed([string]$m) {
  if ($allowExact.Contains($m)) { return $true }
  foreach ($r in $allowRe) { if ($m -match $r) { return $true } }
  return $false
}
$rules = @(
  @{ name = 'old-src-path';   re = '(?<![\w-])(src|tests|docs|resources|scripts|cli|relay)[\\/][\w.\\/-]+' },
  @{ name = 'code-file';      re = '(?<![\w/.-])[\w.-]+\.(tsx?|jsx?|mjs|cjs|json|ya?ml|html|css|scss|ps1|sh|sql|md|svg|webp|png)(?![\w-])' },
  @{ name = 'camelCase';      re = '\b[a-z]+(?:[A-Z][a-z0-9]+)+\b' },
  @{ name = 'snake_case';     re = '\b[a-z0-9]+(?:_[a-z0-9]+)+\b' },
  @{ name = 'SCREAMING_SNAKE';re = '\b[A-Z0-9]{2,}(?:_[A-Z0-9]+)+\b' },
  @{ name = 'PascalCase-3';   re = '\b(?:[A-Z][a-z0-9]+){3,}\b' },
  @{ name = 'PascalCase-sfx'; re = '\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*(Pane|Service|Handler|Manager|Store|Dialog|Provider|Controller|Component|Hook|Types|Utils|Config|Registry|Daemon|Server|Client|Module|Reducer|Context|Bridge)\b' },
  @{ name = 'code-keyword';   re = '=>|\bconst\s+\w+\s*=|\bfunction\s*\w*\s*\(|\bimport\s+[{\w*]|\brequire\(|\bexport\s+(const|function|default|class)\b|\bawait\s+\w+\(' },
  @{ name = 'old-library';    re = '\b(?i:electron|pnpm|node-pty|zustand|tailwind|radix|lucide|vitest|playwright|xterm|monaco|vite|electron-builder|electron-updater)\b|\bReact\b' }
)
$hits = 0
foreach ($file in $Path) {
  if (-not (Test-Path $file)) { Write-Warning "missing: $file"; continue }
  $rel = $file
  try { $rel = [System.IO.Path]::GetRelativePath($root, (Resolve-Path $file).Path) } catch {}
  $lines = @(Get-Content $file -Encoding UTF8)
  $inFence = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    $n = $i + 1
    # fenced blocks: allowed only when the first content line is a kolux command
    if ($line -match '^\s*```') {
      if (-not $inFence) {
        $inFence = $true
        $first = if ($i + 1 -lt $lines.Count) { $lines[$i + 1].Trim() } else { '' }
        if ($first -notmatch '^(\$ )?kolux(\s|$)') {
          $hits++; if (-not $Quiet) { "{0}:{1} [fenced-code] block does not start with a kolux command: {2}" -f $rel, $n, $first }
        }
      } else { $inFence = $false }
      continue
    }
    if ($inFence) { continue }
    # inline backticks must be kolux commands, flags, or allowlisted interface tokens
    foreach ($m in [regex]::Matches($line, '`([^`]+)`')) {
      $inner = $m.Groups[1].Value.Trim()
      if (-not (Allowed $inner)) {
        $hits++; if (-not $Quiet) { "{0}:{1} [inline-code] {2}" -f $rel, $n, $inner }
      }
    }
    $stripped = [regex]::Replace($line, '`[^`]+`', ' ')
    foreach ($rule in $rules) {
      foreach ($m in [regex]::Matches($stripped, $rule.re)) {
        $tok = $m.Value
        if (Allowed $tok) { continue }
        $hits++; if (-not $Quiet) { "{0}:{1} [{2}] {3}" -f $rel, $n, $rule.name, $tok }
      }
    }
  }
}
"firewall-check: {0} hit(s) across {1} file(s)" -f $hits, $Path.Count
if ($hits -gt 0) { exit 1 } else { exit 0 }
