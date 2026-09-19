/**
 * SGATE smoke tests — same as npm run validate:smart-sgate (super-admin + maintenance sync).
 */
const smartCameraMysql = require('./smartCameraMysqlService');

async function runSmartSgateValidation({ cleanup = true } = {}) {
  const checks = [];
  let failed = 0;
  const record = (ok, name, detail) => {
    checks.push({ ok, name, detail: detail || null });
    if (!ok) failed += 1;
  };

  const db = require('../database');
  const nearby = require('./smartService');
  const { getSmartLiveRetentionDaysSync, refreshSmartLiveSettings } = require('./smartLiveSettingsService');

  try {
    await refreshSmartLiveSettings();
    record(true, 'smart_live_settings', `retentionDays=${getSmartLiveRetentionDaysSync()}`);
  } catch (e) {
    record(false, 'smart_live_settings', e.message);
  }

  record(typeof nearby.resolveVendorDisplayName === 'function', 'resolveVendorDisplayName', 'exported');
  record(typeof nearby.buildVendorDashboard === 'function', 'buildVendorDashboard', 'exported');

  const session = nearby.recordGateConnection({
    userId: `u_sgate_val_${Date.now()}`,
    userDisplayName: 'Validate User',
    vendorId: 'v_smart1',
    vendorName: 'Smart Home Hub',
    channel: 'wifi',
    networkLabel: 'Test SSID',
  });
  record(!!session?.vendorName, 'gate_vendorName', session?.vendorName || 'missing');
  const cleanupSessionIds = [session?.id].filter(Boolean);

  const frame = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: 'data:image/jpeg;base64,/9j/4AAQ',
    width: 64,
    height: 64,
  });
  record(!!frame?.id, 'camera_memory', frame?.id || 'no frame');
  const cleanupFrameIds = [frame?.id].filter(Boolean);

  const live = await nearby.getVendorCameraLive('v_smart1', { limit: 5 });
  record(live.some((r) => r.id === frame?.id), 'camera_live_poll', `${live.length} frame(s)`);

  const store = db.inMemoryDb;
  const oldVoiceId = `svt_old_${Date.now()}`;
  const retentionDays = getSmartLiveRetentionDaysSync();
  if (store?.smartNearbyVoiceStreams) {
    store.smartNearbyVoiceStreams.push({
      id: oldVoiceId,
      vendorId: 'v_smart1',
      userId: 'u_old',
      text: 'stale',
      at: new Date(Date.now() - (retentionDays + 1) * 24 * 60 * 60 * 1000).toISOString(),
    });
    const purged = nearby.purgeExpiredLiveStreamsMemory();
    record(purged.voiceRemoved >= 1, 'retention_purge_memory', `removed ${purged.voiceRemoved} voice row(s)`);
  } else {
    record(false, 'retention_purge_memory', 'no voice store');
  }

  let pool = db.getPool?.() || null;
  if (!pool && db.getType?.() === 'mysql' && db.featureConnectionManager?.acquireForSync) {
    pool = await db.featureConnectionManager.acquireForSync('smart');
  }
  if (!pool && typeof db.ensureWritePool === 'function') {
    pool = await db.ensureWritePool();
  }

  if (db.getType?.() === 'mysql' && pool) {
    try {
      await db.ensureFeatureSchema('smart');
      const testId = `scf_val_api_${Date.now()}`;
      const inserted = await smartCameraMysql.insertCameraFrame({
        id: testId,
        vendorId: 'v_smart1',
        userId: 'u_validate_mysql',
        imageBase64: 'data:image/jpeg;base64,TEST',
        at: new Date().toISOString(),
      });
      record(inserted, 'mysql_insert_camera', testId);
      if (cleanup) await pool.query('DELETE FROM smart_camera_frames WHERE id = ?', [testId]).catch(() => {});

      const frame2 = await nearby.appendCameraLiveFrame({
        vendorId: 'v_smart1',
        userId: 'u_validate_mysql',
        imageBase64: 'data:image/jpeg;base64,TESTMYSQL2',
      });
      record(frame2?.mysqlPersisted === true, 'mysql_append_camera', frame2?.mysqlPersisted ? 'ok' : 'not persisted');
      if (frame2?.id) cleanupFrameIds.push(frame2.id);

      const merged = await nearby.getVendorCameraLive('v_smart1', { limit: 20 });
      record(merged.some((r) => r.id === frame2?.id), 'mysql_merge_live', `${merged.length} row(s)`);
    } catch (e) {
      record(false, 'mysql_camera_pipeline', e.message);
    }
  } else {
    record(true, 'mysql_camera_pipeline', 'skipped (inmemory or no pool)');
  }

  if (cleanup && pool && cleanupFrameIds.length) {
    for (const id of cleanupFrameIds) {
      await pool.query('DELETE FROM smart_camera_frames WHERE id = ?', [id]).catch(() => {});
    }
  }

  if (cleanup && cleanupSessionIds.length) {
    for (const sid of cleanupSessionIds) {
      nearby.endGateConnection(sid, 'validate_cleanup');
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  return {
    success: failed === 0,
    checks,
    passed,
    total: checks.length,
    failed,
    message: failed === 0 ? 'validate:smart-sgate passed' : `${failed} check(s) failed`,
    retentionDays: getSmartLiveRetentionDaysSync(),
    dbType: db.getType?.(),
  };
}

module.exports = { runSmartSgateValidation };
