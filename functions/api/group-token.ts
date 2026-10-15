import type { Env } from '../../server/core';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

function createCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const part = Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
  return `KPK-${part.slice(0, 3)}-${part.slice(3)}`;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Metode tidak diizinkan.' }, 405);
  }

  if (!env.DB) {
    return json({ error: 'Database belum tersedia.' }, 503);
  }

  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = createCode();
      const id = crypto.randomUUID();
      const now = Date.now();

      const token = {
        id,
        code,
        status: 'available',
        createdAt: new Date(now).toISOString(),
      };

      try {
        await env.DB.prepare(
          `INSERT INTO group_tokens (id, code, status, claimed_by, data, updated_at)
           VALUES (?, ?, 'available', NULL, ?, ?)`
        )
          .bind(id, code, JSON.stringify(token), now)
          .run();

        return json({ success: true, token }, 201);
      } catch (error) {
        if (/UNIQUE/i.test(String(error))) {
          continue;
        }
        throw error;
      }
    }

    return json(
      { error: 'Belum berhasil membuat ID unik. Silakan coba kembali.' },
      503
    );
  } catch (error) {
    console.error('[group-token] Gagal membuat ID kelompok:', error);
    return json({ error: 'ID kelompok gagal disimpan ke database.' }, 500);
  }
};