// ============================================================
//  USUÁRIOS — contas do app (tabela perfis), só para o administrador.
//  Administrador = papel "aprovador" no banco: aprova e recusa campanhas e
//  libera acessos. Usuário = papel "coordenador": envia campanhas e cadastra
//  balconistas. A troca só passa pela função definir_perfil (migração 12),
//  que confere no banco quem pode o quê.
// ============================================================
import { sb } from '../lib/supabase.js';
import { exigir } from './erros.js';

export const usuarios = {
  async listar() {
    const linhas = exigir(await sb.from('perfis').select('*').order('nome'));
    return (linhas || []).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
  },

  // definir(id, { papel?, ativo?, nome? }) → perfil gravado. Campo ausente não muda.
  async definir(id, { papel = null, ativo = null, nome = null } = {}) {
    return exigir(await sb.rpc('definir_perfil', { p_id: id, p_papel: papel, p_ativo: ativo, p_nome: nome }));
  },
};
