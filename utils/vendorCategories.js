'use strict';

const DEFAULT_VENDOR_CATEGORIES = ['Shop', 'Hotel', 'Hospital', 'Doctor', 'Railway'];

const titleCaseCategory = (value) => {
  const cleaned = String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
};

const uniqueSortedCategories = (list = []) => {
  const map = new Map();
  [...DEFAULT_VENDOR_CATEGORIES, ...(Array.isArray(list) ? list : [])].forEach((item) => {
    const label = titleCaseCategory(item);
    if (!label) return;
    const key = label.toLowerCase();
    if (!map.has(key)) map.set(key, label);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
};

module.exports = {
  DEFAULT_VENDOR_CATEGORIES,
  titleCaseCategory,
  uniqueSortedCategories,
};
