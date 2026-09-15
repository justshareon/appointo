const XLSX = require('xlsx');

function isPlausibleMarketDate(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    const nowY = new Date().getFullYear();
    return y >= 2015 && y <= nowY + 1;
}

function parseWorksheetCellDate(cell) {
    if (!cell) return null;
    if (cell.t === 'd' && cell.v instanceof Date) return cell.v;
    if (cell.v instanceof Date) return cell.v;
    if (typeof cell.v === 'number' && cell.v > 30000 && cell.v < 90000) {
        const parts = XLSX.SSF.parse_date_code(cell.v);
        if (parts?.y) return new Date(parts.y, parts.m - 1, parts.d);
    }
    const text = String(cell.w ?? cell.v ?? '').trim();
    if (!text || text.toLowerCase() === 'offset') return null;
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text)) {
        const parsed = new Date(text);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) return new Date(parsed);
    return null;
}

/**
 * Market snapshot date from workbook DASHBOARD sheet (header row date cell).
 */
function extractDashboardMarketDate(workbook) {
    if (!workbook?.SheetNames?.length) return null;
    const sheetName = workbook.SheetNames.find((n) => /^dashboard$/i.test(String(n).trim()));
    if (!sheetName) return null;

    const ws = workbook.Sheets[sheetName];
    if (!ws) return null;

    const ref = ws['!ref'];
    const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 12, c: 24 } };
    const candidates = [];

    for (let r = range.s.r; r <= Math.min(range.e.r, 10); r += 1) {
        for (let c = range.s.c; c <= Math.min(range.e.c, 28); c += 1) {
            const addr = XLSX.utils.encode_cell({ r, c });
            const d = parseWorksheetCellDate(ws[addr]);
            if (!isPlausibleMarketDate(d)) continue;
            let score = 0;
            if (r === 0) score += 20;
            if (c >= 10) score += 8;
            const neighbor = String(ws[XLSX.utils.encode_cell({ r, c: c + 1 })]?.w || '').toLowerCase();
            if (neighbor === 'offset') score -= 15;
            candidates.push({ d, score });
        }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].d;
}

module.exports = { extractDashboardMarketDate, isPlausibleMarketDate };
