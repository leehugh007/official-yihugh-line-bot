// 契約 v6 第 10.1.1 章：/api/health
// 用途：驗 migration 到位（test_mode=null 會讓全用戶靜默，必須有 contract check gate）
// GET /api/health                   → 基本健康檢查
// GET /api/health?contract=check    → 契約版本 + 22 settings + webhook_events 表全檢

import { NextResponse } from 'next/server';
import supabase from '../../../lib/supabase.js';
import { SETTING_SCHEMA } from '../../../lib/official-settings.js';

const EXPECTED_CONTRACT_VERSION = 'v6';

export async function GET(request) {
  const url = new URL(request.url);
  const isContractCheck = url.searchParams.get('contract') === 'check';

  if (!isContractCheck) {
    return NextResponse.json({
      ok: true,
      service: 'official-yihugh-line-bot',
    });
  }

  // 直查 DB，不透過 getSettingTyped（它會 fallback 到 defaults，永遠不會 null）
  const expectedKeys = Object.keys(SETTING_SCHEMA);
  const { data: settingsRows } = await supabase
    .from('official_settings')
    .select('key, value')
    .in('key', expectedKeys);

  const dbKeys = new Set((settingsRows || []).map((r) => r.key));
  const missingSettings = expectedKeys.filter((k) => !dbKeys.has(k));
  const dbVersionRow = (settingsRows || []).find((r) => r.key === 'contract_version');
  const dbVersion = dbVersionRow?.value || null;

  const testModeRow = (settingsRows || []).find((r) => r.key === 'test_mode');
  const testMode = testModeRow?.value === 'true';

  // 驗 official_webhook_events 表存在
  const { error: webhookTblErr } = await supabase
    .from('official_webhook_events')
    .select('event_id')
    .limit(1);
  const webhookTableReady = !webhookTblErr;

  return NextResponse.json({
    contract_version_code: EXPECTED_CONTRACT_VERSION,
    contract_version_db: dbVersion,
    mismatch: dbVersion !== EXPECTED_CONTRACT_VERSION,
    missing_settings: missingSettings,
    test_mode: testMode,
    webhook_idempotency_table: webhookTableReady ? 'ok' : 'missing',
    ok:
      dbVersion === EXPECTED_CONTRACT_VERSION &&
      missingSettings.length === 0 &&
      webhookTableReady,
  });
}
