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

  const sampleJpeg =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hjc5OTgy/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
  const frame = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: sampleJpeg,
    width: 64,
    height: 64,
  });
  record(!!frame?.id, 'camera_memory', frame?.id || 'no frame');
  const cleanupFrameIds = [frame?.id].filter(Boolean);

  const live = await nearby.getVendorCameraLive('v_smart1', { limit: 5 });
  record(live.some((r) => r.id === frame?.id), 'camera_live_poll', `${live.length} frame(s)`);

  nearby.setVendorPolicy('v_smart1', { cameraAiEnabled: true });
  const aiPreview = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: sampleJpeg,
    liveOnly: true,
  });
  record(!!aiPreview?.id, 'camera_ai_preview', aiPreview?.id || 'rejected');
  const aiEvent = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: sampleJpeg,
    eventCapture: true,
    eventRule: 'motion_delta',
    eventLabel: 'Movement above normal baseline',
  });
  record(!!aiEvent?.eventCapture, 'camera_ai_event', aiEvent?.id || 'rejected');
  const eventsOnly = await nearby.getVendorCameraLive('v_smart1', { limit: 10, eventsOnly: true });
  record(
    eventsOnly.some((r) => r.id === aiEvent?.id) && !eventsOnly.some((r) => r.id === aiPreview?.id),
    'camera_ai_events_only',
    `${eventsOnly.length} event row(s)`
  );
  nearby.setVendorPolicy('v_smart1', { cameraAiEnabled: false });

  // Validate vendor recordingEnabled toggle (when disabled, auto-recording skips; when enabled, records)
  nearby.setVendorPolicy('v_smart1', { recordingEnabled: false, cameraStreamIntervalSec: 30 });
  const skippedFrame = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: sampleJpeg,
  });
  record(
    skippedFrame === null || skippedFrame?.skipped === true,
    'vendor_recording_disabled_camera',
    skippedFrame === null ? 'skipped (null)' : skippedFrame?.reason || 'unexpected'
  );
  const skippedVoice = nearby.appendVoiceTranscript({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    text: 'should skip when recording disabled',
    final: true,
  });
  record(
    skippedVoice === null || skippedVoice?.skipped === true,
    'vendor_recording_disabled_voice',
    skippedVoice === null ? 'skipped (null)' : skippedVoice?.reason || 'unexpected'
  );
  const forcedSnapshot = await nearby.appendCameraLiveFrame({
    vendorId: 'v_smart1',
    userId: session.userId,
    sessionId: session.id,
    imageBase64: sampleJpeg,
    forceRecord: true,
  });
  record(!!forcedSnapshot?.id, 'vendor_force_snapshot_bypass', forcedSnapshot?.id || 'failed');
  if (forcedSnapshot?.id) cleanupFrameIds.push(forcedSnapshot.id);
  nearby.setVendorPolicy('v_smart1', { recordingEnabled: true, cameraStreamIntervalSec: 30 });

  // Validate Smart User 1 offline undelivered message storage (based on vendor dataRetentionDays) & online delivery
  nearby.setVendorPolicy('v_smart1', { recordingEnabled: true, cameraStreamIntervalSec: 5, dataRetentionDays: 3 });
  if (db.inMemoryDb?.smartVendorUserPresence) {
    db.inMemoryDb.smartVendorUserPresence['usr_smart1'] = {
      userId: 'usr_smart1',
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      online: false,
    };
  }
  const queuedMsgRes = nearby.sendVendorMessageToUser({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    message: 'Offline test message for Smart User 1 (retained until online)',
  });
  const queuedMsg = queuedMsgRes?.message || queuedMsgRes;
  record(
    !!queuedMsg?.id && queuedMsg.deliveredToUser === false && queuedMsgRes?.userOnline === false,
    'smart_user1_queue_offline_message',
    `${queuedMsg?.id} (retention=${nearby.getVendorPolicy('v_smart1').dataRetentionDays}d)`
  );
  const pendingBeforeOnline = nearby.getUndeliveredMessagesForUser('usr_smart1', { vendorId: 'v_smart1' });
  record(
    pendingBeforeOnline.some((m) => m.id === queuedMsg?.id),
    'smart_user1_retained_while_offline',
    `${pendingBeforeOnline.length} pending offline`
  );
  // Simulate Smart User 1 coming online -> all undelivered messages deliver immediately
  nearby.recordUserOnlinePresence('usr_smart1', { vendorId: 'v_smart1', via: 'validate_online' });
  const deliveredMsgs = nearby.deliverPendingMessagesForUser('usr_smart1');
  record(
    deliveredMsgs.some((m) => m.id === queuedMsg?.id && m.deliveredToUser === true),
    'smart_user1_deliver_online_message',
    `${deliveredMsgs.length} delivered on reconnect`
  );
  const ackRes = nearby.ackUndeliveredMessagesForUser('usr_smart1', [queuedMsg?.id]);
  const ackedCount = typeof ackRes === 'number' ? ackRes : ackRes?.ackedCount ?? ackRes?.acknowledged ?? 0;
  record(ackedCount >= 1, 'smart_user1_ack_message', `acked=${ackedCount}`);

  // Validate vendor remote control of user mobile from idle mode + snapshot & camera switching with and without WiFi scans
  nearby.updateUserMobileState('usr_smart1', {
    vendorId: 'v_smart1',
    operatingMode: 'idle',
    recordingEnabled: false,
    cameraFacing: 'back',
  });
  const wakeCmdRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'wake_from_idle',
    params: { intervalSec: 5, cameraFacing: 'front', withWifiScan: true },
  });
  record(
    !!wakeCmdRes?.command?.id &&
      wakeCmdRes?.session?.vendorId === 'v_smart1' &&
      ['vendor_controlled', 'active'].includes(wakeCmdRes?.mobileState?.operatingMode) &&
      wakeCmdRes?.withWifiScan === true,
    'vendor_idle_mobile_control_wake',
    `${wakeCmdRes?.command?.id} (mode=${wakeCmdRes?.mobileState?.operatingMode})`
  );
  if (wakeCmdRes?.session?.id) cleanupSessionIds.push(wakeCmdRes.session.id);

  // Snapshot WITHOUT WiFi scan
  const snapNoWifiRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'capture_snapshot',
    params: { withWifiScan: false },
  });
  record(
    !!snapNoWifiRes?.command?.id && snapNoWifiRes?.withWifiScan === false && snapNoWifiRes?.command?.params?.withWifiScan === false,
    'vendor_remote_snapshot_without_wifi',
    `${snapNoWifiRes?.command?.id} (withWifiScan=false)`
  );

  // Snapshot WITH WiFi scan
  const snapWithWifiRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'capture_snapshot',
    params: { withWifiScan: true },
  });
  record(
    !!snapWithWifiRes?.command?.id && snapWithWifiRes?.withWifiScan === true && snapWithWifiRes?.command?.params?.withWifiScan === true,
    'vendor_remote_snapshot_with_wifi',
    `${snapWithWifiRes?.command?.id} (withWifiScan=true)`
  );

  // Camera switch WITHOUT WiFi scan (front -> back)
  const switchCamNoWifiRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'switch_camera',
    params: { cameraFacing: 'back', withWifiScan: false },
  });
  record(
    !!switchCamNoWifiRes?.command?.id &&
      switchCamNoWifiRes?.mobileState?.cameraFacing === 'back' &&
      switchCamNoWifiRes?.withWifiScan === false,
    'vendor_remote_switch_camera_without_wifi',
    `facing=${switchCamNoWifiRes?.mobileState?.cameraFacing} (withWifiScan=false)`
  );

  // Camera switch WITH WiFi scan (back -> front)
  const switchCamWithWifiRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'switch_camera',
    params: { facing: 'front', withWifiScan: true },
  });
  record(
    !!switchCamWithWifiRes?.command?.id &&
      switchCamWithWifiRes?.mobileState?.cameraFacing === 'front' &&
      switchCamWithWifiRes?.withWifiScan === true,
    'vendor_remote_switch_camera_with_wifi',
    `facing=${switchCamWithWifiRes?.mobileState?.cameraFacing} (withWifiScan=true)`
  );

  // Stop recording (return to idle) & Start recording (wake + auto-record)
  const stopRecCmdRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'stop_recording',
    params: {},
  });
  record(
    !!stopRecCmdRes?.command?.id &&
      stopRecCmdRes?.mobileState?.operatingMode === 'idle' &&
      stopRecCmdRes?.mobileState?.recordingEnabled === false,
    'vendor_remote_stop_recording_idle',
    `mode=${stopRecCmdRes?.mobileState?.operatingMode}, rec=${stopRecCmdRes?.mobileState?.recordingEnabled}`
  );

  const startRecCmdRes = await nearby.sendVendorRemoteCommand({
    vendorId: 'v_smart1',
    userId: 'usr_smart1',
    command: 'start_recording',
    params: { intervalSec: 5, withWifiScan: true },
  });
  record(
    !!startRecCmdRes?.command?.id &&
      ['vendor_controlled', 'active'].includes(startRecCmdRes?.mobileState?.operatingMode) &&
      startRecCmdRes?.mobileState?.recordingEnabled === true &&
      startRecCmdRes?.mobileState?.cameraStreamIntervalSec === 5,
    'vendor_remote_start_recording_active',
    `mode=${startRecCmdRes?.mobileState?.operatingMode}, rec=${startRecCmdRes?.mobileState?.recordingEnabled}, interval=${startRecCmdRes?.mobileState?.cameraStreamIntervalSec}s`
  );

  const deliveredCmds = nearby.deliverPendingRemoteCommandsForUser('usr_smart1');
  const allCmdIds = [
    wakeCmdRes?.command?.id,
    snapNoWifiRes?.command?.id,
    snapWithWifiRes?.command?.id,
    switchCamNoWifiRes?.command?.id,
    switchCamWithWifiRes?.command?.id,
    stopRecCmdRes?.command?.id,
    startRecCmdRes?.command?.id,
  ].filter(Boolean);
  record(
    deliveredCmds.some((c) => c.id === wakeCmdRes?.command?.id) && deliveredCmds.length >= allCmdIds.length,
    'vendor_idle_mobile_control_deliver',
    `${deliveredCmds.length} command(s)`
  );
  const ackedCmdRes = nearby.ackUserRemoteCommands('usr_smart1', allCmdIds, {
    operatingMode: 'active',
    cameraFacing: 'front',
  });
  const ackedCmdCount = typeof ackedCmdRes === 'number' ? ackedCmdRes : ackedCmdRes?.ackedCount ?? 0;
  record(ackedCmdCount >= allCmdIds.length, 'vendor_idle_mobile_control_ack', `acked=${ackedCmdCount}`);

  // Validate buildVendorDashboard exposes Smart User 1 mobileState, remoteCommands, undeliveredMessages, and recording policy
  const dash = await nearby.buildVendorDashboard('v_smart1');
  const smartUser1Row = (dash?.users || dash?.connectedUsers || []).find((u) => u.userId === 'usr_smart1');
  record(
    !!smartUser1Row &&
      !!smartUser1Row.mobileState &&
      Array.isArray(smartUser1Row.remoteCommands) &&
      Array.isArray(smartUser1Row.undeliveredMessages) &&
      typeof dash?.policy?.recordingEnabled === 'boolean',
    'vendor_dashboard_smart_user1_complete',
    `user=${smartUser1Row?.userId}, mode=${smartUser1Row?.mobileState?.operatingMode}, cmds=${smartUser1Row?.remoteCommands?.length}`
  );

  const store = db.inMemoryDb;
  const oldVoiceId = `svt_old_${Date.now()}`;
  const retentionDays = getSmartLiveRetentionDaysSync();
  nearby.setVendorPolicy('v_smart1', {
    recordingEnabled: true,
    cameraStreamIntervalSec: 30,
    dataRetentionDays: retentionDays,
  });
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
        imageBase64: sampleJpeg,
        at: new Date().toISOString(),
      });
      record(inserted, 'mysql_insert_camera', testId);
      if (cleanup) await pool.query('DELETE FROM smart_camera_frames WHERE id = ?', [testId]).catch(() => {});

      const frame2 = await nearby.appendCameraLiveFrame({
        vendorId: 'v_smart1',
        userId: 'u_validate_mysql',
        imageBase64: sampleJpeg,
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
