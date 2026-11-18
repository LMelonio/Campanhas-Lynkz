// ============================================================
//  CAMPANHAS — leitura, tempo real, criação e decisão.
//  Lê sempre da view campanhas_app (os dados Swile só chegam a quem pode
//  vê-los). Grava na tabela campanhas.
// ============================================================
import { sb } from '../lib/supabase.js';
import { STATUS } from '../lib/regras.js';
import { exigir, ErroApp } from './erros.js';

const FONTE = 'campanhas_app';
let lista = [];
let carregado = false;
let canal = null;
const ouvintes = new Set();

function avisar(evento) {
  for (const fn of ouvintes) {
    try { fn(evento); } catch (e) { console.error(e); }
  }
}

const mesmaId = (a, b) => String(a) === String(b);
const porCriacaoDesc = (a, b) => String(b.criado_em).localeCompare(String(a.criado_em));

// Relê UMA linha pela view e aplica em memória (sem recarregar tudo).
async function relerLinha(id) {
  const linha = exigir(await sb.from(FONTE).select('*').eq('id', id).maybeSingle());
  const i = lista.findIndex(c => mesmaId(c.id, id));
  const nova = i < 0;
  if (!linha) {
    if (!nova) lista.splice(i, 1);
  } else if (nova) {
    lista.push(linha);
    lista.sort(porCriacaoDesc);
  } else {
    lista[i] = linha;
  }
  return { linha, nova };
}

export const campanhas = {
  get carregado() { return carregado; },

  async carregar() {
    lista = exigir(await sb.from(FONTE).select('*').order('criado_em', { ascending: false })) || [];
    carregado = true;
    avisar({ tipo: 'carga' });
  },

  todas() { return lista; },

  porId(id) { return lista.find(c => mesmaId(c.id, id)) || null; },

  // Da mais antiga para a mais nova: quem espera há mais tempo vem primeiro.
  pendentes() {
    return lista.filter(c => c.status === STATUS.PENDENTE)
      .sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  },

  // fn({ tipo: 'carga' | 'linha', id?, campanha?, origem?: 'remota' | 'local', nova? })
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },

  aoVivo() {
    if (canal) return;
    canal = sb.channel('campanhas-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campanhas' }, async p => {
        const id = p.new?.id ?? p.old?.id;
        if (id == null) return;
        try {
          const { linha, nova } = await relerLinha(id);
          avisar({ tipo: 'linha', id, campanha: linha, nova, origem: 'remota', evento: p.eventType });
        } catch (e) { console.warn('Tempo real: não consegui reler a campanha', id, e); }
      })
      .subscribe();
  },

  // campos: colunas da tabela campanhas. Devolve a campanha como a view a entrega.
  async criar(campos) {
    const { id } = exigir(await sb.from('campanhas').insert(campos).select('id').single());
    const { linha } = await relerLinha(id);
    avisar({ tipo: 'linha', id, campanha: linha, nova: true, origem: 'local' });
    return linha;
  },

  // Só decide se ainda estiver Pendente. Se outra pessoa decidiu antes,
  // nenhuma linha muda e o erro diz quem foi.
  async decidir(id, status, motivo = null) {
    const mudou = exigir(await sb.from('campanhas')
      .update({ status, motivo: motivo || null })
      .eq('id', id).eq('status', STATUS.PENDENTE)
      .select('id'));
    const { linha } = await relerLinha(id);
    avisar({ tipo: 'linha', id, campanha: linha, nova: false, origem: 'local' });
    if (!mudou || !mudou.length) {
      if (linha && linha.status !== STATUS.PENDENTE) {
        throw new ErroApp(`Esta campanha já foi ${linha.status.toLowerCase()} por ${linha.aprovador_nome || 'outra pessoa'}.`);
      }
      throw new ErroApp('Não foi possível registrar a decisão. Só o aprovador decide campanhas.');
    }
    return linha;
  },

  parar() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    ouvintes.clear();
    lista = [];
    carregado = false;
  },
};
