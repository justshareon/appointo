/**
 * Super-admin uploaded trading Excel workbooks (base64 → disk).
 */
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '../uploads/trading');
let lastUploaded = null;

function ensureDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

function sanitizeName(name = 'upload.xlsx') {
  const base = path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.endsWith('.xlsx') || base.endsWith('.xls') ? base : `${base}.xlsx`;
}

function saveUpload({ fileName, dataBase64 }) {
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    throw new Error('Missing Excel file data (dataBase64)');
  }
  ensureDir();
  const safeName = sanitizeName(fileName);
  const filePath = path.join(UPLOAD_DIR, `${Date.now()}_${safeName}`);
  const buf = Buffer.from(dataBase64, 'base64');
  if (!buf.length) {
    throw new Error('Uploaded file is empty');
  }
  fs.writeFileSync(filePath, buf);
  lastUploaded = {
    filePath,
    fileName: safeName,
    sizeBytes: buf.length,
    uploadedAt: new Date().toISOString(),
  };
  return { ...lastUploaded };
}

function getLastUploaded() {
  if (lastUploaded?.filePath && fs.existsSync(lastUploaded.filePath)) {
    return { ...lastUploaded };
  }
  return null;
}

function getUploadDir() {
  ensureDir();
  return UPLOAD_DIR;
}

module.exports = {
  saveUpload,
  getLastUploaded,
  getUploadDir,
  UPLOAD_DIR,
};
