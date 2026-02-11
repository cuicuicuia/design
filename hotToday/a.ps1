# hotToday crawler project - one-click data fetching script

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  hotToday Crawler - Fetch All Data" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check config file
if (-not (Test-Path -LiteralPath ".\config.py")) {
    Write-Host "[ERROR] Config file config.py not found" -ForegroundColor Red
    Write-Host "   Please create config.py and configure database connection" -ForegroundColor Yellow
    Write-Host "   Refer to config.py.example" -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Config file exists" -ForegroundColor Green
Write-Host ""

# Create virtual environment if not exists
if (-not (Test-Path -LiteralPath ".\.venv")) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Cyan
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to create virtual environment, please check if Python is installed" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Virtual environment created" -ForegroundColor Green
}

# Activate virtual environment and upgrade pip
Write-Host "Upgrading pip..." -ForegroundColor Cyan
.\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet

# Install dependencies
Write-Host "Installing Python dependencies (this may take a few minutes)..." -ForegroundColor Cyan
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Dependencies installed" -ForegroundColor Green
Write-Host ""

# Initialize database tables if script exists
if (Test-Path -LiteralPath ".\tools\init_tables.py") {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Initializing database tables..." -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    .\.venv\Scripts\python.exe .\tools\init_tables.py
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] Table initialization had errors, but will continue..." -ForegroundColor Yellow
    } else {
        Write-Host "[OK] Database tables initialized" -ForegroundColor Green
    }
    Write-Host ""
}

# Run main task
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Starting data fetch (main task task.py)..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "This may take 5-15 minutes, depending on network speed" -ForegroundColor Yellow
Write-Host ""

.\.venv\Scripts\python.exe .\task.py

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[WARN] Main task had errors (some data sources may have failed)" -ForegroundColor Yellow
    Write-Host "   Please check the error messages above" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "[OK] Main task completed" -ForegroundColor Green
}

Write-Host ""

# Run supplementary task
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Running supplementary task (sometask.py)..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

.\.venv\Scripts\python.exe .\sometask.py

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[WARN] Supplementary task had errors" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "[OK] Supplementary task completed" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[SUCCESS] Data fetching completed!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Check log files (logs/hot_log_*.log) for detailed execution info" -ForegroundColor White
Write-Host "2. Run in hot-rank-web project: python tools\pushSomethings.py" -ForegroundColor White
Write-Host "   This will initialize card_table in Redis" -ForegroundColor White
Write-Host "3. Restart backend service, frontend will be able to see data" -ForegroundColor White
Write-Host ""
