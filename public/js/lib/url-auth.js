// Parâmetros de autenticação que o Supabase coloca na URL ao voltar de um
// link de e-mail. Este módulo é importado ANTES de o cliente Supabase ser
// criado (ver supabase.js), porque o cliente consome o trecho depois do #.
//   #access_token=…&type=recovery    → link de recuperação válido
//   #error=…&error_code=otp_expired  → link expirado, já usado ou inválido
//   ?token_hash=…&type=recovery      → modelo de e-mail à prova de antivírus
//                                      (ver COMECE-AQUI.md)
const hash = location.hash.startsWith('#/') ? '' : location.hash.replace(/^#/, '');
const h = new URLSearchParams(hash);
const q = new URLSearchParams(location.search);
const pega = k => h.get(k) || q.get(k);

export const urlAuth = Object.freeze({
  erro: pega('error_code') || pega('error'),
  tipo: pega('type'),
  tokenHash: q.get('token_hash'),
});

// Parâmetros que saem da barra de endereço depois de lidos.
const PARAMS_AUTH = ['access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type',
  'token_hash', 'code', 'error', 'error_code', 'error_description', 'provider_token'];

// Tira da URL só tokens e códigos de erro. Rotas "#/…" e outros parâmetros ficam.
export function limparUrl() {
  const url = new URL(location.href);
  let mudou = false;
  for (const k of PARAMS_AUTH) if (url.searchParams.has(k)) { url.searchParams.delete(k); mudou = true; }
  if (url.hash && !url.hash.startsWith('#/')) {
    const hp = new URLSearchParams(url.hash.slice(1));
    if (PARAMS_AUTH.some(k => hp.has(k))) { url.hash = ''; mudou = true; }
  }
  if (mudou) history.replaceState(null, '', url.pathname + url.search + url.hash);
}
