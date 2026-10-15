import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeD1 } from './fakeD1';
import { handleSync, handleTeacherAuth, type Env } from '../server/core';

const SECRET = 'rahasia-uji-yang-cukup-panjang-1234567890';
function makeEnv(): Env & { DB: ReturnType<typeof createFakeD1> } {
  return { DB: createFakeD1(), TEACHER_USERNAME: 'guru', TEACHER_PASSWORD: 'sandi-kuat', TEACHER_SESSION_SECRET: SECRET };
}
async function login(env: Env, username = 'guru', password = 'sandi-kuat') {
  return handleTeacherAuth(new Request('http://x/api/teacher-auth', { method: 'POST', body: JSON.stringify({ username, password }) }), env);
}
async function teacherToken(env: Env) { return (await (await login(env)).json()).token as string; }
async function call(env: Env, method: 'GET' | 'POST', opts: { token?: string; body?: unknown; query?: string } = {}) {
  const res = await handleSync(new Request(`http://x/api/sync${opts.query || ''}`, {
    method, headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }), env);
  return { status: res.status, body: await res.json() as any };
}
const token = (id: string, code: string, extra: object = {}) => ({ id, code, status: 'available', createdAt: '2026-10-15T00:00:00Z', ...extra });
const sub = (id: string, tok: { id: string; code: string }, extra: object = {}) => ({
  id, groupId: tok.id, groupCode: tok.code, status: 'in_progress', team: { teamName: 'Tim', schoolName: 'SD', members: [], agreement: '' },
  answers: {}, history: [], startedAt: '2026-10-15T00:00:00Z', ...extra,
});
const claim = (env: Env, tok: { id: string; code: string }, sid: string) =>
  call(env, 'POST', { body: { upsertTokens: [{ ...tok, status: 'claimed', claimedBySubmissionId: sid }] } });

async function seed(env: Env) {
  const t = await teacherToken(env);
  const r = await call(env, 'POST', { token: t, body: {
    upsertTokens: [token('tok_1', 'KPK-1A-91', { notes: 'catatan guru' }), token('tok_2', 'KPK-2B-47')],
    settings: { questions: [{ id: 'q1' }], trackLock: { isLocked: false, lockedTrack: null }, rubric: { a: 1 } },
  } });
  assert.equal(r.status, 200);
  return t;
}

test('login guru: tidak terkonfigurasi, salah sandi, benar, token dipalsukan', async () => {
  assert.equal((await login({ DB: createFakeD1() } as Env)).status, 503);
  const env = makeEnv();
  assert.equal((await login(env, 'guru', 'salah')).status, 401);
  const t = await teacherToken(env);
  assert.ok(t.includes('.'));
  assert.equal((await call(env, 'GET', { token: t })).status, 200);
  const [p, s] = t.split('.');
  assert.equal((await call(env, 'GET', { token: `${p}.${s.slice(0, -2)}xx` })).status, 401);
  const forgedPayload = Buffer.from(JSON.stringify({ sub: 'guru', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal((await call(env, 'GET', { token: `${forgedPayload}.${s}` })).status, 401);
});

test('GET publik tidak membocorkan jawaban/penilaian kelompok lain', async () => {
  const env = makeEnv(); const t = await seed(env);
  await claim(env, { id: 'tok_1', code: 'KPK-1A-91' }, 's1');
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('s1', { id: 'tok_1', code: 'KPK-1A-91' })] } })).status, 200);
  // guru menilai
  const full = (await call(env, 'GET', { token: t })).body.submissions[0];
  await call(env, 'POST', { token: t, body: { upsertSubmissions: [{ ...full, status: 'reviewed', evaluation: { totalScore: 90 }, reviewedAt: 'x' }] } });
  const other = await call(env, 'GET', { query: '?groupCode=KPK-2B-47' });
  assert.equal(other.body.submissions.length, 0);
  assert.equal(other.body.settings.rubric, undefined);
  assert.deepEqual(Object.keys(other.body.tokens[0]).sort(), ['code', 'createdAt', 'id', 'status']);
  const own = await call(env, 'GET', { query: '?groupCode=kpk-1a-91' });
  assert.equal(own.body.submissions.length, 1);
  assert.equal(own.body.submissions[0].evaluation, undefined, 'nilai belum dipublikasikan harus disembunyikan');
});

test('dua siswa berebut ID yang sama secara bersamaan: tepat satu menang', async () => {
  const env = makeEnv(); await seed(env);
  const tok = { id: 'tok_1', code: 'KPK-1A-91' };
  const results = await Promise.all([claim(env, tok, 'sA'), claim(env, tok, 'sB'), claim(env, tok, 'sC')]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409 && r.body.code === 'TOKEN_CLAIMED'));
});

test('klaim siswa tidak menimpa catatan guru; klaim ulang oleh sesi yang sama idempoten', async () => {
  const env = makeEnv(); const t = await seed(env);
  assert.equal((await claim(env, { id: 'tok_1', code: 'KPK-1A-91' }, 's1')).status, 200);
  assert.equal((await claim(env, { id: 'tok_1', code: 'KPK-1A-91' }, 's1')).status, 200);
  const stored = (await call(env, 'GET', { token: t })).body.tokens.find((x: any) => x.id === 'tok_1');
  assert.equal(stored.notes, 'catatan guru');
  assert.equal(stored.status, 'claimed');
  assert.equal(stored.claimedBySubmissionId, 's1');
});

test('siswa tidak bisa: hapus, ubah pengaturan, ubah kode, tulis ke sesi/ID lain, set status guru', async () => {
  const env = makeEnv(); await seed(env);
  const t1 = { id: 'tok_1', code: 'KPK-1A-91' }, t2 = { id: 'tok_2', code: 'KPK-2B-47' };
  await claim(env, t1, 's1'); await claim(env, t2, 's2');
  assert.equal((await call(env, 'POST', { body: { deleteSubmissions: ['s1'] } })).status, 403);
  assert.equal((await call(env, 'POST', { body: { settings: { questions: [] } } })).status, 403);
  assert.equal((await call(env, 'POST', { body: { upsertTokens: [{ ...t1, code: 'HACK-1', status: 'claimed', claimedBySubmissionId: 's1' }] } })).status, 403);
  const stolen = await call(env, 'POST', { body: { upsertSubmissions: [sub('s2', t1)] } }); // s2 memakai ID milik s1
  assert.equal(stolen.status, 409);
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('s1', t1, { status: 'results_published' })] } })).status, 403);
});

test('autosave siswa tidak menimpa evaluasi guru; sesi yang sudah dinilai terkunci', async () => {
  const env = makeEnv(); const t = await seed(env);
  const t1 = { id: 'tok_1', code: 'KPK-1A-91' };
  await claim(env, t1, 's1');
  await call(env, 'POST', { body: { upsertSubmissions: [sub('s1', t1, { status: 'submitted_pending_review' })] } });
  const full = (await call(env, 'GET', { token: t })).body.submissions[0];
  await call(env, 'POST', { token: t, body: { upsertSubmissions: [{ ...full, status: 'submitted_pending_review', evaluation: { totalScore: 77 } }] } });
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('s1', t1, { status: 'submitted_pending_review' })] } })).status, 200);
  assert.equal((await call(env, 'GET', { token: t })).body.submissions[0].evaluation.totalScore, 77);
  await call(env, 'POST', { token: t, body: { upsertSubmissions: [{ ...full, status: 'reviewed', evaluation: { totalScore: 77 } }] } });
  const locked = await call(env, 'POST', { body: { upsertSubmissions: [sub('s1', t1)] } });
  assert.equal(locked.status, 403);
});

test('HAPUS SAAT SISWA SEDANG MENGERJAKAN: data hilang, ID tersedia, sesi lama tidak hidup lagi', async () => {
  const env = makeEnv(); const t = await seed(env);
  const t1 = { id: 'tok_1', code: 'KPK-1A-91' };
  await claim(env, t1, 'sesi_lama');
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('sesi_lama', t1, { isTimerRunning: true })] } })).status, 200);

  // Guru menghapus (pola yang sama dengan klien: token dilepas + sesi dihapus dalam satu permintaan).
  const del = await call(env, 'POST', { token: t, body: {
    upsertTokens: [token('tok_1', 'KPK-1A-91', { revokedSubmissionIds: ['sesi_lama'] })],
    deleteSubmissions: ['sesi_lama'],
  } });
  assert.equal(del.status, 200);
  const state = (await call(env, 'GET', { token: t })).body;
  assert.equal(state.submissions.length, 0);
  assert.equal(state.tokens.find((x: any) => x.id === 'tok_1').status, 'available');

  // Perangkat siswa (belum tahu) masih mengirim autosave: harus ditolak dan tidak menghidupkan data.
  const late = await call(env, 'POST', { body: { upsertSubmissions: [sub('sesi_lama', t1, { isTimerRunning: true })] } });
  assert.equal(late.status, 409); assert.equal(late.body.code, 'SESSION_DELETED');
  assert.equal((await call(env, 'GET', { token: t })).body.submissions.length, 0);
  const lateClaim = await claim(env, t1, 'sesi_lama');
  assert.equal(lateClaim.status, 409); assert.equal(lateClaim.body.code, 'SESSION_DELETED');

  // Klien memeriksa status sesinya saat polling.
  const poll = await call(env, 'GET', { query: '?groupCode=KPK-1A-91&sessionId=sesi_lama' });
  assert.equal(poll.body.sessionRevoked, true);
  assert.equal((await call(env, 'GET', { query: '?groupCode=KPK-1A-91&sessionId=sesi_baru' })).body.sessionRevoked, false);

  // Kelompok yang sama (atau kelompok lain) boleh memulai sesi baru dengan ID tersebut.
  assert.equal((await claim(env, t1, 'sesi_baru')).status, 200);
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('sesi_baru', t1)] } })).status, 200);
});

test('hapus tanpa melepas ID secara eksplisit: server tetap melepas ID yang dipegang sesi itu', async () => {
  const env = makeEnv(); const t = await seed(env);
  const t2 = { id: 'tok_2', code: 'KPK-2B-47' };
  await claim(env, t2, 's2');
  await call(env, 'POST', { body: { upsertSubmissions: [sub('s2', t2)] } });
  assert.equal((await call(env, 'POST', { token: t, body: { deleteSubmissions: ['s2'] } })).status, 200);
  const state = (await call(env, 'GET', { token: t })).body;
  assert.equal(state.tokens.find((x: any) => x.id === 'tok_2').status, 'available');
  assert.equal((await call(env, 'POST', { body: { upsertSubmissions: [sub('s2', t2)] } })).status, 409);
});

test('ID yang dinonaktifkan guru tidak bisa diklaim; kode ID harus unik', async () => {
  const env = makeEnv(); const t = await seed(env);
  await call(env, 'POST', { token: t, body: { upsertTokens: [token('tok_2', 'KPK-2B-47', { status: 'disabled' })] } });
  assert.equal((await claim(env, { id: 'tok_2', code: 'KPK-2B-47' }, 's2')).status, 403);
  const dup = await call(env, 'POST', { token: t, body: { upsertTokens: [token('tok_9', 'kpk-1a-91')] } });
  assert.equal(dup.status, 409);
});

test('guru kedaluwarsa/token rusak mendapat 401, bukan data', async () => {
  const env = makeEnv(); await seed(env);
  const r = await call(env, 'GET', { token: 'rusak.rusak' });
  assert.equal(r.status, 401);
});
