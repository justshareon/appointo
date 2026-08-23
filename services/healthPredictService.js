'use strict';

const db = require('../database');
const LOG = require('../utils/logger');
const { isHealthPredictCategory, shopsWithHealthPredict } = require('../utils/healthPredictAccess');
const { ILLNESS_YEARS } = require('../data/healthIllnessYears');

const MARKER_PATTERNS = [
    { key: 'hba1c', label: 'HbA1c', unit: '%', re: /hba1c[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'fasting_glucose', label: 'Fasting glucose', unit: 'mg/dL', re: /(?:fasting\s*)?(?:blood\s*)?glucose[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'ldl', label: 'LDL-C', unit: 'mg/dL', re: /ldl(?:-c)?[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'hdl', label: 'HDL-C', unit: 'mg/dL', re: /hdl(?:-c)?[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'triglycerides', label: 'Triglycerides', unit: 'mg/dL', re: /(?:triglycerides|tg)[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', re: /creatinine[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'egfr', label: 'eGFR', unit: 'mL/min', re: /egfr[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'tsh', label: 'TSH', unit: 'mIU/L', re: /tsh[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'hemoglobin', label: 'Hemoglobin', unit: 'g/dL', re: /(?:hemoglobin|hb)[^0-9a-z]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'alt', label: 'ALT', unit: 'U/L', re: /(?:alt|sgpt)[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'uric_acid', label: 'Uric acid', unit: 'mg/dL', re: /uric\s*acid[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'vitamin_d', label: 'Vitamin D', unit: 'ng/mL', re: /vitamin\s*d[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
    { key: 'sbp', label: 'Systolic BP', unit: 'mmHg', re: /(?:bp|blood\s*pressure)[^0-9]{0,12}(\d{2,3})\s*\/\s*(\d{2,3})/i },
    { key: 'hs_crp', label: 'hs-CRP', unit: 'mg/L', re: /hs-?crp[^0-9]{0,16}(\d+(?:\.\d+)?)/i },
];

function ensureArrays() {
    if (!Array.isArray(db.health_reports)) db.health_reports = [];
    if (!Array.isArray(db.health_illness_years)) db.health_illness_years = [];
    if (!Array.isArray(db.health_predictions)) db.health_predictions = [];
    if (db.health_illness_years.length === 0) {
        db.health_illness_years = ILLNESS_YEARS.map((row) => ({ ...row }));
    }
}

let tablesReady = false;
async function ensureTables() {
    ensureArrays();
    if (tablesReady) return;
    const pool = typeof db.getPool === 'function' ? db.getPool() : null;
    if (!pool) {
        tablesReady = true;
        return;
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS health_reports (
                id VARCHAR(64) PRIMARY KEY,
                user_id VARCHAR(64) NOT NULL,
                vendor_id VARCHAR(64) NULL,
                report_year INT NOT NULL,
                report_type VARCHAR(64) NULL,
                file_name VARCHAR(255) NULL,
                notes TEXT NULL,
                markers_json TEXT NULL,
                extracted_text TEXT NULL,
                created_at DATETIME NULL
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS health_illness_years (
                id VARCHAR(64) PRIMARY KEY,
                illness_key VARCHAR(64) NOT NULL,
                year INT NOT NULL,
                risk_index INT NOT NULL,
                note TEXT NULL,
                source VARCHAR(255) NULL
            )
        `);
        tablesReady = true;
    } catch (err) {
        LOG.warning('[HealthPredict] table ensure skipped:', err.message);
        tablesReady = true;
    }
}

function parseMarkers(text, extra = {}) {
    const markers = {};
    const blob = String(text || '');
    for (const spec of MARKER_PATTERNS) {
        const match = blob.match(spec.re);
        if (!match) continue;
        if (spec.key === 'sbp' && match[2]) {
            markers.sbp = Number(match[1]);
            markers.dbp = Number(match[2]);
        } else {
            const n = Number(match[1]);
            if (Number.isFinite(n)) markers[spec.key] = n;
        }
    }
    Object.entries(extra || {}).forEach(([key, value]) => {
        const n = Number(value);
        if (Number.isFinite(n) && String(value).trim() !== '') markers[key] = n;
    });
    return markers;
}

function slope(points) {
    if (!points || points.length < 2) return 0;
    const xs = points.map((p, i) => (p.year != null ? Number(p.year) : i));
    const ys = points.map((p) => Number(p.value));
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
        num += (xs[i] - meanX) * (ys[i] - meanY);
        den += (xs[i] - meanX) ** 2;
    }
    if (!den) return 0;
    return num / den;
}

function latestYearIndex(illnessKey) {
    const rows = (db.health_illness_years || [])
        .filter((r) => r.illness_key === illnessKey)
        .sort((a, b) => a.year - b.year);
    return rows.length ? rows[rows.length - 1] : null;
}

function seriesFor(reports, key) {
    return reports
        .map((r) => ({ year: Number(r.report_year), value: r.markers?.[key] }))
        .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.year))
        .sort((a, b) => a.year - b.year);
}

function buildPredictions(reports) {
    const sorted = [...reports].sort((a, b) => Number(a.report_year) - Number(b.report_year));
    const latest = sorted[sorted.length - 1] || { markers: {} };
    const m = latest.markers || {};
    const items = [];

    const push = (item) => {
        const pop = latestYearIndex(item.illness_key);
        const popBoost = pop ? Math.round((Number(pop.risk_index) - 50) / 8) : 0;
        const likelihood = Math.max(8, Math.min(92, Math.round(item.base + popBoost + item.trendBoost)));
        items.push({
            illness: item.label,
            illness_key: item.illness_key,
            likelihood,
            window: item.window,
            summary: item.summary,
            detail: item.detail + (pop?.note ? ` Population note (${pop.year}): ${pop.note}` : ''),
            source: pop?.source || 'Uploaded reports',
            basedOn: item.basedOn,
        });
    };

    const hba1cPts = seriesFor(sorted, 'hba1c');
    const lastA1c = m.hba1c;
    if (lastA1c != null) {
        const rising = slope(hba1cPts) > 0.05;
        let base = lastA1c >= 6.5 ? 78 : lastA1c >= 5.7 ? 52 : 18;
        push({
            illness_key: 'type2_diabetes',
            label: 'Type 2 diabetes / prediabetes',
            base,
            trendBoost: rising ? 10 : 0,
            window: rising || lastA1c >= 5.7 ? '12–36 months' : '3–5 years',
            summary: lastA1c >= 6.5
                ? `Latest HbA1c ${lastA1c}% is in the diabetes range (ADA: ≥6.5%).`
                : lastA1c >= 5.7
                    ? `Latest HbA1c ${lastA1c}% is prediabetes (ADA 2025: 5.7–6.4%).`
                    : `HbA1c ${lastA1c}% is currently below the prediabetes cut-off.`,
            detail: rising
                ? 'Year-to-year A1c is climbing. ADA 2025 says this is the window to delay type 2 diabetes with food, movement, sleep and clinician follow-up. 2026 CKM guidance also ties glucose to heart and kidney risk, so do not read A1c in isolation.'
                : 'Keep annual A1c. 2026 CKM schedules glycemia with lipids and eGFR so one quiet year of labs still updates long-term risk.',
            basedOn: ['HbA1c', rising ? 'multi-year rise' : 'latest report'],
        });
    }

    const ldlPts = seriesFor(sorted, 'ldl');
    if (m.ldl != null) {
        const rising = slope(ldlPts) > 2;
        let base = m.ldl >= 190 ? 82 : m.ldl >= 160 ? 64 : m.ldl >= 130 ? 42 : 20;
        if (m.triglycerides >= 150 && (m.hdl == null || m.hdl < 40)) base += 8;
        push({
            illness_key: 'cvd',
            label: 'Heart / artery disease (CKM)',
            base,
            trendBoost: rising ? 8 : 0,
            window: m.ldl >= 160 ? '1–5 years' : '5–10 years',
            summary: m.ldl >= 190
                ? `LDL-C ${m.ldl} mg/dL is in the “treat now” band (≥190) in 2026 CKM guidance.`
                : `Latest LDL-C is ${m.ldl} mg/dL${rising ? ', and it is trending up across years' : ''}.`,
            detail: 'AHA/ACC 2026 CKM uses lipids plus glucose, blood pressure and kidney numbers. Triglycerides ≥150 with low HDL often mark insulin resistance even before diabetes. This is a probability from your reports, not a heart-attack date.',
            basedOn: ['LDL-C', m.triglycerides != null ? 'triglycerides' : null, m.hdl != null ? 'HDL' : null].filter(Boolean),
        });
    }

    const crPts = seriesFor(sorted, 'creatinine');
    if (m.creatinine != null || m.egfr != null) {
        const rising = slope(crPts) > 0.03;
        let base = 16;
        if (m.egfr != null && m.egfr < 60) base = 72;
        else if (m.creatinine >= 1.3) base = 58;
        else if (m.creatinine >= 1.1) base = 36;
        if (lastA1c >= 5.7) base += 6;
        push({
            illness_key: 'ckd',
            label: 'Chronic kidney strain',
            base,
            trendBoost: rising ? 12 : 0,
            window: rising ? '1–4 years' : '3–7 years',
            summary: m.egfr != null
                ? `eGFR ${m.egfr} ${m.egfr < 60 ? 'is below 60, a CKD-range value on KDIGO staging' : 'is currently above the CKD cut-off of 60'}.`
                : `Creatinine ${m.creatinine} mg/dL${rising ? ' is rising year on year' : ''}.`,
            detail: 'KDIGO uses eGFR and urine albumin together. Creatinine can look “fine” in smaller adults, so a rising trend across yearly reports matters even before 1.3. 2026 CKM asks for kidney labs on the same calendar as A1c and lipids.',
            basedOn: [m.creatinine != null ? 'creatinine' : null, m.egfr != null ? 'eGFR' : null, rising ? 'yearly slope' : null].filter(Boolean),
        });
    }

    if (m.tsh != null) {
        push({
            illness_key: 'hypothyroid',
            label: 'Underactive thyroid',
            base: m.tsh > 10 ? 70 : m.tsh > 4.5 ? 48 : 12,
            trendBoost: 0,
            window: '6–24 months',
            summary: m.tsh > 4.5 ? `TSH ${m.tsh} mIU/L is above the usual 4.5 follow-up band.` : `TSH ${m.tsh} mIU/L is in a typical screening band.`,
            detail: 'TSH is not a yearly universal screen for everyone. Repeat with a clinician if energy, weight or cold intolerance changed, especially with type 1 diabetes risk in the family.',
            basedOn: ['TSH'],
        });
    }

    if (m.alt != null || (m.triglycerides != null && m.triglycerides >= 150)) {
        push({
            illness_key: 'fatty_liver',
            label: 'Metabolic fatty liver (MASLD)',
            base: m.alt > 55 ? 58 : m.triglycerides >= 200 ? 46 : 28,
            trendBoost: 0,
            window: '2–6 years',
            summary: m.alt != null ? `ALT ${m.alt} U/L ${m.alt > 55 ? 'is above a common lab ceiling' : 'is not a strong liver flag by itself'}.` : 'Triglycerides in the metabolic range raise fatty-liver probability.',
            detail: 'Fatty liver is now grouped with CKM: glucose, triglycerides, weight and ALT move together. A high ALT on one PDF is a prompt for repeat labs, not a biopsy.',
            basedOn: [m.alt != null ? 'ALT' : null, m.triglycerides != null ? 'triglycerides' : null].filter(Boolean),
        });
    }

    if (m.hemoglobin != null) {
        push({
            illness_key: 'anemia',
            label: 'Anemia / low hemoglobin',
            base: m.hemoglobin < 10 ? 74 : m.hemoglobin < 12 ? 50 : 10,
            trendBoost: 0,
            window: '3–12 months',
            summary: `Hemoglobin ${m.hemoglobin} g/dL ${m.hemoglobin < 12 ? 'is below common adult cut-offs' : 'is currently adequate on a standard cutoff'}.`,
            detail: 'Low Hb needs iron, B12, bleed and kidney review. If creatinine is also rising, mention both to the doctor — they are often linked.',
            basedOn: ['hemoglobin'],
        });
    }

    if (m.uric_acid != null) {
        push({
            illness_key: 'gout',
            label: 'Gout / high uric acid',
            base: m.uric_acid >= 8 ? 62 : m.uric_acid >= 7 ? 44 : 14,
            trendBoost: 0,
            window: '1–5 years',
            summary: `Uric acid ${m.uric_acid} mg/dL ${m.uric_acid >= 7 ? 'is in a gout-risk band' : 'is under the usual 7 mg/dL gout flag'}.`,
            detail: 'Uric acid rides with metabolic syndrome. 2026 CKM treats it as cluster risk, not only a joint disease.',
            basedOn: ['uric acid'],
        });
    }

    if (m.vitamin_d != null) {
        push({
            illness_key: 'vitamin_d',
            label: 'Vitamin D deficiency',
            base: m.vitamin_d < 12 ? 70 : m.vitamin_d < 20 ? 55 : 12,
            trendBoost: 0,
            window: '3–12 months',
            summary: `Vitamin D ${m.vitamin_d} ng/mL ${m.vitamin_d < 20 ? 'is in a deficient/insufficient band' : 'is not flagged as deficient'}.`,
            detail: 'Deficiency is common and correctable. It is not used here as a stand-alone predictor of a named future illness.',
            basedOn: ['vitamin D'],
        });
    }

    if (m.sbp != null) {
        push({
            illness_key: 'hypertension',
            label: 'Hypertension',
            base: m.sbp >= 140 ? 72 : m.sbp >= 130 ? 48 : 16,
            trendBoost: 0,
            window: '1–3 years',
            summary: `Systolic BP ${m.sbp}${m.dbp ? `/${m.dbp}` : ''} mmHg ${m.sbp >= 140 ? 'meets a common clinic treat-now threshold' : m.sbp >= 130 ? 'is in a tighter CKM target discussion zone' : 'is currently below 130'}.`,
            detail: '2026 CKM: check BP every visit; ≥140/90 is treated on its own, not only after a risk score. Home readings over weeks beat a single report line.',
            basedOn: ['blood pressure'],
        });
    }

    items.sort((a, b) => b.likelihood - a.likelihood);
    return items;
}

function overallFrom(predictions, reports) {
    if (!reports.length) {
        return { overallRisk: 0, overallLabel: 'No reports yet', trending: 'flat' };
    }
    if (!predictions.length) {
        return { overallRisk: 12, overallLabel: 'Markers not read yet', trending: 'flat' };
    }
    const top = predictions.slice(0, 3);
    const overallRisk = Math.round(top.reduce((s, p) => s + p.likelihood, 0) / top.length);
    const years = reports.map((r) => Number(r.report_year)).filter(Number.isFinite).sort((a, b) => a - b);
    const trending = years.length >= 2 ? 'watched yearly' : 'single year';
    let overallLabel = 'Low watch';
    if (overallRisk >= 65) overallLabel = 'Act with your doctor';
    else if (overallRisk >= 45) overallLabel = 'Rising watch';
    else if (overallRisk >= 25) overallLabel = 'Mild watch';
    return { overallRisk, overallLabel, trending };
}

function yearSeries(reports) {
    const keys = ['hba1c', 'ldl', 'creatinine', 'triglycerides', 'hemoglobin', 'tsh', 'alt', 'sbp', 'egfr', 'vitamin_d', 'uric_acid'];
    return reports
        .slice()
        .sort((a, b) => Number(a.report_year) - Number(b.report_year))
        .map((r) => {
            const row = { year: Number(r.report_year), file_name: r.file_name, report_type: r.report_type };
            keys.forEach((k) => {
                if (r.markers && r.markers[k] != null) row[k] = r.markers[k];
            });
            return row;
        });
}

async function listShopsForUser(user) {
    const shops = [];
    const role = String(user?.role || '').toLowerCase();
    if (role === 'vendor' || role === 'super_admin') {
        if (typeof db.getVendorByOwnerId === 'function') {
            const owned = await db.getVendorByOwnerId(user.id);
            const list = Array.isArray(owned) ? owned : owned ? [owned] : [];
            shops.push(...list);
        }
        const all = await db.getVendors(true, 1, 500, 'newest', '', true).catch(() => []);
        const arr = Array.isArray(all) ? all : all?.vendors || [];
        arr.forEach((v) => {
            if (String(v.owner_id) === String(user.id) && !shops.some((s) => String(s.id) === String(v.id))) {
                shops.push(v);
            }
        });
    }
    if (typeof db.getMappedVendorsForUser === 'function') {
        const mapped = await db.getMappedVendorsForUser(user.id).catch(() => ({ vendors: [] }));
        (mapped.vendors || []).forEach((v) => {
            if (!shops.some((s) => String(s.id) === String(v.id))) shops.push(v);
        });
    }
    return shops;
}

async function assertAccess(user) {
    ensureArrays();
    const shops = await listShopsForUser(user);
    const healthShops = shopsWithHealthPredict(shops);
    const allowed = healthShops.length > 0 || isHealthPredictCategory(user?.category);
    return { allowed, shops, healthShops };
}

function userReports(userId) {
    ensureArrays();
    return (db.health_reports || [])
        .filter((r) => String(r.user_id) === String(userId))
        .map((r) => {
            const markers = r.markers && Object.keys(r.markers).length
                ? r.markers
                : parseMarkers([r.extracted_text, r.notes, r.file_name].join('\n'), r.markers);
            return { ...r, markers };
        })
        .sort((a, b) => Number(b.report_year) - Number(a.report_year) || new Date(b.created_at) - new Date(a.created_at));
}

function formatPerson(user, healthShops) {
    return {
        id: user.id,
        name: user.name || 'Member',
        email: user.email || '',
        mobile: user.mobile || '',
        role: user.role || 'user',
        location: user.location_name || '',
        shops: healthShops.map((s) => ({
            id: s.id,
            shop_name: s.shop_name,
            category: s.category,
        })),
    };
}

async function getDashboard(user) {
    await ensureTables();
    const { allowed, healthShops } = await assertAccess(user);
    const full = (typeof db.getUserById === 'function' ? await db.getUserById(user.id) : null) || user;
    const reports = userReports(user.id);
    const predictions = reports.length ? buildPredictions(reports) : [];
    const summaryBits = overallFrom(predictions, reports);
    const years = [...new Set(reports.map((r) => Number(r.report_year)).filter(Number.isFinite))].sort((a, b) => a - b);
    const latestMarkers = reports[0]?.markers || {};
    const markerCards = MARKER_PATTERNS
        .filter((spec) => spec.key !== 'sbp')
        .map((spec) => ({
            key: spec.key,
            label: spec.label,
            unit: spec.unit,
            value: latestMarkers[spec.key] != null ? latestMarkers[spec.key] : null,
        }))
        .filter((row) => row.value != null);
    if (latestMarkers.sbp != null) {
        markerCards.push({
            key: 'bp',
            label: 'Blood pressure',
            unit: 'mmHg',
            value: latestMarkers.dbp != null ? `${latestMarkers.sbp}/${latestMarkers.dbp}` : latestMarkers.sbp,
        });
    }

    return {
        allowed,
        person: formatPerson(full, healthShops),
        summary: {
            ...summaryBits,
            years,
            yearCount: years.length,
            reportCount: reports.length,
            lastReportAt: reports[0]?.created_at || null,
            lastYear: years[years.length - 1] || null,
            markerCount: markerCards.length,
        },
        markersLatest: markerCards,
        yearSeries: yearSeries(reports),
        predictions,
        reports: reports.map((r) => ({
            id: r.id,
            report_year: r.report_year,
            report_type: r.report_type,
            file_name: r.file_name,
            notes: r.notes,
            markers: r.markers,
            created_at: r.created_at,
        })),
        illnessYears: (db.health_illness_years || []).slice().sort((a, b) => b.year - a.year || a.illness_key.localeCompare(b.illness_key)),
        syncedAt: new Date().toISOString(),
        knowledgeThrough: 2026,
        disclaimer: 'Informational only — not a diagnosis or treatment plan. Built from your uploaded yearly reports plus ADA 2025 and AHA/ACC/ADA/ASN 2026 CKM public cut-offs. A hospital or doctor must confirm any illness.',
    };
}

async function addReport(user, body = {}) {
    await ensureTables();
    const { allowed, healthShops } = await assertAccess(user);
    if (!allowed) {
        const err = new Error('AI Predict is only for Hospital / Doctor category shops');
        err.status = 403;
        throw err;
    }
    const year = parseInt(body.report_year || body.year || new Date().getFullYear(), 10);
    if (!year || year < 2010 || year > 2035) {
        const err = new Error('Choose a report year between 2010 and 2035');
        err.status = 400;
        throw err;
    }
    const extracted = [body.extracted_text, body.notes, body.file_name].filter(Boolean).join('\n');
    const markers = parseMarkers(extracted, body.markers);
    const report = {
        id: `hr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        user_id: user.id,
        vendor_id: body.vendor_id || healthShops[0]?.id || null,
        report_year: year,
        report_type: body.report_type || 'lab',
        file_name: body.file_name || 'typed-report',
        notes: body.notes || '',
        markers,
        extracted_text: String(body.extracted_text || '').slice(0, 8000),
        created_at: new Date().toISOString(),
    };
    db.health_reports.unshift(report);
    const pool = typeof db.getPool === 'function' ? db.getPool() : null;
    if (pool) {
        try {
            await pool.query(
                `INSERT INTO health_reports (id, user_id, vendor_id, report_year, report_type, file_name, notes, markers_json, extracted_text, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    report.id,
                    report.user_id,
                    report.vendor_id,
                    report.report_year,
                    report.report_type,
                    report.file_name,
                    report.notes,
                    JSON.stringify(report.markers),
                    report.extracted_text,
                ]
            );
        } catch (err) {
            LOG.warning('[HealthPredict] mysql insert skipped:', err.message);
        }
    }
    return getDashboard(user);
}

module.exports = {
    ensureTables,
    getDashboard,
    addReport,
    assertAccess,
};
