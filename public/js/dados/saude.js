// Confere na abertura se o banco tem as tabelas desta versão; se faltar, o app mostra "Sistema em atualização".
// select com { head: true } não acusa tabela inexistente, por isso a checagem usa select('id').limit(1).
import { sb } from '../lib/supabase.js';

// A 04 inclui as funções da parte B (02): aplicá-la resolve as três.
const NECESSARIAS = [
  { tabela: 'campanhas_app', migracao: '04-gestao-empresas-balconistas.sql' },
  { tabela: 'empresas',      migracao: '04-gestao-empresas-balconistas.sql' },
  { tabela: 'balconistas',   migracao: '04-gestao-empresas-balconistas.sql' },
  { tabela: 'comissionados', migracao: '16-comissoes.sql' },
];

// → { ok, falta: [{ tabela, migracao }], erro }
// erro (rede, sessão) não é "banco desatualizado": quem trata é o fluxo normal.
export async function conferirBanco() {
  // As três ao mesmo tempo (uma ida ao banco em vez de três seguidas).
  const respostas = await Promise.all(NECESSARIAS.map(n => sb.from(n.tabela).select('id').limit(1)));
  const falta = [];
  for (const [i, { error }] of respostas.entries()) {
    if (error?.code === 'PGRST205' || error?.code === '42P01') falta.push(NECESSARIAS[i]);
    else if (error) return { ok: false, falta: [], erro: error };
  }
  return { ok: falta.length === 0, falta, erro: null };
}
