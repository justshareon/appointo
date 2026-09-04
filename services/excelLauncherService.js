/**
 * Close Excel → reopen workbook → wait for data load → save → close.
 * Used on manual refresh from the trading dashboard.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const config = require('../config/tradingConfig');
const LOG = require('../utils/logger');
const tradingExcelLog = require('../utils/tradingExcelLog');

const execFileAsync = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ExcelLauncherService {
    constructor() {
        this.isRunning = false;
        this.lastRunAt = null;
        this.lastError = null;
    }

    getWaitMs() {
        const fromEnv = parseInt(process.env.EXCEL_LOAD_WAIT_MS, 10);
        if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
        const fromConfig = config.excelFile?.loadWaitMs;
        if (fromConfig && fromConfig > 0) return fromConfig;
        return 4 * 60 * 1000;
    }

    /** Manual refresh button — default 3 minutes */
    getRefreshWaitMs() {
        const fromEnv = parseInt(process.env.EXCEL_REFRESH_WAIT_MS, 10);
        if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
        const fromConfig = config.excelFile?.refreshWaitMs;
        if (fromConfig && fromConfig > 0) return fromConfig;
        return 3 * 60 * 1000;
    }

    isEnabled() {
        if (process.env.EXCEL_OPEN_BEFORE_SYNC === 'false') return false;
        if (config.excelFile?.openBeforeSync === false) return false;
        return process.platform === 'win32';
    }

    async runPowerShell(script, timeoutMs) {
        const { stdout, stderr } = await execFileAsync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
            { timeout: timeoutMs, windowsHide: false, maxBuffer: 1024 * 1024 }
        );
        if (stderr) LOG.info(`[Excel Launcher] ${String(stderr).trim()}`);
        return stdout;
    }

    /** Force-close all Excel instances (refresh starts clean). */
    async closeExcel() {
        if (!this.isEnabled()) {
            LOG.info('[Excel Launcher] Close skipped (not Windows / disabled)');
            return { closed: false };
        }

        const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$closed = 0
Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object {
  $_.CloseMainWindow() | Out-Null
  Start-Sleep -Milliseconds 500
}
Start-Sleep -Seconds 2
Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  $closed++
}
Write-Output "CLOSED:$closed"
`.trim();

        try {
            const out = await this.runPowerShell(psScript, 60000);
            LOG.info(`[Excel Launcher] Excel closed: ${String(out || '').trim()}`);
            await sleep(2000);
            return { closed: true };
        } catch (error) {
            LOG.warning(`[Excel Launcher] Close Excel: ${error.message}`);
            return { closed: false };
        }
    }

    async _openWaitSaveClose(filePath, waitMs) {
        const resolved = path.resolve(filePath);
        if (!fs.existsSync(resolved)) {
            throw new Error(`Excel file not found: ${resolved}`);
        }

        if (!this.isEnabled()) {
            LOG.info(`[Excel Launcher] Open skipped (${process.platform}); waiting ${Math.round(waitMs / 1000)}s`);
            await sleep(waitMs);
            return { opened: false, waitedMs: waitMs, filePath: resolved };
        }

        const waitSec = Math.max(30, Math.floor(waitMs / 1000));
        const escapedPath = resolved.replace(/'/g, "''");

        const psScript = `
$ErrorActionPreference = 'Stop'
$path = '${escapedPath}'
$waitSec = ${waitSec}
$excel = $null
$wb = $null
try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $true
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $true
    $wb = $excel.Workbooks.Open($path)
    Write-Output "OPENED"
    try { $wb.RefreshAll() } catch { }
    try { $excel.CalculateUntilAsyncQueriesDone() } catch { }
    Start-Sleep -Seconds $waitSec
    try { $excel.CalculateFullRebuild() } catch { }
    $wb.Save()
    Write-Output "SAVED"
    $wb.Close($true)
    $excel.Quit()
    Write-Output "DONE"
} catch {
    Write-Error $_.Exception.Message
    if ($wb) { try { $wb.Close($false) } catch { } }
    if ($excel) { try { $excel.Quit() } catch { } }
    exit 1
} finally {
    if ($excel) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) }
}
`.trim();

        LOG.info(`[Excel Launcher] Open + wait ${waitSec}s: ${resolved}`);
        const timeoutMs = (waitSec + 120) * 1000;
        const stdout = await this.runPowerShell(psScript, timeoutMs);
        if (stdout) LOG.info(`[Excel Launcher] ${String(stdout).trim().replace(/\n/g, ' | ')}`);
        return { opened: true, waitedMs: waitSec * 1000, filePath: resolved };
    }

    async openWaitAndSave(filePath, waitMs) {
        const ms = waitMs || this.getWaitMs();
        if (this.isRunning) throw new Error('Excel launcher already running');
        this.isRunning = true;
        try {
            const result = await this._openWaitSaveClose(filePath, ms);
            this.lastRunAt = new Date();
            this.lastError = null;
            LOG.success(`[Excel Launcher] Workbook saved after ${Math.round(ms / 1000)}s wait`);
            return result;
        } catch (error) {
            this.lastError = error.message;
            tradingExcelLog.push('error', 'excel_com_failed', error.message, { filePath, waitMs: ms });
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /** Close Excel → reopen → wait → save (manual refresh flow). */
    async restartOpenWaitAndSave(filePath, waitMs) {
        const ms = waitMs || this.getRefreshWaitMs();
        if (this.isRunning) throw new Error('Excel launcher already running');
        this.isRunning = true;
        try {
            LOG.info('[Excel Launcher] Refresh: closing Excel…');
            await this.closeExcel();
            LOG.info(`[Excel Launcher] Refresh: reopening Excel, waiting ${Math.round(ms / 1000)}s…`);
            const result = await this._openWaitSaveClose(filePath, ms);
            this.lastRunAt = new Date();
            this.lastError = null;
            LOG.success('[Excel Launcher] Refresh cycle complete — ready for DB sync');
            return { ...result, restarted: true };
        } catch (error) {
            this.lastError = error.message;
            tradingExcelLog.push('error', 'excel_restart_failed', error.message, { filePath, waitMs: ms });
            throw error;
        } finally {
            this.isRunning = false;
        }
    }
}

module.exports = new ExcelLauncherService();
