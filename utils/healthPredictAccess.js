'use strict';

const HEALTH_CATEGORY_NEEDLES = [
    'hospital',
    'doctor',
    'clinic',
    'medical',
    'healthcare',
    'health',
    'dental',
    'physician',
    'nursing',
];

function isHealthPredictCategory(category) {
    const text = String(category || '').toLowerCase();
    if (!text) return false;
    return HEALTH_CATEGORY_NEEDLES.some((needle) => text.includes(needle));
}

function shopsWithHealthPredict(vendors = []) {
    return (Array.isArray(vendors) ? vendors : []).filter((v) => isHealthPredictCategory(v?.category));
}

module.exports = {
    isHealthPredictCategory,
    shopsWithHealthPredict,
};
