// Comissões → Parâmetros: código do Farelo, dia de corte, % padrão, Contrato de Resultado e nomes que não comissionam.
import { html, $, ao } from '../../lib/dom.js';
import { dataBR, lerValor } from '../../lib/regras.js';
import { nomeQlik } from '../../lib/comissoes.js';
import { comissoes } from '../../dados/comissoes.js';
import { detalhar } from '../../dados/erros.js';
import { campo, areaTexto, aplicarErros } from '../../ui/campos.js';
import { s, pctTxt, valorPct, sufixo, redesenhar } from './comum.js';

export function desenhar() {
  const p = comissoes.parametros();
  const pc = (k, rotulo) => campo({ id: `cp-${k}`, rotulo, valor: valorPct(p[k]), obrigatorio: true, mascara: 'decimal', depois: sufixo });
  return html`<form class="cm-parametros" id="cm-form-param" novalidate>
    <section class="painel" aria-labelledby="cp-t1"><h2 class="painel-titulo" id="cp-t1">Apuração</h2><div class="painel-corpo">
      <div class="cm-duas">
        ${campo({ id: 'cp-cod_farelo', rotulo: 'Código do fornecedor do Farelo', valor: p.cod_farelo, obrigatorio: true, atributos: { inputmode: 'numeric', maxlength: 10 } })}
        ${campo({ id: 'cp-dia_corte', rotulo: 'Dia de corte', valor: p.dia_corte, obrigatorio: true, dica: `Hoje: do dia ${Number(p.dia_corte) + 1} do mês anterior ao dia ${p.dia_corte}.`, atributos: { inputmode: 'numeric', maxlength: 2 } })}
      </div>
      ${areaTexto({ id: 'cp-nomes_ignorados', rotulo: 'Nomes do Qlik que não comissionam', valor: p.nomes_ignorados.join('\n'), opcional: true, dica: 'Um por linha. Por exemplo: TERRAZOO, venda da própria empresa.', atributos: { rows: 3 } })}
    </div></section>
    <section class="painel" aria-labelledby="cp-t2"><h2 class="painel-titulo" id="cp-t2">% de quem completar o cadastro</h2><div class="painel-corpo">
      <p class="campo-dica">Preenchem o cadastro de quem chega do Qlik. Quem já está cadastrado continua com os % do próprio cadastro.</p>
      <div class="cm-tres">${pc('pct_clt_principal', 'CLT')}${pc('pct_televendas_principal', 'Televendas')}${pc('pct_pj_principal', 'PJ')}</div>
      <div class="cm-tres">${pc('pct_clt_farelo', 'CLT no Farelo')}${pc('pct_televendas_farelo', 'Televendas no Farelo')}${pc('pct_pj_farelo', 'PJ no Farelo')}</div>
    </div></section>
    <section class="painel" aria-labelledby="cp-t3"><h2 class="painel-titulo" id="cp-t3">Contrato de Resultado (PJ)</h2><div class="painel-corpo">
      <div class="cm-duas">${pc('contrato_gatilho_faturamento', 'Faturamento mínimo da meta')}${pc('contrato_gatilho_positivacao', 'Positivação mínima da meta')}</div>
      <div class="cm-tres">${pc('contrato_pct_faixa1', 'Prêmio')}${pc('contrato_limite_faixa', 'Faturamento para o prêmio maior')}${pc('contrato_pct_faixa2', 'Prêmio maior')}</div>
      <p class="campo-dica">Hoje: com ${pctTxt(p.contrato_gatilho_faturamento)} do faturamento e ${pctTxt(p.contrato_gatilho_positivacao)} da positivação, paga ${pctTxt(p.contrato_pct_faixa1)} do faturamento realizado; acima de ${pctTxt(p.contrato_limite_faixa)}, paga ${pctTxt(p.contrato_pct_faixa2)}.</p>
    </div></section>
    <div class="acoes acoes-fim">
      ${p.atualizado_em ? html`<span class="cm-discreto cm-alterado">Alterados em ${dataBR(p.atualizado_em)}</span>` : ''}
      <button type="submit" class="btn btn-primario">Salvar parâmetros</button>
    </div>
  </form>`;
}

const LIMITES_PARAM = { contrato_gatilho_faturamento: [1, 500], contrato_gatilho_positivacao: [1, 500], contrato_limite_faixa: [1, 500] };
async function salvarParametros(form) {
  const v = k => $(`#cp-${k}`, form).value;
  const dados = { cod_farelo: v('cod_farelo').trim(), dia_corte: Number(v('dia_corte')), nomes_ignorados: v('nomes_ignorados').split('\n').map(nomeQlik).filter(Boolean) };
  const erros = {};
  if (!/^\d{1,10}$/.test(dados.cod_farelo)) erros['cp-cod_farelo'] = 'Só números, até 10.';
  if (!(Number.isInteger(dados.dia_corte) && dados.dia_corte >= 1 && dados.dia_corte <= 28)) erros['cp-dia_corte'] = 'De 1 a 28.';
  for (const k of Object.keys(comissoes.parametros()).filter(k => k.startsWith('pct_') || k.startsWith('contrato_'))) {
    const n = lerValor(v(k));
    const [min, max] = LIMITES_PARAM[k] || [0, 20];
    if (v(k).trim() === '' || !Number.isFinite(n) || n < min || n > max) erros[`cp-${k}`] = `De ${min} a ${max}.`;
    dados[k] = n;
  }
  if (Object.keys(erros).length) { aplicarErros(form, erros); return; }
  const botao = $('button[type="submit"]', form);
  botao.disabled = true; botao.setAttribute('aria-busy', 'true');
  try {
    await comissoes.salvarParametros(dados);
    s.resultado = null;   // outro corte ou outro Farelo: a apuração precisa de nova consulta
    s.ctx.toast('Parâmetros salvos.', { tom: 'sucesso' });
    redesenhar();
  } catch (e) {
    s.ctx.toast(detalhar(e).mensagem, { tom: 'erro' });
    botao.disabled = false; botao.removeAttribute('aria-busy');
  }
}

export function ligar(el) {
  return [ao(el, 'submit', '#cm-form-param', (e, f) => { e.preventDefault(); salvarParametros(f); })];
}
