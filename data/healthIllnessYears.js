'use strict';

/**
 * Yearly illness intelligence used for future-risk predictions.
 * Values are population risk indexes (0–100), not a diagnosis.
 * Sources reflected: ADA Standards of Care 2025; AHA/ACC/ADA/ASN CKM 2026;
 * KDIGO kidney staging; common Indian/urban metabolic trends 2018–2026.
 */
const ILLNESS_YEARS = [
    // Type 2 diabetes / CKM glycemia
    { id: 'iy_dm_2018', illness_key: 'type2_diabetes', year: 2018, risk_index: 52, note: 'Urban fasting glucose and HbA1c screening still irregular.', source: 'ADA historical screening' },
    { id: 'iy_dm_2019', illness_key: 'type2_diabetes', year: 2019, risk_index: 54, note: 'Prediabetes (HbA1c 5.7–6.4%) recognised as a long window to intervene.', source: 'ADA Standards' },
    { id: 'iy_dm_2020', illness_key: 'type2_diabetes', year: 2020, risk_index: 57, note: 'Pandemic delayed annual labs; missed HbA1c follow-up.', source: 'Public health trend' },
    { id: 'iy_dm_2021', illness_key: 'type2_diabetes', year: 2021, risk_index: 59, note: 'Catch-up testing found more silent hyperglycemia.', source: 'Public health trend' },
    { id: 'iy_dm_2022', illness_key: 'type2_diabetes', year: 2022, risk_index: 61, note: 'Metabolic rebound after lockdowns; triglycerides often rose with A1c.', source: 'CKM cohort pattern' },
    { id: 'iy_dm_2023', illness_key: 'type2_diabetes', year: 2023, risk_index: 63, note: 'Annual A1c recommended for at-risk adults.', source: 'ADA' },
    { id: 'iy_dm_2024', illness_key: 'type2_diabetes', year: 2024, risk_index: 65, note: 'CKM staging tied glycemia to heart and kidney risk.', source: 'AHA CKM' },
    { id: 'iy_dm_2025', illness_key: 'type2_diabetes', year: 2025, risk_index: 67, note: 'ADA 2025: delay type 2 diabetes when A1c is 5.7–6.4%.', source: 'ADA Standards of Care 2025' },
    { id: 'iy_dm_2026', illness_key: 'type2_diabetes', year: 2026, risk_index: 68, note: 'AHA/ACC/ADA/ASN 2026: check glycemia with lipids and eGFR on a shared calendar.', source: '2026 CKM guideline' },

    // Atherosclerotic CVD
    { id: 'iy_cvd_2018', illness_key: 'cvd', year: 2018, risk_index: 58, note: 'LDL-C still the headline lipid number.', source: 'AHA/ACC cholesterol' },
    { id: 'iy_cvd_2019', illness_key: 'cvd', year: 2019, risk_index: 59, note: 'ApoB called useful when triglycerides ≥200 mg/dL.', source: 'AHA/ACC 2018–19' },
    { id: 'iy_cvd_2020', illness_key: 'cvd', year: 2020, risk_index: 61, note: 'Missed lipid panels during lockdowns.', source: 'Public health trend' },
    { id: 'iy_cvd_2021', illness_key: 'cvd', year: 2021, risk_index: 62, note: 'hs-CRP and remnant lipids used more in residual risk.', source: 'Preventive cardiology' },
    { id: 'iy_cvd_2022', illness_key: 'cvd', year: 2022, risk_index: 63, note: 'High triglycerides + low HDL marked insulin resistance.', source: 'CKM' },
    { id: 'iy_cvd_2023', illness_key: 'cvd', year: 2023, risk_index: 64, note: 'Healthy adults: lipids about every 5 years; sooner if abnormal.', source: 'Lipid guidelines' },
    { id: 'iy_cvd_2024', illness_key: 'cvd', year: 2024, risk_index: 66, note: 'Lp(a) once-in-a-lifetime screen gained support.', source: 'AHA lipid updates' },
    { id: 'iy_cvd_2025', illness_key: 'cvd', year: 2025, risk_index: 67, note: 'ApoB preferred as particle count when available.', source: 'Preventive cardiology 2025–26' },
    { id: 'iy_cvd_2026', illness_key: 'cvd', year: 2026, risk_index: 69, note: 'PREVENT equations + CKM: LDL ≥190 mg/dL is treat-now, independent of score.', source: 'AHA/ACC 2026 CKM' },

    // CKD
    { id: 'iy_ckd_2018', illness_key: 'ckd', year: 2018, risk_index: 48, note: 'Most CKD still undiagnosed; creatinine alone misses early disease.', source: 'KDIGO' },
    { id: 'iy_ckd_2019', illness_key: 'ckd', year: 2019, risk_index: 49, note: 'eGFR <60 or UACR ≥30 mg/g defines CKD.', source: 'KDIGO' },
    { id: 'iy_ckd_2020', illness_key: 'ckd', year: 2020, risk_index: 51, note: 'Fewer annual kidney tests.', source: 'Public health trend' },
    { id: 'iy_ckd_2021', illness_key: 'ckd', year: 2021, risk_index: 52, note: 'Diabetes and hypertension remain the main drivers.', source: 'KDIGO' },
    { id: 'iy_ckd_2022', illness_key: 'ckd', year: 2022, risk_index: 54, note: 'Rising creatinine year-on-year is an early warning even if still “normal”.', source: 'Clinic pattern' },
    { id: 'iy_ckd_2023', illness_key: 'ckd', year: 2023, risk_index: 55, note: 'Dual testing: eGFR + UACR.', source: 'KDIGO heatmap' },
    { id: 'iy_ckd_2024', illness_key: 'ckd', year: 2024, risk_index: 57, note: 'CKM stage 2–3: kidney labs at least yearly in higher-risk people.', source: 'AHA CKM' },
    { id: 'iy_ckd_2025', illness_key: 'ckd', year: 2025, risk_index: 58, note: 'SGLT2 inhibitors changed kidney-protection conversation.', source: 'KDIGO / ADA' },
    { id: 'iy_ckd_2026', illness_key: 'ckd', year: 2026, risk_index: 60, note: '2026 CKM: eGFR with glycemia and lipids on the same prevention calendar.', source: 'AHA/ACC/ADA/ASN 2026' },

    // Thyroid
    { id: 'iy_thy_2018', illness_key: 'hypothyroid', year: 2018, risk_index: 44, note: 'TSH used when symptoms or autoimmune risk present.', source: 'Endocrine practice' },
    { id: 'iy_thy_2020', illness_key: 'hypothyroid', year: 2020, risk_index: 46, note: 'Fatigue workups often skipped TSH.', source: 'Clinic pattern' },
    { id: 'iy_thy_2022', illness_key: 'hypothyroid', year: 2022, risk_index: 47, note: 'TSH >4.5 mIU/L commonly flagged for follow-up.', source: 'Lab reference bands' },
    { id: 'iy_thy_2024', illness_key: 'hypothyroid', year: 2024, risk_index: 48, note: 'Type 1 diabetes cohorts still get periodic TSH.', source: 'ADA' },
    { id: 'iy_thy_2026', illness_key: 'hypothyroid', year: 2026, risk_index: 49, note: 'TSH when suspected; not a universal annual screen.', source: 'ADA / endocrine 2026' },

    // NAFLD / metabolic liver
    { id: 'iy_liv_2018', illness_key: 'fatty_liver', year: 2018, risk_index: 50, note: 'ALT often the only liver clue on a routine panel.', source: 'Hepatology practice' },
    { id: 'iy_liv_2020', illness_key: 'fatty_liver', year: 2020, risk_index: 54, note: 'Weight and triglyceride rise increased fatty-liver signals.', source: 'Metabolic trend' },
    { id: 'iy_liv_2022', illness_key: 'fatty_liver', year: 2022, risk_index: 58, note: 'ALT persistently >55 U/L with high TG suggests NAFLD risk.', source: 'Clinic pattern' },
    { id: 'iy_liv_2024', illness_key: 'fatty_liver', year: 2024, risk_index: 61, note: 'Renamed MASLD in many papers; still metabolic at core.', source: 'Hepatology 2023–24' },
    { id: 'iy_liv_2026', illness_key: 'fatty_liver', year: 2026, risk_index: 63, note: 'CKM 2026 treats liver, glucose, lipids and BP as one cluster.', source: '2026 CKM guideline' },

    // Anemia / nutrition
    { id: 'iy_an_2018', illness_key: 'anemia', year: 2018, risk_index: 55, note: 'Hemoglobin <12 g/dL (women) / <13 (men) still the workhorse cutoff.', source: 'WHO anemia' },
    { id: 'iy_an_2022', illness_key: 'anemia', year: 2022, risk_index: 54, note: 'Iron and B12 often missing from “full body” PDFs.', source: 'Clinic pattern' },
    { id: 'iy_an_2026', illness_key: 'anemia', year: 2026, risk_index: 53, note: 'Low Hb plus rising creatinine needs kidney + nutrition review.', source: 'CKD / WHO' },

    // Gout / uric acid
    { id: 'iy_gout_2018', illness_key: 'gout', year: 2018, risk_index: 42, note: 'Uric acid >7 mg/dL linked to gout flares.', source: 'Rheumatology' },
    { id: 'iy_gout_2022', illness_key: 'gout', year: 2022, risk_index: 46, note: 'Metabolic syndrome pushed uric acid up with triglycerides.', source: 'CKM overlap' },
    { id: 'iy_gout_2026', illness_key: 'gout', year: 2026, risk_index: 48, note: 'Treat as part of metabolic cluster, not an isolated joint problem.', source: 'CKM 2026' },

    // Vitamin D
    { id: 'iy_vitd_2018', illness_key: 'vitamin_d', year: 2018, risk_index: 62, note: '<20 ng/mL widely treated as deficient.', source: 'Endocrine Society practice' },
    { id: 'iy_vitd_2022', illness_key: 'vitamin_d', year: 2022, risk_index: 64, note: 'Indoor work and low sun kept deficiency common.', source: 'Population labs' },
    { id: 'iy_vitd_2026', illness_key: 'vitamin_d', year: 2026, risk_index: 63, note: 'Correct deficiency; do not treat as a stand-alone disease predictor.', source: 'Endocrine practice 2026' },

    // Hypertension
    { id: 'iy_bp_2018', illness_key: 'hypertension', year: 2018, risk_index: 60, note: '≥140/90 mm Hg remains stage 2 in many Indian clinic flows.', source: 'Hypertension guidelines' },
    { id: 'iy_bp_2022', illness_key: 'hypertension', year: 2022, risk_index: 62, note: 'Home BP gaps hid rising systolic trends.', source: 'Clinic pattern' },
    { id: 'iy_bp_2024', illness_key: 'hypertension', year: 2024, risk_index: 63, note: 'Target often <130/80 in higher CKM risk.', source: 'AHA' },
    { id: 'iy_bp_2026', illness_key: 'hypertension', year: 2026, risk_index: 65, note: '2026 CKM: check BP every visit; ≥140/90 treat regardless of score.', source: 'AHA/ACC 2026' },
];

module.exports = { ILLNESS_YEARS };
