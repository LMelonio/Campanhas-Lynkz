// Qlik simulado para o servidor de desenvolvimento e para os testes de navegador.
// O Worker de verdade (worker/index.js) responde ao mesmo pedido e no mesmo formato.
//   cliente com código terminado em 0 → nenhuma nota deste laboratório (comprou R$ 850 de outros)
//   cliente com código terminado em 00 → o Qlik não devolve nada do cliente (cliente_total 0)
//   código 9999                       → erro do Qlik
//   código terminado em 12            → 12 notas
//   código terminado em 7             → NF 209001 (R$ 300) devolvida: vem como provável devolução
//   código terminado em 8             → devolução de R$ 50 sem nota que feche
//   os demais                         → 3 notas, de duas marcas (WELLPET e PROTEÇÃO); com "marca" no pedido, só as dela
export const ROTA_QLIK = '/api/qlik/compras';

export function qlikSimulado(rq, rs) {
  let corpo = '';
  rq.on('data', d => { corpo += d; });
  rq.on('end', () => setTimeout(() => {
    const responder = (status, obj) => { rs.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); rs.end(JSON.stringify(obj)); };
    if (!/^Bearer\s+\S+/.test(rq.headers.authorization || '')) return responder(401, { erro: 'Entre no app para consultar o Qlik.' });
    let p; try { p = JSON.parse(corpo); } catch { return responder(400, { erro: 'Pedido inválido.' }); }
    if (String(p.codigo_cliente) === '9999') return responder(502, { erro: 'Não foi possível consultar o Qlik agora.' });
    const vazio = String(p.codigo_cliente).endsWith('0');
    // Marcas do laboratório: WELLPET tem a nota 210818; PROTEÇÃO tem as outras duas.
    const todas = [
      { numero: '209001', serie: '1', data: p.inicio, valor: 300, marca: 'PROTEÇÃO' },
      { numero: '210818', serie: '1', data: p.inicio, valor: 1200.5, marca: 'WELLPET' },
      { numero: '211500', serie: '2', data: p.fim, valor: 99.99, marca: 'PROTEÇÃO' },
    ];
    const doze = String(p.codigo_cliente).endsWith('12');
    if (doze) {
      const geradas = Array.from({ length: 12 }, (_, i) => ({
        numero: String(220001 + i), serie: '1', data: p.inicio, valor: 100 + i, marca: i % 2 ? 'WELLPET' : 'PROTEÇÃO' }));
      todas.length = 0;
      todas.push(...geradas);
    }
    const soma = l => Math.round(l.reduce((t, n) => t + n.valor, 0) * 100) / 100;
    const marcas = vazio ? [] : ['WELLPET', 'PROTEÇÃO'].map(nome => ({ nome, valor: soma(todas.filter(n => n.marca === nome)) })).sort((a, b) => b.valor - a.valor);
    // Uma marca (texto) ou várias.
    const marcasPedidas = p.marca == null ? [] : Array.isArray(p.marca) ? p.marca : [p.marca];
    let notas = (vazio ? [] : todas.filter(n => !marcasPedidas.length || marcasPedidas.includes(n.marca))).map(({ marca, ...n }) => n);
    // Devoluções: o total já desconta; devolucoes = soma das notas − total.
    const cod = String(p.codigo_cliente);
    const devolucoes = vazio || p.marca ? 0 : cod.endsWith('7') ? 300 : cod.endsWith('8') ? 50 : 0;
    if (cod.endsWith('7') && !vazio && !p.marca) notas = notas.map(n => (n.numero === '209001' ? { ...n, provavel_devolucao: true } : n));
    // Vários laboratórios: um fornecedor por padrão, como o Worker devolve.
    const padroes = Array.isArray(p.fornecedor_padrao) ? p.fornecedor_padrao : [p.fornecedor_padrao];
    const fornecedores = padroes.length > 1
      ? padroes.map(x => String(x).replace(/\*/g, '').trim().toUpperCase() + ' DISTRIBUIDORA').sort()
      : ['OURO FINO SAUDE ANIMAL'];
    responder(200, {
      total: Math.round((soma(notas) - devolucoes) * 100) / 100, notas, devolucoes, marcas,
      fornecedores: vazio ? [] : fornecedores, consultado_em: new Date().toISOString(),
      cliente_total: vazio ? (String(p.codigo_cliente).endsWith('00') ? 0 : 850) : null,
    });
  }, 150));
}

// ---------- comissões ----------
// Vendas fictícias por vendedor, com os nomes do cadastro simulado (dev/supabase-simulado.js).
// "SEM CADASTRO LTDA" e "TERRAZOO" aparecem para testar a lista de quem não está no cadastro.
// Apuração que termina em dezembro → erro do Qlik (testar a mensagem).
export const ROTA_QLIK_COMISSOES = '/api/qlik/comissoes';

export function qlikComissoesSimulado(rq, rs) {
  let corpo = '';
  rq.on('data', d => { corpo += d; });
  rq.on('end', () => setTimeout(() => {
    const responder = (status, obj) => { rs.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); rs.end(JSON.stringify(obj)); };
    if (!/^Bearer\s+\S+/.test(rq.headers.authorization || '')) return responder(401, { erro: 'Entre no app para consultar o Qlik.' });
    let p; try { p = JSON.parse(corpo); } catch { return responder(400, { erro: 'Pedido inválido.' }); }
    if (String(p.apuracao_fim).slice(5, 7) === '12') return responder(502, { erro: 'Não foi possível consultar o Qlik agora.' });
    const vendas = [
      { vendedor: 'ELIELSON SERPA MENDES', total: 211006.51, farelo: 26336.69 },
      { vendedor: 'NAYRA JULIANA LIMA VALE', total: 124511.13, farelo: 0 },
      { vendedor: 'RAYANE CUNHA DOS ANJOS', total: 71727.48, farelo: 799.8 },
      { vendedor: 'ALEX REPRESENTAÇÕES', total: 118401.89, farelo: 0 },
      { vendedor: 'SELDIANA ARAUJO BARROS', total: 125709.18, farelo: 16423.12 },
      { vendedor: 'MARIA AMANDA FARIAS DE SOUSA', total: 42287.36, farelo: 0 },
      { vendedor: 'SEM CADASTRO LTDA', total: 1530.4, farelo: 0 },
      { vendedor: 'TERRAZOO', total: 40210.77, farelo: 0 },
    ];
    // Contrato: clientes fictícios do mês anterior. Alex: 211.223,09 em 37 clientes (meta 199.360,26 / 40).
    const linhas = [];
    const espalhar = (vendedor, total, n) => {
      const parte = Math.round(total / n * 100) / 100;
      for (let i = 0; i < n; i++) linhas.push({ vendedor, cliente: String(5000 + linhas.length), valor: i === n - 1 ? Math.round((total - parte * (n - 1)) * 100) / 100 : parte });
    };
    espalhar('ALEX REPRESENTAÇÕES', 211223.09, 37);
    espalhar('SELDIANA ARAUJO BARROS', 170987.71, 76);
    espalhar('MARIA AMANDA FARIAS DE SOUSA', 44117.99, 22);
    linhas.push({ vendedor: 'ALEX REPRESENTAÇÕES', cliente: '9001', valor: -150 });   // só devolução: não positiva
    // { base: true }: as mesmas vendas linha a linha (aba "Base Qlik" do Excel). O Farelo sai do fornecedor 6610.
    if (p.base === true) {
      const r2 = n => Math.round(n * 100) / 100;
      const base = [];
      vendas.forEach((v, i) => {
        const resto = r2(v.total - v.farelo);
        const cod = String(100 + i);
        base.push({ data: p.apuracao_inicio, cod_fornecedor: '7064', fornecedor: 'OURO FINO', segmento: 'PET FARMACIA', marca: 'PROTEÇÃO', cod_vendedor: cod, vendedor: v.vendedor, produto: 'BANNI COMBO COM 3 PIPETAS', valor: r2(resto * 0.6) });
        base.push({ data: p.apuracao_fim, cod_fornecedor: '21610', fornecedor: 'DBM MINERAIS LTDA', segmento: 'PET HIGIENE E BELEZA', marca: 'CAT MIA', cod_vendedor: cod, vendedor: v.vendedor, produto: 'AREIA SANITARIA CAT MIA 4KG', valor: r2(resto - r2(resto * 0.6)) });
        if (v.farelo) base.push({ data: p.apuracao_fim, cod_fornecedor: '6610', fornecedor: 'FARELO DO NORTE', segmento: 'AGRO', marca: 'FARELO', cod_vendedor: cod, vendedor: v.vendedor, produto: 'FARELO DE SOJA 50KG', valor: v.farelo });
      });
      return responder(200, { base: { inicio: p.apuracao_inicio, fim: p.apuracao_fim, linhas: base }, consultado_em: new Date().toISOString() });
    }
    const total = Math.round(vendas.reduce((s, v) => s + v.total, 0) * 100) / 100 + 87.5;
    // Formato 2 (v3.6): uma linha por vendedor × fornecedor. O total de cada vendedor é o mesmo de antes.
    // Elielson vende também DBM (21610); Seldiana tem um fornecedor com devolução maior que a venda.
    const r2 = n => Math.round(n * 100) / 100;
    const extras = { 'ELIELSON SERPA MENDES': [['21610', 'DBM MINERAIS LTDA', 5000]], 'SELDIANA ARAUJO BARROS': [['30001', 'PET SHOP DEVOLVIDO', -50]] };
    const porFornecedor = vendas.flatMap(v => {
      const outros = extras[v.vendedor] || [];
      const resto = r2(v.total - v.farelo - outros.reduce((s, x) => s + x[2], 0));
      return [
        { vendedor: v.vendedor, cod_fornecedor: '7064', fornecedor: 'OURO FINO', total: resto },
        ...(v.farelo ? [{ vendedor: v.vendedor, cod_fornecedor: '6610', fornecedor: 'FARELO DO NORTE', total: v.farelo }] : []),
        ...outros.map(([cod, nome, t]) => ({ vendedor: v.vendedor, cod_fornecedor: cod, fornecedor: nome, total: t })),
      ];
    });
    responder(200, {
      formato: 2,
      apuracao: { inicio: p.apuracao_inicio, fim: p.apuracao_fim, vendas: porFornecedor, total, sem_vendedor: 87.5 },
      contrato: { inicio: p.contrato_inicio, fim: p.contrato_fim, linhas },
      consultado_em: new Date().toISOString(),
    });
  }, 300));
}
