// Confere na abertura se o banco tem as tabelas desta versão; se faltar, o app mostra "Sistema em atualização".
// select com { head: true } não acusa tabela inexistente, por isso a checagem usa select('id').limit(1).
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
