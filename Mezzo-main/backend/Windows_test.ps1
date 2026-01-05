# CivTAK System Test Script - English Version
# Fixes encoding/garbled text issues

# Set encoding to UTF8 just in case
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "================================" -ForegroundColor Cyan
Write-Host "   CivTAK System Test - Win    " -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "OK: Node.js is installed ($nodeVersion)" -ForegroundColor Green
} catch {
    Write-Host "ERR: Node.js not found! Please install from https://nodejs.org/" -ForegroundColor Red
    exit
}

# 2. Check Python
Write-Host "Checking Python..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "OK: Python is installed ($pythonVersion)" -ForegroundColor Green
} catch {
    Write-Host "WARN: Python not found. Some features may not work." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Please select an option (Type number + Enter):" -ForegroundColor Cyan
Write-Host "1. Install Dependencies (npm install)"
Write-Host "2. Start Backend Server (node server.js)"
Write-Host "3. Run Integration Test"
Write-Host "4. Simulate TAK Device (Python)"
Write-Host "5. Check Port Status (4000/4001)"
Write-Host "0. Exit"
Write-Host ""

$choice = Read-Host "Select [0-5]"

switch ($choice) {
    "1" {
        Write-Host "`nInstalling npm packages..." -ForegroundColor Yellow
        npm install express cors mqtt ws xml2js
        Write-Host "Done: Dependencies installed." -ForegroundColor Green
    }
    "2" {
        Write-Host "`nStarting Server... (Press Ctrl+C to stop)" -ForegroundColor Yellow
        node server.js
    }
    "3" {
        Write-Host "`nRunning Test..." -ForegroundColor Yellow
        node test_integration.js
    }
    "4" {
        Write-Host "`nStarting Device Simulation..." -ForegroundColor Yellow
        python mqtt_publisher.py simulate
    }
    "5" {
        Write-Host "`n[ System Port Status ]" -ForegroundColor Yellow
        $p4000 = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue
        $p4001 = Get-NetTCPConnection -LocalPort 4001 -ErrorAction SilentlyContinue
        
        if ($p4000) { Write-Host "OK: API Server (4000) is running" -ForegroundColor Green } 
        else { Write-Host "FAIL: API Server (4000) is NOT running" -ForegroundColor Red }
        
        if ($p4001) { Write-Host "OK: WebSocket (4001) is running" -ForegroundColor Green }
        else { Write-Host "FAIL: WebSocket (4001) is NOT running" -ForegroundColor Red }
    }
    "0" {
        exit
    }
    Default {
        Write-Host "Invalid option" -ForegroundColor Red
    }
}

Write-Host "`nPress any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")