// Contas do app (perfis), só para administrador. Mudanças passam por definir_perfil (regra no banco);
// convite pelo Worker. Guarda quantas contas estão sem acesso para o menu e o Início.
import { sb } from '../lib/supabase.js';
import { exigir, ErroApp } from './erros.js';

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

  // Convite por e-mail (Worker /api/usuarios/convidar): a conta já nasce com nome, papel e acesso.
  async convidar({ nome, email, papel }) {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new ErroApp('Entre de novo no app para convidar.');
    let resp;
    try {
      resp = await fetch('/api/usuarios/convidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nome, email, papel }),
      });
    } catch { throw new ErroApp('Sem conexão. Confira a internet e tente de novo.'); }
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new ErroApp(corpo.erro || 'Não foi possível enviar o convite agora.');
    await this.contarSemAcesso();
    return corpo;
  },

  // Contas esperando liberação (perfis desativados). Falha de rede não atrapalha: fica o último número.
  semAcesso: () => semAcesso,
  async contarSemAcesso() {
    try { await this.listar(); } catch (e) { console.warn('Contagem de contas sem acesso falhou', e); }
    return semAcesso;
  },
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
};
