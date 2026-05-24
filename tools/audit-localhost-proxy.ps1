$ErrorActionPreference = "Continue"

$Repo = "C:\Projects\capsule-pro"
$OutFile = Join-Path $Repo "tools\audit-runtime-proxy-state-results.txt"

$Lines = New-Object System.Collections.Generic.List[string]

function Add-Section($Name) {
  $Lines.Add("")
  $Lines.Add("===== $Name =====")
}

function Add-Cmd($Name, $ScriptBlock) {
  Add-Section $Name
  try {
    $Output = & $ScriptBlock 2>&1
    if ($Output) {
      $Output | ForEach-Object { $Lines.Add($_.ToString()) }
    } else {
      $Lines.Add("(no output)")
    }
  } catch {
    $Lines.Add("ERROR: $($_.Exception.Message)")
  }
}

$Lines.Add("=== Runtime proxy/state audit ===")
$Lines.Add("Generated: $(Get-Date -Format s)")
$Lines.Add("Repo: $Repo")

Add-Cmd "Current directory" {
  Get-Location
}

Add-Cmd "Tailscale version" {
  tailscale version
}

Add-Cmd "Tailscale serve status" {
  tailscale serve status
}

Add-Cmd "Tailscale serve get-config --all" {
  tailscale serve get-config --all
}

Add-Cmd "Windows WinHTTP proxy" {
  netsh winhttp show proxy
}

Add-Cmd "Windows user internet proxy registry" {
  Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" |
    Select-Object ProxyEnable, ProxyServer, AutoConfigURL
}

Add-Cmd "Environment proxy/url/host variables" {
  Get-ChildItem Env:* |
    Where-Object {
      $_.Name -match "proxy|url|host|clerk|next|vercel|tailscale|infisical|agent|vault"
    } |
    Sort-Object Name |
    ForEach-Object {
      "$($_.Name)=$($_.Value)"
    }
}

Add-Cmd "npm proxy config" {
  npm config get proxy
  npm config get https-proxy
  npm config get registry
}

Add-Cmd "pnpm proxy config" {
  pnpm config get proxy
  pnpm config get https-proxy
  pnpm config get registry
}

Add-Cmd "Node processes" {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -match "node|pnpm|npm|next|tailscale"
    } |
    Select-Object ProcessId, Name, CommandLine |
    Format-List
}

Add-Cmd "Port listeners around 2221" {
  Get-NetTCPConnection -State Listen |
    Where-Object {
      $_.LocalPort -in 2221,2222,2223,3000,3001,14321,14322
    } |
    Sort-Object LocalPort |
    Format-Table -AutoSize
}

Add-Cmd "Active TCP connections around 2221" {
  Get-NetTCPConnection |
    Where-Object {
      $_.LocalPort -eq 2221 -or $_.RemotePort -eq 2221
    } |
    Sort-Object State, LocalPort, RemotePort |
    Format-Table -AutoSize
}

Add-Cmd "Local app curl 127.0.0.1" {
  curl.exe -I --max-time 5 http://127.0.0.1:2221/
}

Add-Cmd "Local app curl localhost" {
  curl.exe -I --max-time 5 http://localhost:2221/
}

$Lines | Set-Content -LiteralPath $OutFile -Encoding UTF8

Write-Host ""
Write-Host "Runtime audit complete."
Write-Host "Results written to:"
Write-Host $OutFile
Write-Host ""
Get-Content -LiteralPath $OutFile