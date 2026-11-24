// ============================================================
//  USUÁRIOS — contas do app (tabela perfis), só para o administrador.
//  Administrador = papel "aprovador" no banco: aprova e recusa campanhas e
//  libera acessos. Usuário = papel "coordenador": envia campanhas e cadastra
//  balconistas. A troca só passa pela função definir_perfil (migração 12),
//  que confere no banco quem pode o quê.
//
//  v2.9: guarda quantas contas estão sem acesso (contador do menu "Usuários"
//  e aviso no Início do administrador). Quem desenha assina com assinar().
// ============================================================
import { sb } from '../lib/supabase.js';
import { exigir } from './erros.js';

const ouvintes = new Set();
let semAcesso = null;   // null = ainda não contou

function guardarContagem(lista) {
  const n = lista.filter(u => !u.ativo).length;
  if (n !== semAcesso) { semAcesso = n; ouvintes.forEach(fn => { try { fn(n); } catch (e) { console.error(e); } }); }
}

export const usuarios = {
  async listar() {
    const linhas = exigir(await sb.from('perfis').select('*').order('nome'));
    const lista = (linhas || []).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
    guardarContagem(lista);
    return lista;
  },

  // definir(id, { papel?, ativo?, nome? }) → perfil gravado. Campo ausente não muda.
  async definir(id, { papel = null, ativo = null, nome = null } = {}) {
    const r = exigir(await sb.rpc('definir_perfil', { p_id: id, p_papel: papel, p_ativo: ativo, p_nome: nome }));
    if (ativo != null) this.contarSemAcesso();   // liberou ou tirou acesso: o contador muda
    return r;
  },

  // Contas esperando liberação (perfis desativados). Falha de rede não atrapalha: fica o último número.
  semAcesso: () => semAcesso,
  async contarSemAcesso() {
    try { await this.listar(); } catch (e) { console.warn('Contagem de contas sem acesso falhou', e); }
    return semAcesso;
  },
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
};
