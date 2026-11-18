// ============================================================
//  SAÚDE DO BANCO — confere na abertura se o banco tem o que esta versão
//  do app precisa. Se faltar, o app mostra "Sistema em atualização" em vez
//  de quebrar com erro técnico.
//
//  Atenção: select com { head: true } NÃO devolve erro para tabela
//  inexistente; por isso a checagem usa select('id').limit(1) e olha o
//  código PGRST205 (tabela fora do cache do PostgREST) ou 42P01.
// ============================================================
import { sb } from '../lib/supabase.js';

// A 04 inclui as funções da parte B (02): aplicá-la resolve as três.
const NECESSARIAS = [
  { tabela: 'campanhas_app', migracao: '04-gestao-empresas-balconistas.sql' },
  { tabela: 'empresas',      migracao: '04-gestao-empresas-balconistas.sql' },
  { tabela: 'balconistas',   migracao: '04-gestao-empresas-balconistas.sql' },
];

// → { ok, falta: [{ tabela, migracao }], erro }
// erro (rede, sessão) não é "banco desatualizado": quem trata é o fluxo normal.
export async function conferirBanco() {
  const falta = [];
  for (const n of NECESSARIAS) {
    const { error } = await sb.from(n.tabela).select('id').limit(1);
    if (error?.code === 'PGRST205' || error?.code === '42P01') falta.push(n);
    else if (error) return { ok: false, falta: [], erro: error };
  }
  return { ok: falta.length === 0, falta, erro: null };
}
