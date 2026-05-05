// Sheet → DB 同步 cron — 每 10 分鐘跑一次
// Vercel Cron: */10 * * * *
// 手動觸發: GET /api/cron/sheet-sync?secret=xxx
//
// 流程：
//   1. 讀 GoogleSheet 整張對帳資料（A 欄報名 ID + L/N/O/P/Q 欄）
//   2. 對每筆 row，比對 DB applications 狀態：
//      - sheet Q='V' && DB.status='pending' → markApplicationPaid（要 N/O/P 齊全）
//      - sheet Q='X' && DB.status in ['pending','paid'] → markApplicationCancelled
//      - 其他 → skip
//   3. markPaid 內部會自動加 tag「已報名減重班」+ 寫回 sheet（雙向同步）
//
// 設計原則：
//   - 衝突規則：sheet 為準（人工對帳習慣）
//   - tag 只加不減（取消不拿掉「已報名減重班」）
//   - 環境變數沒設 → 整段 skip，不影響其他 cron
//   - 個別 row 失敗不影響其他 row
//   - marked_by 一律 'wanxin'（cron 動作來源 = 婉馨在 sheet 對帳）

import { NextResponse } from 'next/server';
import {
  isSheetSyncEnabled,
  readSheetRowsForSync,
} from '../../../../lib/google-sheets.js';
import {
  getApplicationFull,
  markApplicationPaid,
  markApplicationCancelled,
} from '../../../../lib/applications.js';

export const maxDuration = 60;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  const isAuthorized =
    secret === process.env.ADMIN_SECRET ||
    request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isSheetSyncEnabled()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'sheet sync env not configured',
    });
  }

  try {
    const summary = await runSheetSync();
    return NextResponse.json({ ok: summary.errors.length === 0, ...summary });
  } catch (err) {
    console.error('[sheet-sync] fatal:', err);
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

async function runSheetSync() {
  const rows = await readSheetRowsForSync();
  const summary = {
    total: rows.length,
    paid: 0,
    cancelled: 0,
    skipped: 0,
    errors: [],
  };

  for (const r of rows) {
    try {
      const current = await getApplicationFull(r.applicationId);
      if (!current) {
        summary.skipped++;
        continue;
      }

      // 狀態同步邏輯（衝突規則：sheet 為準，但 cancelled 是終態不可反轉）
      if (r.statusChar === 'V' && current.status === 'pending') {
        if (!r.last5 || !r.amount || !r.date) {
          console.warn(
            '[sheet-sync] V mark but payment fields incomplete, skip:',
            r.applicationId,
            { last5: !!r.last5, amount: !!r.amount, date: !!r.date }
          );
          summary.skipped++;
          continue;
        }
        const result = await markApplicationPaid(r.applicationId, {
          last5: r.last5,
          amount: r.amount,
          date: r.date,
          marked_by: 'wanxin',
        });
        if (result.ok) {
          summary.paid++;
        } else {
          summary.errors.push({
            id: r.applicationId,
            action: 'paid',
            error: result.error,
            detail: result.detail,
          });
        }
      } else if (
        r.statusChar === 'X' &&
        (current.status === 'pending' || current.status === 'paid')
      ) {
        const result = await markApplicationCancelled(r.applicationId, {
          notes: r.notes || undefined,
          marked_by: 'wanxin',
        });
        if (result.ok) {
          summary.cancelled++;
        } else {
          summary.errors.push({
            id: r.applicationId,
            action: 'cancelled',
            error: result.error,
            detail: result.detail,
          });
        }
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors.push({
        id: r.applicationId,
        error: err?.message || String(err),
      });
    }
  }

  return summary;
}