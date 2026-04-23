#!/usr/bin/env node
// scripts/gen-q5-url.js
// Q5 契約 v2.4 Ch.0.9：dev-only signed URL generator
//
// 用途：
//   手動產合法 /apply signed URL，對 prod（或本地 dev）curl 測 /api/apply/visit
//   和 /api/apply/submit 的 happy path。不 wire Bot push，只是產 URL 用。
//
// 前置 — .env.local 要有：
//   Q5_APPLY_SIGNING_SECRET_V1       HMAC secret（從 Vercel env 拷一份）
//   Q5_APPLY_SIGNING_KEY_VERSION     當前 version（可省，default 1）
//
// 用法：
//   node scripts/gen-q5-url.js
//   node scripts/gen-q5-url.js --user U51808e2cc195967eba53701518e6f547 --trigger active
//   node scripts/gen-q5-url.js --base http://localhost:3000/apply
//   node scripts/gen-q5-url.js --curl
//
// Flags：
//   --user <U+32hex>              LINE userId（default 一休本人）
//   --trigger <passive|active>    觸發軌（default passive）
//   --base <url>                  覆寫 apply_url_base（default prod URL）
//   --curl                        印出 curl 範例（visit + submit 兩支）
//
// 不可用場景：
//   ❌ 不能在 prod 跑（secret 暴露風險）
//   ❌ 不是 Bot 推送路徑（Phase 4.2 才 wire pushQ5SoftInvite）
//   ❌ 不能用在自動化 CI（每跑一次會炸 q5_click_count baseline）

import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQ5ApplyPayload } from '../lib/q5-apply-url.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// 載入 .env.local（抄 verify-q5-atomic.js 的 pattern）
const envPath = resolve(projectRoot, '.env.local');
if (existsSync(envPath)) {
  const env = Object.fromEntries(
    readFileSync(envPath, 'utf-8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => {
        const [k, ...rest] = l.split('=');
        return [k.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')];
      })
  );
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--curl') {
      out.curl = true;
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = argv[++i];
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const USERID_RE = /^U[0-9a-f]{32}$/;
const TRIGGER_ALLOWED = new Set(['passive', 'active']);

const userId = args.user || 'U51808e2cc195967eba53701518e6f547'; // 一休本人
const triggerSource = args.trigger || 'passive';
const base = args.base || 'https://official-yihugh-line-bot.vercel.app/apply';

if (!USERID_RE.test(userId)) {
  console.error(`[gen-q5-url] invalid --user shape: ${userId}`);
  console.error('  格式：U 開頭 + 32 位 hex，例 U51808e2cc195967eba53701518e6f547');
  process.exit(1);
}
if (!TRIGGER_ALLOWED.has(triggerSource)) {
  console.error(`[gen-q5-url] invalid --trigger: ${triggerSource}`);
  console.error('  只接 passive 或 active');
  process.exit(1);
}

const kv = parseInt(process.env.Q5_APPLY_SIGNING_KEY_VERSION || '1', 10);
const secret = process.env[`Q5_APPLY_SIGNING_SECRET_V${kv}`];
if (!secret) {
  console.error(`[gen-q5-url] Q5_APPLY_SIGNING_SECRET_V${kv} not set in .env.local`);
  console.error('  → 去 Vercel Dashboard > Settings > Environment Variables 拷一份進 .env.local');
  console.error(`  → 或傳 --kv <n> 指定其他 key version`);
  process.exit(1);
}

const ts = Math.floor(Date.now() / 1000);
const params = { userid: userId, source: 'bot_q5', trigger: triggerSource, kv, ts };
const payload = buildQ5ApplyPayload(params);
const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
const qs = new URLSearchParams({ ...params, sig }).toString();
const url = `${base}?${qs}`;

const body = { ...params, sig };

console.log('');
console.log('============ SIGNED /apply URL ============');
console.log(url);
console.log('');
console.log('============ POST body (for /api/apply/visit) ============');
console.log(JSON.stringify(body, null, 2));
console.log('');

if (args.curl) {
  // visit 的 host：從 --base 抓 origin
  const origin = (() => {
    try {
      return new URL(base).origin;
    } catch {
      return 'https://official-yihugh-line-bot.vercel.app';
    }
  })();

  console.log('============ curl: /api/apply/visit ============');
  console.log(`curl -X POST ${origin}/api/apply/visit \\`);
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '${JSON.stringify(body)}'`);
  console.log('');

  const submitBody = {
    ...body,
    real_name: '測試用戶',
    phone: '0912345678',
    email: 'test@example.com',
    address: '台北市信義區測試路 1 號',
    gender: 'female',
    age: 35,
    program_choice: '12weeks',
    agreed_refund_policy: true,
  };
  console.log('============ curl: /api/apply/submit ============');
  console.log(`curl -X POST ${origin}/api/apply/submit \\`);
  console.log(`  -H 'Content-Type: application/json' \\`);
  console.log(`  -d '${JSON.stringify(submitBody)}'`);
  console.log('');
  console.log('⚠️  submit 會寫 applications 表 + stage=8。跑前確認 TEST_USER_ID 可被覆寫或 reset。');
}

console.log('提醒：每跑一次 visit 會累加 q5_click_count + 可能改 stage 6→7。');
console.log('北極星 baseline 若在量測期，少跑，或用 dev 專用測試 userId。');
