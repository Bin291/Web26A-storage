/* eslint-disable */
// E2E: tạo user test (confirmed) → lấy access token ES256 → upload 1 file nhỏ
// (init/part/complete lên R2) → kiểm tra list → dọn sạch (xoá file + user).
// KHÔNG in token/secret. Chạy: node scripts/e2e-upload-test.js
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const get = (k) => {
    const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    url: get('SUPABASE_URL').replace(/\/$/, ''),
    anon: get('SUPABASE_ANON_KEY'),
    service: get('SUPABASE_SERVICE_ROLE_KEY'),
    api: (get('WEB_ORIGIN') && 'http://localhost:' + (get('PORT') || '3000')) || 'http://localhost:3000',
  };
}

async function main() {
  const { url, anon, service } = loadEnv();
  const API = 'http://localhost:' + (process.env.PORT || '3000');
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'Test-' + Math.random().toString(36).slice(2) + 'Aa1!';
  let userId = null;
  let fileId = null;

  const log = (...a) => console.log(...a);
  const step = (n) => log('\n▶ ' + n);

  try {
    // 1) Tạo user confirmed qua admin API
    step('1. Admin tạo user test (email_confirm=true)');
    let r = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`admin create user ${r.status}: ${await r.text()}`);
    const created = await r.json();
    userId = created.id;
    log('   user id =', userId);

    // 2) Password grant → access token ES256
    step('2. Đăng nhập lấy access token (ES256)');
    r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) throw new Error(`password grant ${r.status}: ${await r.text()}`);
    const tok = await r.json();
    const access = tok.access_token;
    const alg = JSON.parse(Buffer.from(access.split('.')[0], 'base64url').toString()).alg;
    log('   token alg =', alg);
    const AUTH = { Authorization: `Bearer ${access}` };

    // 3) init multipart
    step('3. POST /uploads/init');
    const bytes = Buffer.from('hello upload e2e ' + new Date().toISOString());
    r = await fetch(`${API}/uploads/init`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'e2e-test.txt', size: String(bytes.length), mimeType: 'text/plain', folderId: null }),
    });
    if (!r.ok) throw new Error(`init ${r.status}: ${await r.text()}`);
    const init = await r.json();
    fileId = init.fileId;
    log('   fileId =', fileId, '| uploadId len =', String(init.uploadId).length);

    // 4) upload part (raw octet-stream)
    step('4. POST /uploads/part (1 chunk lên R2)');
    r = await fetch(`${API}/uploads/part`, {
      method: 'POST',
      headers: {
        ...AUTH,
        'Content-Type': 'application/octet-stream',
        'x-file-id': fileId,
        'x-upload-id': init.uploadId,
        'x-part-number': '1',
      },
      body: bytes,
    });
    if (!r.ok) throw new Error(`part ${r.status}: ${await r.text()}`);
    const part = await r.json();
    log('   ETag =', part.ETag);

    // 5) complete
    step('5. POST /uploads/complete (ghép trên R2)');
    r = await fetch(`${API}/uploads/complete`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, uploadId: init.uploadId, parts: [{ PartNumber: 1, ETag: part.ETag }] }),
    });
    if (!r.ok) throw new Error(`complete ${r.status}: ${await r.text()}`);
    const done = await r.json();
    log('   status =', done.status, '| name =', done.name);

    // 6) list
    step('6. GET /files?folderId= (kiểm tra file xuất hiện)');
    r = await fetch(`${API}/files?folderId=`, { headers: AUTH });
    if (!r.ok) throw new Error(`list ${r.status}: ${await r.text()}`);
    const files = await r.json();
    const found = files.find((f) => f.id === fileId);
    log('   tổng file =', files.length, '| tìm thấy file test =', !!found);

    // 7) download url (presigned R2)
    step('7. GET /files/:id/download-url (presigned R2)');
    r = await fetch(`${API}/files/${fileId}/download-url`, { headers: AUTH });
    log('   status =', r.status, r.ok ? '(có presigned URL)' : `(${await r.text()})`);

    log('\n✅ UPLOAD E2E THÀNH CÔNG');

    // 8) cleanup file (trash + permanent → xoá R2 + DB)
    step('8. Dọn dẹp: xoá file + user test');
    await fetch(`${API}/files/${fileId}/trash`, { method: 'PATCH', headers: AUTH });
    const del = await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: AUTH });
    log('   xoá file:', del.status);
    fileId = null;
  } catch (e) {
    log('\n❌ LỖI:', e.message);
    process.exitCode = 1;
  } finally {
    // Dọn user test dù thành công hay lỗi
    if (userId) {
      const { url, service } = loadEnv();
      const d = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: service, Authorization: `Bearer ${service}` },
      });
      console.log('   xoá user test:', d.status);
    }
  }
}
main();
