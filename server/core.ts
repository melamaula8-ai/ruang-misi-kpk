/**
 * Logika backend Ruang Misi KPK yang tidak bergantung pada platform.
 * Dipakai oleh Cloudflare Pages Functions (functions/api/*.ts) dan oleh tes lokal
 * (tests/sync.test.ts) yang memakai SQLite sungguhan lewat adaptor D1.
 *
 * Semua penulisan dikirim lewat db.batch() sehingga atomik, dan setiap pelanggaran
 * aturan (ID sudah dipakai, sesi sudah dihapus guru) dijaga di dalam SQL, bukan hanya
 * di JavaScript, supaya dua perangkat yang menulis bersamaan tidak saling menimpa.
 */

export interface D1Result { results?: any[]; meta?: { changes?: number } }
export interface D1Stmt {
  bind(...values: unknown[]): D1Stmt;
  all<T = any>(): Promise<{ results: T[] }>;
  first<T = any>(): Promise<T | null>;
  run(): Promise<D1Result>;
}
export interface D1Like {
  prepare(sql: string): D1Stmt;
  batch(statements: D1Stmt[]): Promise<D1Result[]>;
}
export interface Env {
  DB: D1Like;
  TEACHER_USERNAME?: string;
  TEACHER_PASSWORD?: string;
  TEACHER_SESSION_SECRET?: string;
}

// ---------------------------------------------------------------- util umum
const encoder = new TextEncoder();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

class SyncError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
/** Perbandingan waktu-tetap agar kata sandi/tanda tangan tidak bocor lewat waktu respons. */
function safeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a), y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}
async function issueTeacherToken(env: Env, username: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ sub: username, exp: Date.now() + SESSION_TTL_MS })));
  return `${payload}.${await hmac(env.TEACHER_SESSION_SECRET || '', payload)}`;
}
async function verifyTeacherToken(env: Env, request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  const secret = env.TEACHER_SESSION_SECRET || '';
  if (!authorization.startsWith('Bearer ') || !secret) return false;
  const [payload, signature] = authorization.slice(7).trim().split('.');
  if (!payload || !signature) return false;
  if (!safeEqual(signature, await hmac(secret, payload))) return false;
  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return typeof decoded.sub === 'string' && decoded.exp > Date.now();
  } catch { return false; }
}

// ---------------------------------------------------------------- login guru
export async function handleTeacherAuth(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const userExpected = env.TEACHER_USERNAME || '';
  const passExpected = env.TEACHER_PASSWORD || '';
  if (!userExpected || !passExpected || !env.TEACHER_SESSION_SECRET) {
    return json({ error: 'Login guru belum dikonfigurasi di environment variables hosting.' }, 503);
  }
  let body: { username?: unknown; password?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (typeof body.username !== 'string' || typeof body.password !== 'string' ||
      !safeEqual(body.username, userExpected) || !safeEqual(body.password, passExpected)) {
    return json({ error: 'Username atau kata sandi tidak sesuai.' }, 401);
  }
  return json({ token: await issueTeacherToken(env, userExpected), expiresIn: SESSION_TTL_MS / 1000 });
}

// ---------------------------------------------------------------- sinkronisasi
type Row = { id: string; [key: string]: unknown };
const SETTINGS_KEYS = new Set(['questions', 'trackLock', 'rubric', 'customLogo']);
const PUBLIC_SETTINGS = ['questions', 'trackLock', 'customLogo'];
const STUDENT_STATUSES = new Set(['in_progress', 'submitted_pending_review', 'time_expired_pending_review']);
const MAX_ROWS_PER_REQUEST = 500;

const isRows = (v: unknown): v is Row[] =>
  Array.isArray(v) && v.length <= MAX_ROWS_PER_REQUEST && v.every((r) => r && typeof r === 'object' && typeof (r as Row).id === 'string' && (r as Row).id.length > 0 && (r as Row).id.length <= 120);
const isIds = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_ROWS_PER_REQUEST && v.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120);
const parse = (text: string) => { try { return JSON.parse(text); } catch { return null; } };
const upper = (v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : '');

const SQL = {
  upsertToken: `INSERT INTO group_tokens (id, code, status, claimed_by, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET code = excluded.code, status = excluded.status, claimed_by = excluded.claimed_by, data = excluded.data, updated_at = excluded.updated_at`,
  upsertSubmissionTeacher: `INSERT INTO submissions (id, group_code, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET group_code = excluded.group_code, data = excluded.data, updated_at = excluded.updated_at`,
  tombstone: `INSERT OR IGNORE INTO revoked_sessions (submission_id, group_code, revoked_at)
    VALUES (?, COALESCE((SELECT group_code FROM submissions WHERE id = ?), ?), ?)`,
  // Siswa hanya boleh menyimpan sesi yang (a) belum dihapus guru dan (b) memegang ID kelompoknya.
  upsertSubmissionStudent: `INSERT INTO submissions (id, group_code, data, updated_at)
    SELECT ?1, ?2, ?3, ?4
    WHERE NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE submission_id = ?1)
      AND EXISTS (SELECT 1 FROM group_tokens WHERE code = ?2 AND status = 'claimed' AND claimed_by = ?1)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  // Klaim atomik: hanya berhasil bila ID masih tersedia (atau sudah milik sesi yang sama) dan sesi belum dihapus.
  claimToken: `UPDATE group_tokens SET status = 'claimed', claimed_by = ?1, data = ?2, updated_at = ?3
    WHERE id = ?4 AND (status IN ('available', 'resubmit_allowed') OR claimed_by = ?1)
      AND NOT EXISTS (SELECT 1 FROM revoked_sessions WHERE submission_id = ?1)`,
  releaseTokenOfDeleted: `UPDATE group_tokens
    SET status = 'available', claimed_by = NULL, updated_at = ?2,
        data = json_set(json_remove(data, '$.claimedAt', '$.claimedBySubmissionId', '$.teamName'), '$.status', 'available')
    WHERE claimed_by = ?1 AND status = 'claimed'`,
};

async function isRevoked(db: D1Like, submissionId: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 AS x FROM revoked_sessions WHERE submission_id = ?').bind(submissionId).first());
}

async function handleGet(request: Request, env: Env, teacher: boolean): Promise<Response> {
  const db = env.DB;
  const [tokenRows, settingRows] = await Promise.all([
    db.prepare('SELECT data FROM group_tokens').all(),
    db.prepare('SELECT key, value FROM app_settings').all(),
  ]);
  const settings: Record<string, unknown> = {};
  for (const row of settingRows.results) settings[row.key] = parse(row.value);
  const tokens = tokenRows.results.map((r) => parse(r.data)).filter(Boolean);

  if (teacher) {
    const subs = (await db.prepare('SELECT data FROM submissions').all()).results.map((r) => parse(r.data)).filter(Boolean);
    return json({ initialized: tokens.length > 0 || subs.length > 0 || settingRows.results.length > 0, tokens, submissions: subs, settings });
  }

  const url = new URL(request.url);
  const groupCode = upper(url.searchParams.get('groupCode'));
  const sessionId = url.searchParams.get('sessionId') || '';
  const own = groupCode
    ? (await db.prepare('SELECT data FROM submissions WHERE group_code = ?').bind(groupCode).all()).results.map((r) => parse(r.data)).filter(Boolean)
    : [];
  const safeOwn = own.map((s: any) => {
    if (s.status === 'results_published') return s;
    const { evaluation: _e, reviewedAt: _r, publishedAt: _p, ...rest } = s;
    return rest;
  });
  const publicTokens = groupCode ? tokens.filter((d: any) => upper(d.code) === groupCode).map((d: any) => ({ id: d.id, code: d.code, status: d.status, createdAt: d.createdAt })) : [];
  const publicSettings: Record<string, unknown> = {};
  for (const key of PUBLIC_SETTINGS) if (key in settings) publicSettings[key] = settings[key];
  const body: Record<string, unknown> = {
    initialized: tokens.length > 0 || settingRows.results.length > 0,
    tokens: publicTokens, submissions: safeOwn, settings: publicSettings,
  };
  // Memberi tahu klien secara pasti bahwa sesinya sudah dihapus guru (tidak bergantung pada status ID kelompok).
  if (sessionId) body.sessionRevoked = await isRevoked(db, sessionId);
  return json(body);
}

async function handlePost(request: Request, env: Env, teacher: boolean): Promise<Response> {
  const db = env.DB;
  let payload: any;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, 400); }
  const { upsertTokens = [], deleteTokens = [], upsertSubmissions = [], deleteSubmissions = [], settings = {} } = payload || {};
  if (!isRows(upsertTokens) || !isRows(upsertSubmissions) || !isIds(deleteTokens) || !isIds(deleteSubmissions) ||
      !settings || typeof settings !== 'object' || Array.isArray(settings)) return json({ error: 'Invalid payload', code: 'BAD_REQUEST' }, 400);
  if (upsertTokens.some((t) => typeof t.code !== 'string' || !t.code.trim() || (t.code as string).length > 80)) {
    return json({ error: 'Setiap ID kelompok harus memiliki kode yang valid.', code: 'BAD_REQUEST' }, 400);
  }
  if (Object.keys(settings).some((k) => !SETTINGS_KEYS.has(k))) return json({ error: 'Unsupported settings key', code: 'BAD_REQUEST' }, 400);
  if (!teacher && (deleteTokens.length || deleteSubmissions.length || Object.keys(settings).length)) {
    return json({ error: 'Operasi ini hanya dapat dilakukan oleh guru.', code: 'FORBIDDEN' }, 403);
  }
  const now = Date.now();

  try {
    if (teacher) {
      const batch: D1Stmt[] = [];
      for (const token of upsertTokens as any[]) {
        const code = upper(token.code);
        const data = { ...token, code };
        batch.push(db.prepare(SQL.upsertToken).bind(token.id, code, String(token.status || 'available'), token.claimedBySubmissionId ?? null, JSON.stringify(data), now));
        // Sesi yang dicabut guru dicatat permanen agar tidak bisa disimpan lagi oleh perangkat siswa.
        for (const sid of Array.isArray(token.revokedSubmissionIds) ? token.revokedSubmissionIds : []) {
          if (typeof sid === 'string' && sid) batch.push(db.prepare(SQL.tombstone).bind(sid, sid, code, now));
        }
      }
      for (const row of upsertSubmissions as any[]) {
        const rev = await isRevoked(db, row.id);
        if (rev) continue; // guru tidak boleh tanpa sengaja menghidupkan lagi sesi yang sudah dihapus
        batch.push(db.prepare(SQL.upsertSubmissionTeacher).bind(row.id, upper(row.groupCode) || null, JSON.stringify(row), now));
      }
      for (const id of deleteSubmissions) {
        batch.push(db.prepare(SQL.tombstone).bind(id, id, null, now));
        batch.push(db.prepare('DELETE FROM submissions WHERE id = ?').bind(id));
        batch.push(db.prepare(SQL.releaseTokenOfDeleted).bind(id, now));
      }
      for (const id of deleteTokens) batch.push(db.prepare('DELETE FROM group_tokens WHERE id = ?').bind(id));
      for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
        if (value === null) batch.push(db.prepare('DELETE FROM app_settings WHERE key = ?').bind(key));
        else batch.push(db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, JSON.stringify(value), now));
      }
      if (batch.length) await db.batch(batch);
      return json({ ok: true });
    }

    // ---- siswa: hanya klaim ID kelompok dan simpan sesinya sendiri
    for (const incoming of upsertTokens as any[]) {
      const code = upper(incoming.code);
      if (incoming.status !== 'claimed' || typeof incoming.claimedBySubmissionId !== 'string' || !incoming.claimedBySubmissionId) {
        throw new SyncError('FORBIDDEN', 'Siswa hanya dapat mengklaim ID kelompok.', 403);
      }
      const sid = incoming.claimedBySubmissionId as string;
      const row = await db.prepare('SELECT data, status, claimed_by FROM group_tokens WHERE id = ?').bind(incoming.id).first();
      if (!row) throw new SyncError('TOKEN_MISSING', 'ID kelompok tidak ditemukan.', 409);
      const old = parse(row.data) || {};
      if (upper(old.code) !== code) throw new SyncError('FORBIDDEN', 'Kode ID kelompok tidak boleh diubah oleh siswa.', 403);
      if (row.status === 'disabled') throw new SyncError('FORBIDDEN', 'ID kelompok dinonaktifkan guru.', 403);
      if (await isRevoked(db, sid)) throw new SyncError('SESSION_DELETED', 'Sesi ini telah dihapus oleh guru. Masukkan kembali ID kelompok untuk memulai sesi baru.', 409);
      if (row.status === 'claimed' && row.claimed_by !== sid) throw new SyncError('TOKEN_CLAIMED', 'ID kelompok sudah dipakai kelompok lain.', 409);
      // Hanya bidang klaim yang diambil dari siswa; catatan guru dan bidang lain tetap aman.
      const merged = {
        ...old, status: 'claimed', claimedBySubmissionId: sid,
        claimedAt: old.claimedAt && row.claimed_by === sid ? old.claimedAt : (incoming.claimedAt || new Date(now).toISOString()),
        ...(typeof incoming.teamName === 'string' ? { teamName: incoming.teamName.slice(0, 200) } : {}),
      };
      const res = await db.prepare(SQL.claimToken).bind(sid, JSON.stringify(merged), now, incoming.id).run();
      if (!res.meta?.changes) {
        if (await isRevoked(db, sid)) throw new SyncError('SESSION_DELETED', 'Sesi ini telah dihapus oleh guru. Masukkan kembali ID kelompok untuk memulai sesi baru.', 409);
        throw new SyncError('TOKEN_CLAIMED', 'ID kelompok sudah dipakai kelompok lain.', 409);
      }
    }

    for (const incoming of upsertSubmissions as any[]) {
      const code = upper(incoming.groupCode);
      if (!code) throw new SyncError('FORBIDDEN', 'Jawaban harus terhubung dengan ID kelompok.', 403);
      if (await isRevoked(db, incoming.id)) throw new SyncError('SESSION_DELETED', 'Sesi ini telah dihapus oleh guru. Masukkan kembali ID kelompok untuk memulai sesi baru.', 409);
      const tokenRow = await db.prepare('SELECT id, status, claimed_by FROM group_tokens WHERE code = ?').bind(code).first();
      if (!tokenRow) throw new SyncError('TOKEN_MISSING', 'ID kelompok tidak terdaftar.', 409);
      if (tokenRow.status !== 'claimed' || tokenRow.claimed_by !== incoming.id || incoming.groupId !== tokenRow.id) {
        throw new SyncError('TOKEN_CLAIMED', 'ID kelompok belum diklaim oleh sesi ini.', 409);
      }
      const existingRow = await db.prepare('SELECT group_code, data FROM submissions WHERE id = ?').bind(incoming.id).first();
      const existing = existingRow ? parse(existingRow.data) : null;
      if (existingRow && upper(existingRow.group_code) !== code) throw new SyncError('FORBIDDEN', 'Sesi tidak cocok dengan ID kelompok.', 403);
      if (!STUDENT_STATUSES.has(String(incoming.status))) throw new SyncError('FORBIDDEN', 'Status ini hanya dapat ditetapkan oleh guru.', 403);
      if (existing && ['reviewed', 'results_published'].includes(existing.status)) {
        throw new SyncError('FORBIDDEN', 'Penilaian sudah selesai; minta izin guru untuk mengulang.', 403);
      }
      // Bidang milik guru tidak pernah berasal dari siswa.
      const data = { ...incoming, groupCode: code, evaluation: existing?.evaluation, reviewedAt: existing?.reviewedAt, publishedAt: existing?.publishedAt };
      const res = await db.prepare(SQL.upsertSubmissionStudent).bind(incoming.id, code, JSON.stringify(data), now).run();
      if (!res.meta?.changes) {
        if (await isRevoked(db, incoming.id)) throw new SyncError('SESSION_DELETED', 'Sesi ini telah dihapus oleh guru. Masukkan kembali ID kelompok untuk memulai sesi baru.', 409);
        throw new SyncError('TOKEN_CLAIMED', 'ID kelompok belum diklaim oleh sesi ini.', 409);
      }
    }
    return json({ ok: true });
  } catch (error: any) {
    if (error instanceof SyncError) return json({ error: error.message, code: error.code }, error.status);
    if (/UNIQUE/i.test(String(error?.message))) return json({ error: 'Kode ID kelompok harus unik.', code: 'DUPLICATE_CODE' }, 409);
    console.error('[sync] Database write failed', error);
    return json({ error: 'Data gagal disimpan ke database bersama.', code: 'DB_ERROR' }, 500);
  }
}

export async function handleSync(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!env.DB) return json({ error: 'Database belum ditautkan. Tambahkan binding D1 bernama DB pada proyek.' }, 503);
  const hasBearer = (request.headers.get('authorization') || '').startsWith('Bearer ');
  const teacher = await verifyTeacherToken(env, request);
  if (hasBearer && !teacher) return json({ error: 'Sesi guru tidak valid atau sudah kedaluwarsa. Silakan login kembali.', code: 'TEACHER_EXPIRED' }, 401);
  try {
    if (request.method === 'GET') return await handleGet(request, env, teacher);
    if (request.method === 'POST') return await handlePost(request, env, teacher);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('[sync] Database error', error);
    return json({ error: 'Database belum tersedia atau skema belum diterapkan (jalankan migrasi D1).' }, 503);
  }
}
