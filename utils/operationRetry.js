/**
 * Retry transient failures up to 3 times — keeps the app running.
 * Non-retryable validation/business errors fail immediately.
 */
const LOG = require('./logger');
const { isTransientConnectionError } = require('./mysqlTransientErrors');

const NON_RETRY_STEPS = new Set([
  'empty_workbook',
  'file_missing',
  'busy',
  'validation',
  'auth',
]);

function isRetryableOperationError(err) {
  if (!err) return false;
  if (err.retry === false) return false;
  const step = String(err.tradingExcelStep || err.step || '');
  if (NON_RETRY_STEPS.has(step)) return false;
  if (isTransientConnectionError(err)) return true;
  const msg = String(err.message || err);
  if (/ECONNRESET|ETIMEDOUT|socket|timeout|503|502|504|temporarily unavailable/i.test(msg)) {
    return true;
  }
  if (/not found|required|invalid|forbidden|unauthorized|already in progress/i.test(msg)) {
    return false;
  }
  return false;
}

async function withOperationRetry(fn, {
  maxAttempts = 3,
  label = 'operation',
  delayMs = 800,
  shouldRetry = isRetryableOperationError,
} = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
      const wait = delayMs * attempt;
      LOG.warning(`[Retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message} — retry in ${wait}ms`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastErr;
}

module.exports = {
  withOperationRetry,
  isRetryableOperationError,
};
