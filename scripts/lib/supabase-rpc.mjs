// Chama uma função do banco (RPC do PostgREST) com a chave service_role.
// Só roda no computador ou no GitHub Actions — nunca no navegador.
export async function chamarFuncao(env, funcao, argumentos) {
  const url = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + funcao;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(argumentos),
  });
  const texto = await resp.text();
  if (!resp.ok) {
    let msg = texto;
    try { msg = JSON.parse(texto).message || texto; } catch {}
    if (/Could not find the function/i.test(msg)) msg += '\n→ Rode sql/migracoes/07-clientes-qlik-e-historico.sql no SQL Editor do Supabase.';
    throw new Error(`Supabase respondeu ${resp.status}: ${msg}`);
  }
  return texto ? JSON.parse(texto) : null;
}
