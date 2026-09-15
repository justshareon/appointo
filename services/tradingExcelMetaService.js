const settingsService = require('./settingsService');

const KEY_DATA_AS_OF = 'trading_excel_data_as_of';
const KEY_UPLOADED_AT = 'trading_excel_uploaded_at';

let cache = { dataAsOf: null, uploadedAt: null };

function normalizeDataAsOf(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    const s = String(value).trim();
    return s.length >= 10 ? s.slice(0, 10) : s;
}

async function getTradingExcelMeta() {
    try {
        const settings = await settingsService.getSettings();
        cache = {
            dataAsOf: settings[KEY_DATA_AS_OF] || cache.dataAsOf || null,
            uploadedAt: settings[KEY_UPLOADED_AT] || cache.uploadedAt || null,
        };
    } catch (_) {
        /* keep cache */
    }
    return { ...cache };
}

async function saveTradingExcelMeta({ dataAsOf, uploadedAt } = {}) {
    const patch = {};
    const normalized = normalizeDataAsOf(dataAsOf);
    if (normalized) {
        patch[KEY_DATA_AS_OF] = normalized;
        cache.dataAsOf = normalized;
    }
    if (uploadedAt) {
        const iso = uploadedAt instanceof Date ? uploadedAt.toISOString() : String(uploadedAt);
        patch[KEY_UPLOADED_AT] = iso;
        cache.uploadedAt = iso;
    }
    if (Object.keys(patch).length) {
        await settingsService.updateSettings(patch);
    }
    return getTradingExcelMeta();
}

module.exports = {
    getTradingExcelMeta,
    saveTradingExcelMeta,
    KEY_DATA_AS_OF,
    KEY_UPLOADED_AT,
};
