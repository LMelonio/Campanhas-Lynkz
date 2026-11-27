// Campanhas: leitura pela view campanhas_app (dados Swile só para quem pode ver), tempo real, envio e decisão.
import { sb } from '../lib/supabase.js';
import { STATUS } from '../lib/regras.js';
import { exigir, ErroApp } from './erros.js';

const FONTE = 'campanhas_app';
let lista = [];
let carregado = false;
let ultimoErro = null;   // mensagem da última carga que falhou (null = ok)
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

  get erro() { return ultimoErro; },

  async carregar() {
    try {
      // O Supabase devolve no máximo 1.000 linhas por consulta: lê em blocos.
      const BLOCO = 1000;
      const todas = [];
      for (let de = 0; ; de += BLOCO) {
        const parte = exigir(await sb.from(FONTE).select('*')
          .order('criado_em', { ascending: false }).order('id', { ascending: false })
          .range(de, de + BLOCO - 1)) || [];
        todas.push(...parte);
        if (parte.length < BLOCO) break;
      }
      lista = todas;
    } catch (e) {
      ultimoErro = e.message;
      avisar({ tipo: 'erro' });
      throw e;
    }
    ultimoErro = null;
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
        if (p.eventType === 'DELETE') {
          const i = lista.findIndex(c => mesmaId(c.id, id));
          if (i < 0) return;
          lista.splice(i, 1);
          avisar({ tipo: 'linha', id, campanha: null, nova: false, origem: 'remota', evento: 'DELETE' });
          return;
        }
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

  // Envio da Nova campanha: balconista (se veio), campanha e notas fiscais
  // gravados juntos pela função enviar_campanha (tudo ou nada). Devolve a
  // campanha como a view a entrega, e o id do balconista, se houve um.
  //   campanha:  colunas da tabela campanhas (o banco impõe status e solicitante)
  //   balconista: { empresa_id, nome_completo, … } novo, ou { id, … } para atualizar
  //   notas:     [{ numero, serie, data, valor }]
  async enviar({ campanha, balconista = null, notas = [] }) {
    const r = exigir(await sb.rpc('enviar_campanha', {
      p_campanha: campanha,
      p_balconista: balconista,
      p_notas: notas.map(n => ({ numero: n.numero, serie: n.serie || '', data: n.data || null, valor: n.valor })),
    }));
    const { linha } = await relerLinha(r.id);
    avisar({ tipo: 'linha', id: r.id, campanha: linha, nova: true, origem: 'local' });
    return { campanha: linha, balconistaId: r.balconista_id ?? null };
  },

  // Notas fiscais marcadas na Nova campanha: [{numero, serie, data, valor}].
  async salvarNotas(campanhaId, notas) {
    if (!notas.length) return;
    exigir(await sb.from('campanha_notas').insert(notas.map(n => ({
      campanha_id: campanhaId, numero: n.numero, serie: n.serie || '', data_emissao: n.data || null, valor: n.valor,
    }))));
  },

  async notasDa(campanhaId) {
    return exigir(await sb.from('campanha_notas').select('*').eq('campanha_id', campanhaId)
      .order('data_emissao').order('numero')) || [];
  },

  // Relê campanhas que mudaram por fora (ex.: excluir_balconista solta o balconista delas).
  async reler(ids) {
    for (const id of ids) {
      const { linha, nova } = await relerLinha(id);
      avisar({ tipo: 'linha', id, campanha: linha, nova, origem: 'local' });
    }
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
      throw new ErroApp('Não foi possível registrar a decisão. Só administradores decidem campanhas.');
    }
    return linha;
  },

  // Só administrador (a regra está no banco, em excluir_campanha). O banco guarda uma cópia
  // com o motivo e quem excluiu; aqui a campanha sai da lista na hora.
  async excluir(id, motivo) {
    exigir(await sb.rpc('excluir_campanha', { p_id: Number(id), p_motivo: motivo }));
    const i = lista.findIndex(c => mesmaId(c.id, id));
    if (i >= 0) lista.splice(i, 1);
    avisar({ tipo: 'linha', id, campanha: null, nova: false, origem: 'local', evento: 'DELETE' });
  },

  parar() {
    if (canal) { sb.removeChannel(canal); canal = null; }
    ouvintes.clear();
    lista = [];
    carregado = false;
    ultimoErro = null;
  },
};
