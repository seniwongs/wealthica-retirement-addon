# serve-https.ps1
# Self-signed HTTPS server for localhost — no Node/Python needed.
# First run: auto-elevates to admin to create & trust the certificate.
param(
    [int]$Port = 8443,
    [string]$Root = $PSScriptRoot
)

# ── Auto-elevate if not admin ──────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Requesting admin rights to set up HTTPS certificate..." -ForegroundColor Yellow
    $args = "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Port $Port -Root `"$Root`""
    Start-Process powershell.exe -ArgumentList $args -Verb RunAs
    exit
}

# ── Certificate setup ──────────────────────────────────────────────────────────
$friendlyName = "Wealthica Retirement Addon (localhost)"
$cert = Get-ChildItem Cert:\LocalMachine\My |
        Where-Object { $_.FriendlyName -eq $friendlyName } |
        Select-Object -First 1

if (-not $cert) {
    Write-Host "Creating self-signed certificate for localhost..." -ForegroundColor Cyan
    $cert = New-SelfSignedCertificate `
        -DnsName "localhost" `
        -CertStoreLocation "Cert:\LocalMachine\My" `
        -NotAfter (Get-Date).AddYears(5) `
        -FriendlyName $friendlyName `
        -KeyAlgorithm RSA `
        -KeyLength 2048 `
        -HashAlgorithm SHA256
    Write-Host "  Certificate created: $($cert.Thumbprint)" -ForegroundColor Green
} else {
    Write-Host "  Reusing existing certificate: $($cert.Thumbprint)" -ForegroundColor Gray
}

# Trust it in the local machine root store (browser will show green padlock)
$rootStore = [System.Security.Cryptography.X509Certificates.X509Store]::new(
    [System.Security.Cryptography.X509Certificates.StoreName]::Root, "LocalMachine")
$rootStore.Open("ReadWrite")
$alreadyTrusted = $rootStore.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
if (-not $alreadyTrusted) {
    Write-Host "  Trusting certificate (Windows may show a security prompt)..." -ForegroundColor Cyan
    $rootStore.Add($cert)
    Write-Host "  Certificate trusted." -ForegroundColor Green
}
$rootStore.Close()

# ── Bind cert to port via HTTP.sys ─────────────────────────────────────────────
$appId = "{A1B2C3D4-1234-5678-ABCD-000000000001}"
netsh http delete sslcert  ipport="0.0.0.0:$Port" 2>&1 | Out-Null
netsh http delete urlacl   url="https://+:$Port/"  2>&1 | Out-Null
$r1 = netsh http add urlacl  url="https://+:$Port/"  user="Everyone" 2>&1
$r2 = netsh http add sslcert ipport="0.0.0.0:$Port" certhash=$($cert.Thumbprint) appid="$appId" 2>&1
Write-Host "  URL reservation : $r1" -ForegroundColor Gray
Write-Host "  SSL cert binding: $r2" -ForegroundColor Gray

# ── Static file server ─────────────────────────────────────────────────────────
$url = "https://localhost:$Port/"

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("https://+:$Port/")
$listener.Start()

Write-Host ""
Write-Host "  HTTPS server running at: $url" -ForegroundColor Cyan
Write-Host "  Serving files from:      $Root"  -ForegroundColor Gray
Write-Host "  Point Wealthica Dev Addon to: $url" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".woff2"= "font/woff2"
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $path = $req.Url.LocalPath
        if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }

        # ── Private Network Access + CORS headers (required for public→localhost iframes) ──
        $res.Headers.Add("Access-Control-Allow-Origin",          "*")
        $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
        $res.Headers.Add("Access-Control-Allow-Methods",         "GET, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers",         "*")

        # Browser sends OPTIONS preflight before allowing public→private connection.
        # Respond immediately with 200 so the actual request is unblocked.
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode      = 200
            $res.ContentLength64 = 0
            $res.OutputStream.Close()
            Write-Host "  OPT  $path" -ForegroundColor DarkCyan
            continue
        }

        $filePath = Join-Path $Root ($path.TrimStart("/").Replace("/", "\"))

        if (Test-Path $filePath -PathType Leaf) {
            $ext  = [System.IO.Path]::GetExtension($filePath)
            $mime = if ($mimeTypes[$ext]) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType     = $mime
            $res.ContentLength64 = $bytes.Length
            $res.StatusCode      = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host "  200  $path" -ForegroundColor Green
        } else {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            $res.StatusCode      = 404
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
            Write-Host "  404  $path" -ForegroundColor DarkRed
        }
        $res.OutputStream.Close()
    }
} finally {
    $listener.Stop()
    Write-Host "Server stopped." -ForegroundColor Gray
}
