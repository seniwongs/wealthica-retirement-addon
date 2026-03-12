# Simple static file server using .NET HttpListener (no Node/Python needed)
# Accepts all hostnames (http://+) so ngrok tunnels work correctly.
param([int]$Port = 8080)

$root = $PSScriptRoot

# ── URL reservation (needed for wildcard '+' binding, requires admin once) ────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)

$urlacl = netsh http show urlacl url="http://+:$Port/" 2>&1
if ($urlacl -notmatch "Everyone" -and $urlacl -notmatch "User") {
    if ($isAdmin) {
        netsh http add urlacl url="http://+:$Port/" user="Everyone" | Out-Null
    } else {
        Write-Host "  Re-launching as admin to register URL reservation..." -ForegroundColor Yellow
        $a = "-ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Port $Port"
        Start-Process powershell.exe -ArgumentList $a -Verb RunAs
        exit
    }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()

Write-Host ""
Write-Host "  Serving at : http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Accepts    : all hostnames (ngrok-compatible)" -ForegroundColor Green
Write-Host "  Root dir   : $root" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

$mimeTypes = @{
    ".html"  = "text/html; charset=utf-8"
    ".css"   = "text/css"
    ".js"    = "application/javascript"
    ".json"  = "application/json"
    ".png"   = "image/png"
    ".jpg"   = "image/jpeg"
    ".svg"   = "image/svg+xml"
    ".ico"   = "image/x-icon"
    ".woff2" = "font/woff2"
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $path = $req.Url.LocalPath
        if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }

        $res.Headers.Add("Access-Control-Allow-Origin",          "*")
        $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
        $res.Headers.Add("Access-Control-Allow-Methods",         "GET, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers",         "*")

        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 200; $res.ContentLength64 = 0
            $res.OutputStream.Close(); continue
        }

        $filePath = Join-Path $root ($path.TrimStart("/").Replace("/", "\"))

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
}
