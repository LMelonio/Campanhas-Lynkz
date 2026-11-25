// Cliente do Supabase (supabase-js vem de public/vendor/, carregado no index.html). O servidor de desenvolvimento
// troca este arquivo pelo simulado. url-auth.js vem antes: lê os tokens da URL antes de o cliente consumi-los.
import './url-auth.js';
const { createClient } = window.supabase;

const C = window.CONFIG;
export const sb = createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
