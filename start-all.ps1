$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $root "hotToday\hot-rank-web"
$frontendPath = Join-Path $root "hot-rank-web\vue-ui"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动今日热榜项目（后端 + 前端）" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查路径
if (-not (Test-Path -LiteralPath $backendPath)) {
    Write-Host "✗ 错误：找不到后端目录: $backendPath" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $frontendPath)) {
    Write-Host "✗ 错误：找不到前端目录: $frontendPath" -ForegroundColor Red
    exit 1
}

Write-Host "后端路径: $backendPath" -ForegroundColor Gray
Write-Host "前端路径: $frontendPath" -ForegroundColor Gray
Write-Host ""

Write-Host "将会打开两个 PowerShell 窗口：" -ForegroundColor Yellow
Write-Host "  1. 后端服务（FastAPI）" -ForegroundColor Yellow
Write-Host "  2. 前端服务（Vue3 + Vite）" -ForegroundColor Yellow
Write-Host ""

# 启动后端
Write-Host "启动后端..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $backendPath "start-backend.ps1")
)

# 等待一下再启动前端
Start-Sleep -Seconds 2

# 启动前端
Write-Host "启动前端..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", (Join-Path $frontendPath "start-frontend.ps1")
)

Write-Host ""
Write-Host "✓ 已启动后端和前端服务！" -ForegroundColor Green
Write-Host ""
Write-Host "访问地址：" -ForegroundColor Cyan
Write-Host "  前端：http://localhost:5173" -ForegroundColor Green
Write-Host "  后端 API：http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "  API 文档：http://127.0.0.1:8000/docs" -ForegroundColor Green
Write-Host ""
Write-Host "⚠ 注意事项：" -ForegroundColor Yellow
Write-Host "  1. 确保 PostgreSQL 和 Redis 已启动" -ForegroundColor Yellow
Write-Host "  2. 检查后端目录的 config.py 配置是否正确" -ForegroundColor Yellow
Write-Host "  3. 关闭服务：在对应的 PowerShell 窗口按 Ctrl+C" -ForegroundColor Yellow
Write-Host ""
