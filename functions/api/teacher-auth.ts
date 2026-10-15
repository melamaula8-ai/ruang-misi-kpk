import { handleTeacherAuth, type Env } from '../../server/core';

// Cloudflare Pages Functions: /api/teacher-auth
export const onRequest: PagesFunction<Env> = ({ request, env }) => handleTeacherAuth(request, env);
