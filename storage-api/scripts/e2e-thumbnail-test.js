/* eslint-disable */
// E2E thumbnail: upload 1 ảnh PNG thật → chờ backend sinh thumbnail webp → kiểm
// tra list trả thumbnailUrl (presigned) và URL đó fetch được (image/webp). Dọn sạch.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  return { url: get('SUPABASE_URL').replace(/\/$/, ''), anon: get('SUPABASE_ANON_KEY'), service: get('SUPABASE_SERVICE_ROLE_KEY') };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:3000';
  const email = `e2e+thumb${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null, fileId = null, AUTH = null;
  const log = (...a) => console.log(...a);

  try {
    // user + token
    let r = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    userId = (await r.json()).id;
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    AUTH = { Authorization: `Bearer ${(await r.json()).access_token}` };

    // tạo ảnh PNG 400x300
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 200, g: 60, b: 60 } } }).png().toBuffer();
    log('▶ upload ảnh PNG', png.length, 'bytes');

    r = await fetch(`${API}/uploads/init`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'thumb-test.png', size: String(png.length), mimeType: 'image/png', folderId: null }) });
    const init = await r.json(); fileId = init.fileId;
    r = await fetch(`${API}/uploads/part`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/octet-stream', 'x-file-id': fileId, 'x-upload-id': init.uploadId, 'x-part-number': '1' }, body: png });
    const etag = (await r.json()).ETag;
    r = await fetch(`${API}/uploads/complete`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: etag }] }) });
    log('   complete status =', (await r.json()).status);

    // chờ thumbnail sinh nền
    let thumbUrl = null;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      r = await fetch(`${API}/files?folderId=`, { headers: AUTH });
      const files = await r.json();
      const f = files.find((x) => x.id === fileId);
      if (f && f.thumbnailUrl) { thumbUrl = f.thumbnailUrl; break; }
    }
    if (!thumbUrl) throw new Error('Không sinh được thumbnail sau 15s');
    log('▶ thumbnailUrl (presigned) đã có:', thumbUrl.slice(0, 60) + '...');

    // fetch thumbnail
    const t = await fetch(thumbUrl);
    const ct = t.headers.get('content-type');
    const buf = Buffer.from(await t.arrayBuffer());
    log('   fetch thumb:', t.status, '| content-type =', ct, '| size =', buf.length, 'bytes');
    const meta = await sharp(buf).metadata();
    log('   thumb format =', meta.format, '| dims =', meta.width + 'x' + meta.height);
    if (t.status === 200 && meta.format === 'webp') log('\n✅ THUMBNAIL OK (ảnh)');
    else throw new Error('thumbnail không hợp lệ');

    // cleanup file
    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    fileId = null;
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    if (userId) await fetch(`${loadEnv().url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: { apikey: loadEnv().service, Authorization: `Bearer ${loadEnv().service}` } });
    log('   dọn user test xong');
  }
}
main();
