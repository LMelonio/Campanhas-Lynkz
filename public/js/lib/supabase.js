// Cliente do Supabase. Único arquivo trocado para rodar sem banco:
// copie dev/supabase-simulado.js por cima deste (ver dev/LEIA-ME no topo dele).
// url-auth.js vem primeiro: lê os tokens da URL antes de o cliente consumi-los.
import './url-auth.js';
// supabase-js fica no próprio site (public/vendor/, carregado no index.html antes
// dos módulos): nenhum código de CDN de terceiros roda no app.
const { createClient } = window.supabase;

const C = window.CONFIG;
export const sb = createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
