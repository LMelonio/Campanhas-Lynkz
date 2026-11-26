// ============================================================
//  TESTES DE PONTA A PONTA — o app inteiro num navegador de verdade,
//  com o Supabase simulado (dev/supabase-simulado.js). Não toca no banco real.
//
//  Instalar uma vez:   cd tests/e2e && npm install && npx playwright install chromium
//  Rodar:              node tests/e2e/rodar.mjs            (da raiz do projeto)
//                      node tests/e2e/rodar.mjs nova       (só testes com "nova" no nome)
//  Saída:              tests/e2e/saida/ (capturas de tela e relatório.json)
// ============================================================
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { qlikSimulado, ROTA_QLIK, qlikComissoesSimulado, ROTA_QLIK_COMISSOES } from '../../dev/qlik-simulado.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PROJETO = path.resolve(AQUI, '../..');
const RAIZ = path.join(PROJETO, 'public');          // o que vai para o ar
const SIMULADO = path.join(PROJETO, 'dev/supabase-simulado.js');
const SAIDA = path.join(AQUI, 'saida');
fs.rmSync(SAIDA, { recursive: true, force: true });
fs.mkdirSync(SAIDA, { recursive: true });

// Dependências de teste: tests/e2e/node_modules, ou outro lugar via NODE_PATH.
const req = createRequire(path.join(AQUI, 'package.json'));
const achar = nome => { try { return req.resolve(nome); } catch { return createRequire(process.env.DEPS_TESTE || AQUI + '/').resolve(nome); } };
// import() precisa de URL file:// (no Windows um caminho c:\... é recusado).
const importar = nome => import(pathToFileURL(achar(nome)).href);
const pw = await importar('playwright');
const chromium = pw.chromium ?? pw.default.chromium;
const AXE = fs.readFileSync(achar('axe-core/axe.min.js'), 'utf8');
let XLSX_MJS = null, XLSX_LER = null;
try { XLSX_MJS = fs.readFileSync(path.join(path.dirname(achar('xlsx')), 'xlsx.mjs')   /* o pacote não exporta package.json */, 'utf8'); XLSX_LER = (await importar('xlsx')).default; } catch { /* sem xlsx: teste do Excel é pulado */ }

// ---------- servidor estático (troca supabase.js pelo simulado) ----------
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === ROTA_QLIK && rq.method === 'POST') return qlikSimulado(rq, rs);
  if (p === ROTA_QLIK_COMISSOES && rq.method === 'POST') return qlikComissoesSimulado(rq, rs);
  const f = p === '/js/lib/supabase.js' ? SIMULADO : path.join(RAIZ, p);
  if (!(f.startsWith(RAIZ) || f === SIMULADO) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); rs.end('404'); return; }
  rs.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(rs);
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

// ---------- mini-harness ----------
const testes = [];
const teste = (nome, fn, opcoes = {}) => testes.push({ nome, fn, opcoes });
class Falha extends Error {}
const afirma = (cond, msg) => { if (!cond) throw new Falha(msg); };
const igual = (a, b, msg) => afirma(a === b, `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
const relatorio = { inicio: new Date().toISOString(), testes: [], acessibilidade: [], overflow: [] };

const navegador = await chromium.launch();
async function novaPagina({ largura = 1440, altura = 900, sw = 'block', escuro = false, toque = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura }, locale: 'pt-BR', timezoneId: 'America/Fortaleza',
    isMobile: toque, hasTouch: toque,
    serviceWorkers: sw, acceptDownloads: true, colorScheme: escuro ? 'dark' : 'light',
  });
  // Sem internet nos testes: fonte vazia, SheetJS servido local.
  await contexto.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await contexto.route(/cdn\.sheetjs\.com/, r => XLSX_MJS ? r.fulfill({ status: 200, contentType: 'text/javascript', body: XLSX_MJS, headers: { 'Access-Control-Allow-Origin': '*' } }) : r.abort());
  await contexto.addInitScript(() => { if (location.search.includes('zerar=1')) sessionStorage.removeItem('simulado-saiu'); });
  const page = await contexto.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  return { contexto, page, erros };
}

// Abre o app logado. papel: 'aprovador' | 'coordenador'.
async function abrir(page, { papel = 'aprovador', rota = '#/inicio', extra = '' } = {}) {
  await page.goto(`${BASE}/?papel=${papel}&zerar=1${extra}${rota}`);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#titulo')?.textContent.trim().length > 0 && !document.querySelector('.esqueleto'));
}
const db = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('simulado-db-v3')));
const toastCom = (page, texto) => page.locator('.toast', { hasText: texto }).first().waitFor({ timeout: 8000 });
const titulo = page => page.locator('#titulo').innerText();
async function escolherNoCombo(page, seletor, termo, opcao) {
  await page.fill(seletor, '');
  await page.type(seletor, termo, { delay: 15 });
  await page.locator(`${seletor} ~ .combo-lista [role=option]`, { hasText: opcao }).first().click();
}
// Laboratórios escolhidos na Nova: botões com × abaixo do campo.
const labsEscolhidos = page => page.locator('#n-labs [data-tirar-lab]').evaluateAll(bs => bs.map(b => b.dataset.tirarLab));
const erroDo = (page, id) => page.locator(`#${id}-erro`);
async function semErroVisivel(page) { return page.locator('.campo.tem-erro').count(); }

async function axe(page, nome) {
  // Espera animações (abertura de diálogo, toasts) terminarem: no meio do
  // fade o contraste medido sai falso.
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {});
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations
    .map(v => ({ id: v.id, impacto: v.impact, ajuda: v.help, alvos: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })));
  relatorio.acessibilidade.push({ tela: nome, violacoes: r });
  return r;
}
async function semOverflow(page, nome) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  if (r.sw > r.w + 1) relatorio.overflow.push({ tela: nome, ...r });
  return r.sw <= r.w + 1;
}

// ============================================================
//  1. ACESSO
// ============================================================
async function deslogado(page, url = '/') {
  await page.goto(`${BASE}/?zerar=1`);
  await page.evaluate(() => sessionStorage.setItem('simulado-saiu', '1'));
  await page.goto(BASE + url);
  await page.waitForSelector('#acesso:not([hidden]) h1');
}

teste('acesso: login valida campos, recusa usuário errado e entra', async ({ page }) => {
  await deslogado(page);
  igual(await page.locator('#acesso h1').innerText(), 'Bem-vindo de volta', 'título do login');
  await page.click('#l-entrar');
  afirma((await page.locator('#l-email-erro').innerText()).includes('e-mail válido'), 'pede e-mail válido (no campo)');
  await page.fill('#l-email', 'carlos@lynkz.com.br');
  await page.click('#l-entrar');
  afirma((await page.locator('#l-senha-erro').innerText()).includes('senha'), 'pede senha (no campo)');
  await page.fill('#l-email', 'ninguem@lynkz.com.br'); await page.fill('#l-senha', 'x'); await page.press('#l-senha', 'Enter');
  await page.locator('#l-senha-erro', { hasText: 'inválidos' }).waitFor();
  await page.fill('#l-email', 'carlos@lynkz.com.br'); await page.fill('#l-senha', 'qualquer'); await page.click('#l-entrar');
  await page.waitForSelector('#app:not([hidden])');
  afirma((await page.locator('#menu').innerText()).includes('Carlos'), 'menu mostra o usuário logado');
});

teste('acesso: esqueci minha senha envia link e bloqueia reenvio por 60 s', async ({ page }) => {
  await deslogado(page);
  await page.fill('#l-email', 'carlos@lynkz.com.br');
  await page.click('#l-esqueci');
  igual(await page.inputValue('#r-email'), 'carlos@lynkz.com.br', 'e-mail vem preenchido');
  await page.click('#r-enviar');
  await page.locator('#r-msg', { hasText: 'Se este e-mail tiver acesso' }).waitFor();
  afirma(await page.locator('#r-enviar').isDisabled(), 'botão bloqueado depois do envio');
  afirma(/Enviar de novo \(\d+s\)/.test(await page.locator('#r-enviar').innerText()), 'contagem regressiva');
  await page.click('#r-voltar');
  await page.locator('#acesso h1', { hasText: 'Bem-vindo' }).waitFor();
});

teste('acesso: link expirado mostra aviso e limpa a URL', async ({ page }) => {
  await deslogado(page, '/#error=access_denied&error_code=otp_expired&error_description=x');
  await page.locator('#acesso h1', { hasText: 'Link expirado' }).waitFor();
  afirma(!page.url().includes('otp_expired'), 'URL sem o código de erro');
});

teste('acesso: link com token_hash pede confirmação antes de gastar o código', async ({ page }) => {
  await deslogado(page, '/?token_hash=abc123&type=recovery');
  await page.locator('#acesso h1', { hasText: 'Redefinir senha' }).waitFor();
  afirma(page.url().includes('token_hash'), 'token só sai da URL depois de usado');
  await page.click('#c-ok');
  await page.locator('#acesso h1', { hasText: 'Link expirado' }).waitFor();   // simulador recusa o código
  afirma(!page.url().includes('token_hash'), 'token removido da URL depois de usado');
});

teste('acesso: link de recuperação abre "Crie sua nova senha" e valida', async ({ page }) => {
  await page.goto(`${BASE}/?zerar=1#access_token=t&refresh_token=r&type=recovery`);
  await page.locator('#acesso h1', { hasText: 'Crie sua nova senha' }).waitFor();
  afirma(!page.url().includes('access_token'), 'token fora da URL');
  await page.fill('#n-senha', '123456789'); await page.click('#n-ok');
  await page.locator('#n-msg', { hasText: '10 caracteres' }).waitFor();
  // A conta simulada é ana@lynkz.com.br: senha com o nome é recusada (requisito ao vivo e ao salvar).
  await page.fill('#n-senha', 'Ana@202612'); await page.click('#n-ok');
  await page.locator('#n-msg', { hasText: 'nome nem seu e-mail' }).waitFor();
  afirma(!(await page.locator('#n-senha-forca [data-req="pessoal"]').getAttribute('class') || '').includes('ok'), 'requisito "sem seu nome" desmarcado');
  await page.fill('#n-senha', '1234567890'); await page.fill('#n-senha2', '1234567891'); await page.click('#n-ok');
  await page.locator('#n-msg', { hasText: 'não são iguais' }).waitFor();
  await page.fill('#n-senha2', '1234567890'); await page.click('#n-ok');
  await page.locator('#l-msg', { hasText: 'Senha alterada' }).waitFor();
  igual(await page.evaluate(() => localStorage.getItem('lynkz_recuperacao_pendente')), null, 'marca de recuperação removida');
});

// ============================================================
//  2. NAVEGAÇÃO E CASCA
// ============================================================
teste('navegação: todas as rotas, menu ativo, rota inválida e Voltar', async ({ page }) => {
  await abrir(page);
  const rotas = [['#/inicio', 'Início'], ['#/campanhas', 'Campanhas'], ['#/historico', 'Histórico'], ['#/gestao', 'Gestão'], ['#/perfil', 'Perfil'], ['#/nova', 'Nova campanha']];
  for (const [r, t] of rotas) {
    await page.click(`#menu a[href="${r}"]`);
    await page.waitForFunction(x => location.hash === x, r);
    igual(await titulo(page), t, `título em ${r}`);
    if (r !== '#/nova') igual(await page.locator(`#menu a.menu-item[href="${r}"]`).getAttribute('aria-current'), 'page', `menu marca ${r}`);
  }
  afirma((await page.title()).includes('Nova campanha'), 'título da aba acompanha a tela');
  await page.goBack(); await page.waitForFunction(() => location.hash === '#/perfil');
  igual(await titulo(page), 'Perfil', 'Voltar do navegador volta uma tela');
  await page.evaluate(() => { location.hash = '#/nao-existe'; });
  await page.waitForFunction(() => location.hash === '#/inicio');
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/2`); await page.waitForSelector('#app:not([hidden])');
  await page.locator('.det-titulo').first().waitFor();
  afirma((await page.locator('#conteudo').innerText()).includes('Balconista destaque'), 'link direto abre o detalhe');
});

teste('navegação: barra de baixo leva ao Perfil; o menu abre só pelo ☰ do topo (v2.9.1)', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  igual(await page.locator('#bi-menu').count(), 0, 'sem botão Menu na barra de baixo');
  const perfil = page.locator('#barra-inferior a[href="#/perfil"]');
  afirma(await perfil.isVisible(), 'Perfil na barra de baixo');
  await perfil.click();
  await page.waitForFunction(() => location.hash === '#/perfil');
  igual(await perfil.getAttribute('aria-current'), 'page', 'Perfil marcado como página atual');
  const alvo = await perfil.boundingBox();
  afirma(alvo.height >= 44, 'alvo de toque de 44 px');
  // Administrador com conta esperando liberação (u-novo no simulador): ponto no ☰.
  await page.locator('#abrir-menu.com-aviso').waitFor({ timeout: 5000 });
  afirma(/esperando liberação/.test(await page.getAttribute('#abrir-menu', 'aria-label')), 'o ☰ diz que há contas esperando');
}, { largura: 390, altura: 844 });

teste('navegação: menu do celular abre, trava o fundo e fecha com Esc', async ({ page }) => {
  await abrir(page);
  await page.click('#abrir-menu');
  afirma(await page.evaluate(() => document.body.classList.contains('menu-aberto')), 'menu aberto');
  afirma(await page.evaluate(() => document.querySelector('#conteudo').inert), 'conteúdo inerte com o menu aberto');
  igual(await page.getAttribute('#abrir-menu', 'aria-expanded'), 'true', 'aria-expanded');
  await page.keyboard.press('Escape');
  afirma(!(await page.evaluate(() => document.body.classList.contains('menu-aberto'))), 'Esc fecha');
  afirma(!(await page.evaluate(() => document.querySelector('#conteudo').inert)), 'conteúdo volta a ser usável');
  await page.click('#abrir-menu'); await page.click('#menu a[href="#/historico"]');
  await page.waitForFunction(() => location.hash === '#/historico');
  afirma(!(await page.evaluate(() => document.body.classList.contains('menu-aberto'))), 'escolher item fecha o menu');
}, { largura: 390, altura: 844 });

teste('navegação: primeiro Tab vai para "Pular para o conteúdo"', async ({ page }) => {
  await abrir(page);
  await page.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Tab');
  igual(await page.evaluate(() => document.activeElement.id), 'pular', 'link de pular é o primeiro foco');
  afirma(await page.locator('#pular').isVisible(), 'link de pular aparece ao receber foco');
});

// ============================================================
//  3. INÍCIO
// ============================================================
teste('início: fila do aprovador conta todas as pendentes; coordenador só as dele', async ({ page }) => {
  await abrir(page, { papel: 'aprovador' });
  const d = await db(page);
  const pend = d.campanhas.filter(c => c.status === 'Pendente');
  afirma((await page.locator('#conteudo').innerText()).includes(String(pend.length)), 'mostra 3 pendentes');
  igual(await page.locator('#menu [data-contador]').innerText(), String(pend.length), 'contador do menu (aprovador)');
  await abrir(page, { papel: 'coordenador' });
  const minhas = pend.filter(c => c.solicitante_id === 'u-coord').length;
  igual(await page.locator('#menu [data-contador]').innerText(), String(minhas), 'contador do menu (coordenador)');
  afirma((await page.locator('#fila-t').innerText()).length > 0, 'bloco da fila existe');
  afirma((await page.locator('#conteudo').innerText()).includes(`${minhas} campanha`), 'coordenador vê só as dele');
});

// ============================================================
//  4. CAMPANHAS — lista e filtros
// ============================================================
teste('campanhas: filtros de status, busca sem acento, laboratório e "Só as minhas"', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  const n = s => page.locator(`#cp-status [data-status="${s}"] .n`).innerText();
  igual(await n('Pendente'), '3', 'pendentes'); igual(await n('Aprovada'), '3', 'aprovadas (inclui 1 importada)'); igual(await n('Reprovada'), '1', 'reprovadas');
  igual(await page.locator('#cp-itens .cartao').count(), 3, 'lista começa nas pendentes');
  await page.click('#cp-status [data-status="Todas"]');
  igual(await page.locator('#cp-itens .cartao').count(), 7, 'todas');
  await page.fill('#cp-busca', 'biogenesis'); await page.waitForTimeout(400);
  igual(await page.locator('#cp-itens .cartao').count(), 1, 'busca sem acento acha Biogénesis');
  afirma(await page.locator('#cp-busca').evaluate(e => e === document.activeElement), 'busca mantém o foco');
  await page.fill('#cp-busca', 'C26111002'); await page.waitForTimeout(400);
  igual(await page.locator('#cp-itens .cartao').count(), 1, 'busca por código');
  await page.fill('#cp-busca', 'zzzz'); await page.waitForTimeout(400);
  igual(await page.locator('#cp-itens .cartao').count(), 0, 'nada encontrado');
  afirma((await page.locator('#cp-itens').innerText()).length > 5, 'estado vazio com texto');
  await page.fill('#cp-busca', ''); await page.waitForTimeout(400);
  await page.selectOption('#cp-lab', 'Premier');
  igual(await page.locator('#cp-itens .cartao').count(), 1, 'filtro de laboratório');
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas' });
  afirma(await page.isChecked('#cp-minhas'), '"Só as minhas" ligado para coordenador');
  igual(await page.getAttribute('#cp-status [data-status="Todas"]', 'aria-pressed'), 'true', 'coordenador começa em "Todas"');
  igual(await page.locator('#cp-itens .cartao').count(), 4, 'coordenador vê as 4 dele');
  await page.click('#cp-status [data-status="Pendente"]');
  igual(await page.locator('#cp-itens .cartao').count(), 2, '2 pendentes dele');
  await page.click('label[for="cp-minhas"]');
  igual(await page.locator('#cp-itens .cartao').count(), 3, 'desligado mostra as da equipe');
});

teste('campanhas: no desktop largo, lista e detalhe lado a lado', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  await page.locator('#cp-itens .cartao').first().click();
  await page.locator('#cp-detalhe .det-titulo').waitFor();
  afirma(await page.locator('#cp-itens').isVisible(), 'lista continua visível');
  igual(await page.locator('#cp-itens .cartao[aria-current="true"]').count(), 1, 'cartão aberto marcado');
});

teste('campanhas: no celular, lista OU detalhe', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  await page.locator('#cp-itens .cartao').first().click();
  await page.locator('.det-titulo').first().waitFor();
  afirma(!(await page.locator('#cp-itens').isVisible()), 'lista escondida com detalhe aberto');
  afirma(await page.locator('#voltar').isVisible(), 'botão Voltar visível');
  await page.click('#voltar');
  await page.waitForFunction(() => location.hash === '#/campanhas');
  afirma(await page.locator('#cp-itens').isVisible(), 'Voltar mostra a lista');
}, { largura: 390, altura: 844 });

// ============================================================
//  5. DETALHE E DECISÃO
// ============================================================
teste('detalhe: dados Swile só para aprovador e solicitante', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas/2' });   // campanha Swile da Bia
  await page.locator('.det-titulo').first().waitFor();
  const t = await page.locator('#conteudo').innerText();
  afirma(!t.includes('111.444.777-35'), 'coordenador de fora não vê o CPF');
  afirma(/vis[ií]ve(l|is) s[óo]/i.test(t) || t.includes('aprovador'), 'aviso de dados protegidos');
  igual(await page.locator('[data-aprovar]').count(), 0, 'coordenador não tem botão Aprovar');
  await abrir(page, { papel: 'aprovador', rota: '#/campanhas/2' });
  await page.locator('.det-titulo').first().waitFor();
  afirma((await page.locator('#conteudo').innerText()).includes('111.444.777-35'), 'aprovador vê o CPF');
});

teste('detalhe: aprovar → desfazer mantém pendente; aprovar de novo grava e abre a próxima', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/1' });
  await page.click('[data-aprovar]');
  await page.locator('.toast .toast-acao', { hasText: 'Desfazer' }).click();
  await toastCom(page, 'desfeita');
  await page.waitForTimeout(6000);
  igual((await db(page)).campanhas.find(c => c.id === 1).status, 'Pendente', 'desfazer não grava');
  await page.click('[data-aprovar]');
  await page.waitForFunction(() => !location.hash.endsWith('/1'), null, { timeout: 9000 });
  const c1 = (await db(page)).campanhas.find(c => c.id === 1);
  igual(c1.status, 'Aprovada', 'aprovação gravada');
  igual(c1.aprovador_nome, 'Ana Aprovadora', 'aprovador carimbado');
  afirma(/#\/campanhas\/\d+$/.test(page.url().split(BASE)[1].replace(/^\/\?[^#]*/, '')), 'abriu a próxima pendente');
  await toastCom(page, 'Aprovada');
});

// decidir direto na lista, com o mesmo módulo (ui/decisao.js) do detalhe.
teste('lista: aprovar pelo cartão grava o mesmo que pelo detalhe; desfazer volta; reprovar pede motivo', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  const pend = (await db(page)).campanhas.filter(c => c.status === 'Pendente').map(c => c.id);
  afirma(pend.length >= 3, 'semente com 3 pendentes');
  const [a, b, r] = pend;
  const rodape = page.locator(`[data-cartao="${a}"] .cartao-acoes`);
  await rodape.waitFor();
  afirma(/da meta|sem meta/.test(await page.locator(`[data-cartao="${a}"]`).innerText()) && /R\$/.test(await page.locator(`[data-cartao="${a}"]`).innerText()), 'cartão mostra custo e % da meta');
  const [y1, y2] = await Promise.all([`[data-lista-reprovar="${a}"]`, `[data-lista-aprovar="${a}"]`].map(s => page.locator(s).boundingBox().then(r => Math.round(r.y))));
  igual(y1, y2, 'Reprovar e Aprovar na mesma linha');
  const alt = await page.locator(`[data-lista-aprovar="${a}"]`).boundingBox();
  afirma(alt.height >= 44, 'botão com alvo de 44 px: ' + alt.height);
  igual(await page.locator(`a.cartao [data-lista-aprovar]`).count(), 0, 'botões fora do link do cartão');

  // desfazer dentro de 5 s
  await page.click(`[data-lista-aprovar="${a}"]`);
  await page.locator(`[data-cartao="${a}"] [data-lista-desfazer]`).click();
  await page.waitForTimeout(5600);
  igual((await db(page)).campanhas.find(c => c.id === a).status, 'Pendente', 'desfazer mantém pendente');
  await page.locator(`[data-lista-aprovar="${a}"]`).waitFor();

  // aprova pela lista
  await page.click(`[data-lista-aprovar="${a}"]`);
  await page.locator(`[data-cartao="${a}"]`, { hasText: 'Aprovando em instantes' }).waitFor();
  await toastCom(page, 'Aprovada ·');
  await page.locator(`[data-cartao="${a}"]`).waitFor({ state: 'detached' });   // sai de "Pendentes"

  // aprova pelo detalhe e compara
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/${b}`);
  await page.locator('[data-aprovar]').click();
  await page.waitForFunction(id => JSON.parse(sessionStorage.getItem('simulado-db-v3')).campanhas.find(c => c.id === id).status === 'Aprovada', b, { timeout: 9000 });
  const d = await db(page);
  const [ca, cb] = [a, b].map(id => d.campanhas.find(c => c.id === id));
  for (const k of ['status', 'aprovador_nome', 'data_decisao', 'motivo']) igual(ca[k], cb[k], `lista e detalhe gravam o mesmo ${k}`);

  // reprova pela lista: motivo obrigatório
  await page.goto(`${BASE}/?papel=aprovador#/campanhas`);
  await page.click(`[data-lista-reprovar="${r}"]`);
  const dlg = page.locator('dialog.dialogo'); await dlg.waitFor();
  await dlg.locator('button[type="submit"]').click();
  await erroDo(page, 'rp-motivo').waitFor();
  await dlg.locator('#rp-motivo').fill('Meta baixa para o investimento');
  await dlg.locator('button[type="submit"]').click(); await dlg.waitFor({ state: 'detached' });
  const cr = (await db(page)).campanhas.find(c => c.id === r);
  igual(cr.status, 'Reprovada', 'reprovada pela lista'); igual(cr.motivo, 'Meta baixa para o investimento', 'motivo gravado');
});

teste('lista: usuário comum não vê Aprovar/Reprovar nos cartões', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas' });
  await page.locator('#cp-itens .cartao').first().waitFor();
  igual(await page.locator('[data-lista-aprovar], [data-lista-reprovar]').count(), 0, 'sem botões de decisão');
});

teste('detalhe: reprovar exige motivo; motivo rápido preenche; grava', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/3' });
  await page.click('[data-reprovar]');
  const d = page.locator('dialog.dialogo');
  await d.waitFor();
  await d.locator('button[type="submit"]').click();
  await d.locator('#rp-motivo-erro:not([hidden])').waitFor();
  await d.locator('[data-motivo]').first().click();
  afirma((await d.locator('#rp-motivo').inputValue()).length > 3, 'chip preenche o motivo');
  igual(await d.locator('.campo.tem-erro').count(), 0, 'erro some ao preencher');
  await d.locator('button[type="submit"]').click();
  await d.waitFor({ state: 'detached' });
  const c3 = (await db(page)).campanhas.find(c => c.id === 3);
  igual(c3.status, 'Reprovada', 'reprova gravada'); afirma(!!c3.motivo, 'motivo gravado');
});

teste('detalhe: Esc fecha o diálogo de reprova sem gravar', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/3' });
  await page.click('[data-reprovar]');
  await page.locator('dialog.dialogo').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('dialog.dialogo').waitFor({ state: 'detached' });
  igual((await db(page)).campanhas.find(c => c.id === 3).status, 'Pendente', 'continua pendente');
});

teste('detalhe: coordenador reenvia campanha reprovada com os dados copiados', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas/5' });
  await page.locator('.det-titulo').first().waitFor();
  await page.locator('a[href="#/nova/de/5"]').click();
  await page.waitForFunction(() => location.hash === '#/nova/de/5');
  igual(await titulo(page), 'Reenviar campanha', 'título');
  igual(await page.inputValue('#n-campanha'), 'Ração Premium', 'nome copiado');
  igual(await page.inputValue('#n-empresa'), 'Pet Center Imperatriz', 'empresa copiada');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Farmina"]', 'laboratório copiado');
  igual(await page.inputValue('#n-inv-lynkz'), '2.500,00', 'investimento copiado');
});

// ============================================================
//  6. NOVA CAMPANHA
// ============================================================
teste('nova: enviar vazio marca os obrigatórios e foca o primeiro', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.locator('[data-enviar]:visible').first().click();
  for (const id of ['n-empresa', 'n-laboratorio', 'n-campanha']) afirma(await erroDo(page, id).isVisible(), `erro em ${id}`);
  igual(await page.evaluate(() => document.activeElement.id), 'n-empresa', 'foco no primeiro erro');
  await page.selectOption('#n-pagamento', 'Depósito / verba');
  await page.locator('[data-enviar]:visible').first().click();
  afirma(await erroDo(page, 'n-inv-lynkz').isVisible(), 'LYNKZ obrigatório em Depósito / verba');
});

teste('nova: combo de empresa funciona só com teclado', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.click('#n-empresa'); await page.keyboard.type('imperatriz');
  igual(await page.getAttribute('#n-empresa', 'aria-expanded'), 'true', 'lista aberta');
  await page.keyboard.press('Enter');
  igual(await page.inputValue('#n-empresa'), 'Pet Center Imperatriz', 'Enter escolhe (busca por cidade)');
  await page.fill('#n-laboratorio', ''); await page.click('#n-laboratorio'); await page.keyboard.type('bag');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Biogénesis Bagó Pet"]', 'setas + Enter acrescenta o laboratório');
  igual(await page.inputValue('#n-laboratorio'), '', 'o campo fica livre para acrescentar outro');
  await page.click('#n-laboratorio'); await page.keyboard.type('xyz'); await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
  igual(await page.inputValue('#n-laboratorio'), '', 'texto solto não fica no campo');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Biogénesis Bagó Pet"]', 'texto solto não mexe nos escolhidos');
});

teste('nova: Swile + balconista preenche, edição atualiza o cadastro e a campanha grava tudo', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz');
  await escolherNoCombo(page, '#n-laboratorio', 'premier', 'Premier');
  await page.fill('#n-campanha', 'Balconista Dezembro');
  await page.selectOption('#n-pagamento', 'Swile');
  await page.fill('#n-inv-lynkz', '1500'); await page.fill('#n-meta', '20.000'); await page.click('#n-campanha');
  igual(await page.inputValue('#n-inv-lynkz'), '1.500,00', 'máscara de valor');
  await page.locator('#bloco-recebedor:not([hidden])').waitFor();
  igual(await page.locator('input[name="n-pessoa"]').count(), 2, 'só os 2 balconistas: empresa no limite não oferece "outra pessoa"');
  igual(await page.locator('input[name="n-pessoa"][value="outra"]').count(), 0, 'sem "outra pessoa" com 2 cadastros');
  await page.check('input[name="n-pessoa"][value="2"]');
  igual(await page.inputValue('#n-rec-nome_completo'), 'João Pedro Lima', 'nome preenchido');
  igual(await page.inputValue('#n-rec-cpf'), '111.444.777-35', 'CPF preenchido');
  igual(await page.inputValue('#n-rec-telefone'), '(99) 99999-0002', 'telefone preenchido');
  afirma(await page.locator('#rec-atualizar').isHidden(), 'sem oferta de atualizar antes de editar');
  await page.fill('#n-rec-email', 'joao.novo@exemplo.com');
  afirma(await page.locator('#rec-atualizar').isVisible(), 'oferta de atualizar o cadastro aparece');
  afirma((await page.locator('#be-pct').innerText()).includes('7,5%'), 'resumo de custo ao vivo (1.500 / 20.000)');
  await page.locator('[data-enviar]:visible').first().click();
  await page.locator('dialog.dialogo button', { hasText: 'Enviar assim' }).click();   // sem período e sem meta: o app avisa
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  await toastCom(page, 'fila de aprovação');
  const d = await db(page);
  const c = d.campanhas.at(-1);
  igual(c.empresa_id, 2, 'empresa_id'); igual(+c.balconista_id, 2, 'balconista_id');
  igual(c.cliente, 'Pet Center Imperatriz', 'cliente = nome da empresa');
  igual(c.investimento_lynkz, 1500, 'investimento'); igual(c.meta, 20000, 'meta');
  igual(c.swile_email, 'joao.novo@exemplo.com', 'swile_email da edição'); igual(c.swile_cpf, '11144477735', 'CPF só dígitos');
  igual(d.balconistas.find(b => b.id === 2).email, 'joao.novo@exemplo.com', 'cadastro do balconista atualizado');
  igual(await page.evaluate(() => localStorage.getItem('lynkz_rascunho_campanha_v2')), null, 'rascunho apagado depois de enviar');
});

teste('nova: empresa com um balconista já vem com ele escolhido', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.selectOption('#n-pagamento', 'Swile');
  await escolherNoCombo(page, '#n-empresa', 'agropecu', 'Agropecuária São Luís');
  afirma(await page.isChecked('input[name="n-pessoa"][value="1"]'), 'Maria selecionada');
  igual(await page.inputValue('#n-rec-cpf'), '529.982.247-25', 'dados da Maria');
});

teste('nova: "outra pessoa" vira balconista novo da empresa', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-campanha', 'Primeira com Swile');
  await page.selectOption('#n-pagamento', 'Swile');
  await page.fill('#n-inv-lynkz', '300');
  afirma(await page.isChecked('input[name="n-pessoa"][value="outra"]'), 'sem balconistas: "outra pessoa" por padrão');
  await page.fill('#n-rec-nome_completo', 'Ana');
  await page.fill('#n-rec-cpf', '123'); await page.fill('#n-rec-email', 'x'); await page.fill('#n-rec-telefone', '9');
  await page.locator('[data-enviar]:visible').first().click();
  for (const id of ['n-rec-nome_completo', 'n-rec-cpf', 'n-rec-data_nascimento', 'n-rec-email', 'n-rec-telefone'])
    afirma(await erroDo(page, id).isVisible(), `erro em ${id}`);
  await page.fill('#n-rec-nome_completo', 'Ana Clara dos Santos'); await page.fill('#n-rec-cpf', '39053344705');
  await page.fill('#n-rec-data_nascimento', '1996-03-10'); await page.fill('#n-rec-email', 'ana.clara@exemplo.com');
  await page.fill('#n-rec-telefone', '98912345678');
  afirma(await page.isChecked('#n-rec-salvar'), '"Salvar como balconista" ligado');
  await page.locator('[data-enviar]:visible').first().click();
  await page.locator('dialog.dialogo button', { hasText: 'Enviar assim' }).click();   // sem período e sem meta: o app avisa
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const b = d.balconistas.find(x => x.cpf === '39053344705' && x.empresa_id === 3);
  afirma(!!b, 'balconista criado na empresa 3');
  igual(+d.campanhas.at(-1).balconista_id, b.id, 'campanha ligada ao balconista novo');
  igual(d.campanhas.at(-1).swile_nome_completo, 'Ana Clara dos Santos', 'nome do recebedor Swile gravado sem alterar');
});

teste('nova: CPF de quem já é balconista da empresa é barrado', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'agropecu', 'Agropecuária São Luís');   // 1 balconista: ainda cabe outro
  await page.selectOption('#n-pagamento', 'Swile');
  await page.check('input[name="n-pessoa"][value="outra"]');
  await page.fill('#n-rec-cpf', '52998224725');
  await page.locator('[data-enviar]:visible').first().click();
  afirma((await erroDo(page, 'n-rec-cpf').innerText()).includes('Maria Silva Santos'), 'avisa de quem é o CPF');
});

teste('nova: empresa não é cadastrada pela Nova (vem do Qlik)', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.click('#n-empresa'); await page.keyboard.type('Pet Vida Cohatrac', { delay: 10 });
  const lista = page.locator('#n-empresa ~ .combo-lista');
  await lista.waitFor();
  igual(await page.locator('.combo-criar').count(), 0, 'sem opção "Cadastrar a empresa"');
  afirma(/Qlik/.test(await lista.innerText()), 'lista vazia explica que as empresas vêm do Qlik');
});

teste('nova: rebate e datas validam; resumo mostra o rebate', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.click('label[for="n-rebate"]');
  await page.locator('#bloco-rebate:not([hidden])').waitFor();
  await page.locator('[data-enviar]:visible').first().click();
  afirma(await erroDo(page, 'n-rebate-pct').isVisible(), 'pede o %');
  afirma(await erroDo(page, 'n-meta').isVisible(), 'pede a meta');
  await page.fill('#n-meta', '40000'); await page.fill('#n-rebate-pct', '2,5'); await page.fill('#n-rebate-teto', '500');
  await page.fill('#n-inv-lynkz', '1000');
  afirma((await page.locator('#be-total').innerText()).includes('1.500,00'), 'total = 1.000 + rebate no teto 500');
  await page.fill('#n-inicio', '2026-12-10'); await page.fill('#n-fim', '2026-12-01'); await page.locator('#n-fim').dispatchEvent('change');
  afirma(await erroDo(page, 'n-fim').isVisible(), 'fim antes do início');
});

teste('nova: rascunho volta sem dados pessoais; descartar limpa', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.selectOption('#n-pagamento', 'Swile');
  await escolherNoCombo(page, '#n-empresa', 'agropecu', 'Agropecuária São Luís');
  await page.fill('#n-campanha', 'Teste de rascunho');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => localStorage.getItem('lynkz_rascunho_campanha_v2'));
  afirma(r && r.includes('Teste de rascunho'), 'rascunho gravado');
  afirma(!r.includes('52998224725') && !r.includes('529.982') && !r.includes('maria.silva'), 'rascunho sem CPF/e-mail');
  await page.reload(); await page.waitForSelector('#app:not([hidden])'); await page.locator('#n-campanha').waitFor();
  afirma((await page.locator('#conteudo').innerText()).includes('Rascunho recuperado'), 'aviso de rascunho');
  igual(await page.inputValue('#n-campanha'), 'Teste de rascunho', 'nome volta');
  igual(await page.inputValue('#n-empresa'), 'Agropecuária São Luís', 'empresa volta');
  igual(await page.inputValue('#n-rec-cpf'), '529.982.247-25', 'dados da balconista voltam do cadastro');
  await page.click('#descartar');
  await page.waitForFunction(() => document.querySelector('#n-campanha')?.value === '');
  await page.waitForTimeout(700);
  igual(await page.evaluate(() => localStorage.getItem('lynkz_rascunho_campanha_v2')), null, 'rascunho apagado');
});

teste('nova: atualização ao vivo de outra campanha NÃO apaga o formulário', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await page.selectOption('#n-pagamento', 'Swile');
  await page.fill('#n-rec-nome_completo', 'Pessoa Digitada Agora');
  await page.fill('#n-rec-cpf', '390.533.447-05');
  await page.focus('#n-rec-cpf');
  // Outra pessoa aprova a campanha 1 enquanto o formulário está aberto.
  await page.evaluate(async () => { const { sb } = await import('/js/lib/supabase.js'); await sb.from('campanhas').update({ status: 'Aprovada' }).eq('id', 1).select('id'); });
  await page.waitForTimeout(800);
  igual(await page.inputValue('#n-rec-nome_completo'), 'Pessoa Digitada Agora', 'nome digitado continua');
  igual(await page.inputValue('#n-rec-cpf'), '390.533.447-05', 'CPF digitado continua');
  igual(await page.evaluate(() => document.activeElement.id), 'n-rec-cpf', 'foco continua no campo');
  igual(await page.locator('#menu [data-contador]').innerText(), '2', 'contador atualizado ao vivo');
});

teste('ao vivo: aprovador recebe aviso de campanha nova de outro coordenador', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  await page.evaluate(async () => {
    const { sb } = await import('/js/lib/supabase.js');
    await sb.auth.signInWithPassword({ email: 'bia@lynkz.com.br' });
    await sb.from('campanhas').insert({ cliente: 'Casa do Criador', empresa_id: 3, laboratorio: 'Avert', campanha: 'Chegou agora', status: 'Pendente', solicitante_id: 'u-bia', investimento_lynkz: 100 }).select('id');
    await sb.auth.signInWithPassword({ email: 'ana@lynkz.com.br' });
  });
  await toastCom(page, 'Nova campanha aguardando você');
  await page.locator('#cp-itens .cartao', { hasText: 'Chegou agora' }).waitFor();
});

// ============================================================
//  7. GESTÃO
// ============================================================
teste('gestão: lista, busca por balconista e desativadas', async ({ page }) => {
  await abrir(page, { rota: '#/gestao' });
  const linhas = () => page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count();
  igual(await linhas(), 3, '3 empresas ativas');
  await page.click('label[for="gs-inativas"]');
  // as desativadas são lidas só agora, sob demanda.
  await page.waitForFunction(() => document.querySelectorAll('#gs-itens a[href^="#/gestao/empresas/"]').length === 4, null, { timeout: 5000 }).catch(() => {});
  igual(await linhas(), 4, 'com desativadas: 4');
  await page.fill('#gs-busca', 'joao'); await page.waitForTimeout(400);
  igual(await linhas(), 1, 'busca pelo nome do balconista (sem acento)');
  afirma((await page.locator('#gs-itens').innerText()).includes('Pet Center'), 'achou a empresa do João');
});

teste('gestão: "Cadastrar balconista" escolhe a empresa primeiro e respeita o limite de 2', async ({ page }) => {
  await abrir(page, { rota: '#/gestao' });
  igual(await page.locator('#gs-nova').count(), 0, 'não existe mais "Cadastrar empresa"');
  afirma((await page.locator('#gs-itens').innerText()).includes('Balconistas: 2 de 2'), 'lista mostra as vagas por empresa');
  await page.click('#gs-novo-balc');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  afirma(await d.locator('#db-dados').evaluate(f => f.disabled) && await d.locator('#db-nome_completo').isDisabled(), 'dados travados até escolher a empresa');
  await d.locator('button[type="submit"]').click();
  afirma(/empresa primeiro/i.test(await d.locator('#db-empresa-erro').innerText()), 'pede a empresa antes');
  // empresa no limite (Pet Center: João e Ana)
  await d.locator('#db-empresa').fill(''); await d.locator('#db-empresa').type('pet center', { delay: 15 });
  const opPet = d.locator('#db-empresa ~ .combo-lista [role=option]', { hasText: 'Pet Center Imperatriz' }).first();
  afirma(/limite atingido/.test(await opPet.innerText()), 'opção avisa que a empresa está no limite');
  await opPet.click();
  await d.locator('#db-empresa-erro:not([hidden])', { hasText: 'limite' }).waitFor({ timeout: 3000 });   // empresa cheia é explicada no campo
  afirma(await d.locator('#db-nome_completo').isDisabled(), 'dados continuam travados com a empresa cheia');
  // empresa com vaga (Casa do Criador: 0 de 2)
  await d.locator('#db-empresa').fill(''); await d.locator('#db-empresa').type('casa do', { delay: 15 });
  await d.locator('#db-empresa ~ .combo-lista [role=option]', { hasText: 'Casa do Criador' }).first().click();
  await page.waitForFunction(() => !document.querySelector('#db-nome_completo').disabled, null, { timeout: 3000 });   // dados liberados com vaga
  await d.locator('#db-nome_completo').fill('Rita Souza Lima'); await d.locator('#db-cpf').fill('71460238001');
  await d.locator('#db-data_nascimento').fill('1994-02-03'); await d.locator('#db-email').fill('rita@exemplo.com'); await d.locator('#db-telefone').fill('99988776655');
  await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  await toastCom(page, 'Rita Souza Lima cadastrado em Casa do Criador');
  const b = (await db(page)).balconistas.find(x => x.nome_completo === 'Rita Souza Lima');
  igual(b?.empresa_id, 3, 'gravada na empresa escolhida');
  await page.locator('.toast-acao', { hasText: 'Ver empresa' }).click();
  await page.waitForFunction(() => location.hash === '#/gestao/empresas/3');
});

teste('gestão: ficha edita empresa, cadastra/edita/desativa balconista e desativa empresa', async ({ page }) => {
  await abrir(page, { rota: '#/gestao/empresas/1' });
  await page.click('#fx-editar');
  let d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('#de-cidade').fill('São Luís - MA'); await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  // A ficha redesenha no evento "close" do diálogo, que chega um instante depois: espera o texto.
  await page.locator('#conteudo', { hasText: 'São Luís - MA' }).waitFor({ timeout: 5000 });   // cidade editada
  afirma((await page.locator('.vagas').innerText()).includes('1 de 2'), 'ficha mostra as vagas');

  await page.click('#fx-novo-balc');
  d = page.locator('dialog.dialogo'); await d.waitFor();
  afirma(/1 de 2/.test(await d.innerText()), 'diálogo mostra a empresa e as vagas');
  await d.locator('#db-nome_completo').fill('Clara Mendes'); await d.locator('#db-cpf').fill('52998224725');
  await d.locator('#db-data_nascimento').fill('1999-07-01'); await d.locator('#db-email').fill('clara@exemplo.com'); await d.locator('#db-telefone').fill('99988776655');
  await d.locator('button[type="submit"]').click();
  await page.waitForTimeout(600);
  afirma(/já existe/i.test(await d.innerText()), 'CPF repetido na empresa é barrado');
  await d.locator('#db-cpf').fill('714.602.380-01');
  await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  await page.locator('#conteudo', { hasText: 'Clara Mendes' }).waitFor({ timeout: 5000 });       // balconista novo na lista
  afirma(await page.locator('#fx-novo-balc').isDisabled(), 'com 2 cadastros, "Cadastrar" fica travado');
  afirma(/limite/i.test(await page.locator('#fx-vagas').innerText()), 'e o motivo aparece');

  const novo = (await db(page)).balconistas.find(b => b.nome_completo === 'Clara Mendes');
  await page.click(`[data-editar-balc="${novo.id}"]`);
  d = page.locator('dialog.dialogo'); await d.waitFor();
  igual(await d.locator('#db-cpf').inputValue(), '714.602.380-01', 'edição vem preenchida');
  await d.locator('#db-telefone').fill('99911112222'); await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  igual((await db(page)).balconistas.find(b => b.id === novo.id).telefone, '99911112222', 'telefone editado');

  await page.click(`[data-ativo-balc="${novo.id}"]`);
  const conf = page.locator('dialog.dialogo'); if (await conf.count()) { await conf.locator('button[type="submit"]').click(); await conf.waitFor({ state: 'detached' }); }
  await page.waitForTimeout(400);
  igual((await db(page)).balconistas.find(b => b.id === novo.id).ativo, false, 'balconista desativado');
  afirma(await page.locator('#fx-novo-balc').isDisabled(), 'desativado continua contando no limite');

  await page.click('#fx-ativo');
  const c2 = page.locator('dialog.dialogo'); await c2.waitFor(); await c2.locator('button[type="submit"]').click(); await c2.waitFor({ state: 'detached' });
  await page.locator('#fx-ativo', { hasText: 'Reativar' }).waitFor();
  igual((await db(page)).empresas.find(e => e.id === 1).ativo, false, 'empresa desativada');
  afirma(await page.locator('#fx-novo-balc').isDisabled(), 'empresa desativada não recebe balconista');
});

teste('usuários: administrador libera conta, muda papel com confirmação e não se rebaixa', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  await page.locator('#menu a[data-nav="usuarios"]').first().waitFor({ state: 'attached' });
  await page.goto(page.url().replace(/#.*$/, '#/usuarios'));
  await page.locator('[data-liberar]').first().waitFor();
  afirma((await page.locator('#conteudo').innerText()).includes('diego@lynkz.com.br'), 'conta nova aparece em "Sem acesso"');
  await page.click('[data-liberar="u-novo"]');
  await toastCom(page, 'já pode entrar');
  igual((await db(page)).perfis['u-novo'].ativo, true, 'acesso liberado');

  await page.click('[data-editar-usuario="u-novo"]');
  let d = page.locator('dialog.dialogo').last(); await d.waitFor();
  await d.locator('#du-nome').fill('Diego Ramos');
  await d.locator('input[name="du-papel"][value="aprovador"]').check();
  await d.locator('button[type="submit"]').click();
  const conf = page.locator('dialog.dialogo', { hasText: 'Tornar Diego Ramos administrador?' });
  await conf.waitFor();
  await conf.locator('button[type="submit"]').click();
  await page.locator('dialog.dialogo').first().waitFor({ state: 'detached' });
  const p = (await db(page)).perfis['u-novo'];
  igual(p.papel, 'aprovador', 'virou administrador'); igual(p.nome, 'Diego Ramos', 'nome trocado');

  await page.click('[data-editar-usuario="u-aprov"]');
  d = page.locator('dialog.dialogo'); await d.waitFor();
  afirma(await d.locator('input[name="du-papel"]').first().isDisabled(), 'o próprio papel fica travado');
  igual(await d.locator('#du-ativo').count(), 0, 'sem desligar o próprio acesso');
  await d.locator('button', { hasText: 'Cancelar' }).click();
});

// contas esperando liberação no menu e no Início do administrador.
teste('usuários: menu mostra quantas contas esperam liberação; o Início avisa; liberar zera', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  const cont = page.locator('#menu [data-contador-usuarios]');
  await page.waitForFunction(() => document.querySelector('#menu [data-contador-usuarios]')?.hidden === false);
  igual((await cont.innerText()).trim(), '1', 'u-novo desativado conta 1');
  afirma(/1 conta esperando liberação/.test(await cont.getAttribute('aria-label')), 'nome acessível do contador');
  const aviso = page.locator('.aviso-usuarios');
  afirma(/1 pessoa esperando liberação/.test(await aviso.innerText()), 'Início avisa');
  await aviso.locator('a').click();
  await page.waitForFunction(() => location.hash === '#/usuarios');
  await page.click('[data-liberar="u-novo"]');
  await toastCom(page, 'já pode entrar');
  await page.waitForFunction(() => document.querySelector('#menu [data-contador-usuarios]')?.hidden === true);
  await page.goto(`${BASE}/?papel=aprovador#/inicio`);
  await page.locator('.saudacao').waitFor();
  igual(await page.locator('.aviso-usuarios').count(), 0, 'sem aviso depois de liberar');
});

teste('usuários: usuário comum não vê o menu nem a tela', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/usuarios' });
  igual(await page.locator('[data-nav="usuarios"]').count(), 0, 'sem item Usuários no menu');
  afirma((await page.locator('#conteudo').innerText()).includes('Só administradores'), 'rota direta explica');
  afirma((await page.locator('.menu-usuario').innerText()).includes('Usuário'), 'menu mostra o papel como "Usuário"');
});

teste('gestão: "Nova campanha" na ficha já abre com a empresa escolhida', async ({ page }) => {
  await abrir(page, { rota: '#/gestao/empresas/1' });
  await page.click('[data-nova-empresa="1"]');
  await page.waitForFunction(() => location.hash === '#/nova');
  igual(await page.inputValue('#n-empresa'), 'Agropecuária São Luís', 'empresa preenchida');
});

// ============================================================
//  8. HISTÓRICO, PERFIL, EXCEL, SAIR
// ============================================================
teste('histórico: contagens, filtro e busca', async ({ page }) => {
  await abrir(page, { rota: '#/historico' });
  const n = s => page.locator(`#hs-status [data-status="${s}"] .n`).innerText();
  igual(await n('Aprovada'), '3', 'aprovadas (inclui 1 importada)'); igual(await n('Reprovada'), '1', 'reprovadas');
  await page.click('#hs-status [data-status="Reprovada"]');
  afirma((await page.locator('#hs-itens').innerText()).includes('Ração Premium'), 'filtro reprovadas');
  await page.click('#hs-status [data-status="Aprovada"]');
  await page.fill('#hs-busca', 'vermifugos'); await page.waitForTimeout(400);
  afirma((await page.locator('#hs-itens').innerText()).includes('Combo Vermífugos'), 'busca sem acento');
});

teste('perfil: Excel baixa com todas as campanhas e formatos', async ({ page }) => {
  if (!XLSX_MJS) return 'pulado (instale xlsx em tests/e2e)';
  await abrir(page, { rota: '#/perfil' });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pf-excel')]);
  const arq = path.join(SAIDA, dl.suggestedFilename()); await dl.saveAs(arq);
  afirma(/^Extrato_Campanhas_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), 'nome do arquivo');
  const wb = XLSX_LER.read(fs.readFileSync(arq), { cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX_LER.utils.sheet_to_json(ws, { header: 1 });
  igual(linhas.length - 1, (await db(page)).campanhas.length, 'uma linha por campanha');
  const cab = linhas[0];
  for (const t of ['ID', 'Cliente', 'Custo Total (R$)', 'Status']) afirma(cab.includes(t), `coluna ${t}`);
  const colData = XLSX_LER.utils.encode_col(cab.indexOf('Data Solicitação'));
  afirma(ws[colData + '2'].z && /d/.test(ws[colData + '2'].z) && typeof ws[colData + '2'].v === 'number', 'data como data do Excel');
  const colCusto = XLSX_LER.utils.encode_col(cab.indexOf('Custo Total (R$)'));
  afirma(/R\$/.test(ws[colCusto + '2'].z), 'custo em formato de moeda');
  relatorio.excel = { arquivo: path.basename(arq), colunas: cab.length, linhas: linhas.length - 1 };
});

teste('perfil: sair volta ao login e apaga o rascunho', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.fill('#n-campanha', 'vai sumir'); await page.waitForTimeout(600);
  await page.goto(`${BASE}/?papel=aprovador#/perfil`); await page.waitForSelector('#pf-sair');
  await page.click('#pf-sair');
  const conf = page.locator('dialog.dialogo', { hasText: 'descartar o rascunho' });
  await conf.waitFor();                                   // com rascunho, pergunta antes
  await conf.locator('button[type="submit"]').click();
  await page.waitForSelector('#acesso:not([hidden]) #f-login');
  igual(await page.evaluate(() => localStorage.getItem('lynkz_rascunho_campanha_v2')), null, 'rascunho apagado ao sair');
});

// ============================================================
//  9. REDE, PWA, TEMA
// ============================================================
teste('rede: faixa "Sem conexão" aparece e some', async ({ page, contexto }) => {
  await abrir(page);
  await contexto.setOffline(true);
  await page.locator('#offline:not([hidden])').waitFor();
  await contexto.setOffline(false);
  await page.locator('#offline').waitFor({ state: 'hidden' });
});

teste('pwa: service worker registra, guarda o app e abre sem internet', async ({ page, contexto }) => {
  await abrir(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(800);
  const [nomes, versao] = await page.evaluate(async () => [await caches.keys(), window.CONFIG.VERSAO]);
  afirma(nomes.some(c => c.includes(versao)), `cache com a versão ${versao}: ${nomes.join(',')}`);
  await contexto.setOffline(true);
  await page.reload(); await page.waitForSelector('#app:not([hidden]), #acesso:not([hidden])', { timeout: 10000 });
  await contexto.setOffline(false);
  const manif = await (await fetch(BASE + '/manifest.json')).json();
  afirma(manif.icons.some(i => i.purpose === 'maskable'), 'ícone maskable no manifest');
}, { sw: 'allow' });

teste('tema: modo escuro troca as cores', async ({ page }) => {
  await abrir(page);
  const fundo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  afirma(!/255, 255, 255|238, 240, 242/.test(fundo), 'fundo escuro: ' + fundo);
  await page.screenshot({ path: path.join(SAIDA, 'escuro-inicio-1440.png') });
}, { escuro: true });

// ============================================================
//  v2.1 — LOTE A: banco desatualizado e estados de erro
// ============================================================
teste('lote A: banco sem as migrações mostra "Sistema em atualização" e volta com "Tentar de novo"', async ({ page }) => {
  await page.goto(`${BASE}/?papel=aprovador&zerar=1&sem=campanhas_app,empresas,balconistas#/inicio`);
  await page.locator('.manutencao-caixa').waitFor();
  igual(await titulo(page), 'Sistema em atualização', 'título');
  const t = await page.locator('#conteudo').innerText();
  afirma(!/could not|schema cache|does not exist|failed/i.test(t), 'sem texto técnico em inglês na tela');
  afirma((await page.locator('.manutencao-detalhes').textContent()).includes('04-gestao-empresas-balconistas.sql'), 'detalhes para o TI (recolhidos) citam a migração');
  afirma(!(await page.locator('.menu-nova').isVisible()), 'sem atalho para Nova campanha');
  igual(await page.locator('.toast').count(), 0, 'nenhum aviso flutuante');
  await page.click('#menu a[href="#/campanhas"]');
  igual(await page.locator('#cp-itens').count(), 0, 'nenhuma lista abre em manutenção');
  await page.evaluate(() => history.replaceState(history.state, '', '/?papel=aprovador#/inicio'));
  await page.click('#manut-tentar');
  await page.locator('.destaque').waitFor();
  igual(await titulo(page), 'Início', 'app volta ao normal');
  afirma(await page.locator('.menu-nova').isVisible(), 'atalho de Nova campanha volta');
});

teste('lote A: falha de rede mostra erro com "Tentar de novo", não "Nada encontrado", e faixa sem toast', async ({ page }) => {
  await page.goto(`${BASE}/?papel=aprovador&zerar=1&falhar=campanhas_app#/campanhas`);
  await page.locator('#cp-itens .estado-erro').waitFor();
  const t = await page.locator('#cp-itens').innerText();
  afirma(t.includes('Não foi possível carregar'), 'estado de erro na lista');
  afirma(!t.includes('Nada encontrado') && !t.includes('Nada por aqui'), 'não finge lista vazia');
  igual(await page.locator('.toast').count(), 0, 'nenhum aviso flutuante para erro de carga');
  afirma(await page.locator('#faixa-erro').isVisible(), 'faixa de erro visível');
  const topo = await page.locator('#topo').boundingBox(), faixa = await page.locator('#faixa-erro').boundingBox();
  afirma(faixa.y >= topo.y + topo.height, 'faixa abaixo do topo (não cobre as ações)');
  await page.evaluate(() => history.replaceState(history.state, '', '/?papel=aprovador#/campanhas'));
  await page.locator('#cp-itens [data-tentar-de-novo]').click();
  await page.locator('#cp-itens .cartao').first().waitFor();
  await page.locator('#faixa-erro').waitFor({ state: 'hidden', timeout: 5000 });   // some quando as duas cargas terminam
});

teste('lote A: erro técnico sem tradução não aparece em inglês', async ({ page }) => {
  await abrir(page);
  const m = await page.evaluate(async () => (await import('/js/dados/erros.js')).traduzir({ message: 'Something weird happened', code: 'XX000' }));
  igual(m, 'Não foi possível concluir agora. Tente de novo.', 'mensagem genérica em português');
  const m2 = await page.evaluate(async () => (await import('/js/dados/erros.js')).traduzir({ message: 'x', code: 'PGRST205' }));
  afirma(m2.includes('em atualização'), 'PGRST205 vira "em atualização"');
});

// ============================================================
//  v2.1 — LOTE B: acesso e conta
// ============================================================
teste('lote B: olho mostra e oculta a senha sem tirar o foco', async ({ page }) => {
  await deslogado(page);
  await page.fill('#l-senha', 'abc123');
  const olho = page.locator('[data-olho="l-senha"]');
  await olho.click();
  igual(await page.getAttribute('#l-senha', 'type'), 'text', 'senha visível');
  igual(await olho.getAttribute('aria-pressed'), 'true', 'aria-pressed');
  igual(await olho.getAttribute('aria-label'), 'Ocultar senha', 'aria-label muda');
  igual(await page.evaluate(() => document.activeElement.id), 'l-senha', 'foco continua no campo');
  await olho.click();
  igual(await page.getAttribute('#l-senha', 'type'), 'password', 'oculta de novo');
  igual(await olho.getAttribute('aria-label'), 'Mostrar senha', 'aria-label volta');
  const caixa = await olho.boundingBox();
  afirma(caixa.width >= 44 && caixa.height >= 44, 'alvo de toque de 44 px');
});

teste('lote B: aviso de Caps Lock aparece com o campo em foco e some', async ({ page }) => {
  await deslogado(page);
  await page.focus('#l-senha');
  const tecla = (tipo, caps) => page.evaluate(([t, c]) => document.querySelector('#l-senha')
    .dispatchEvent(new KeyboardEvent(t, { key: 'a', bubbles: true, modifierCapsLock: c })), [tipo, caps]);
  await tecla('keydown', true);
  afirma((await page.locator('#l-senha-caps').innerText()).includes('Caps Lock está ligado'), 'aviso aparece');
  await tecla('keyup', false);
  igual((await page.locator('#l-senha-caps').innerText()).trim(), '', 'some quando desliga');
  await tecla('keydown', true);
  await page.focus('#l-email');
  igual((await page.locator('#l-senha-caps').innerText()).trim(), '', 'some ao sair do campo');
});

teste('lote B: "Lembrar meu e-mail" preenche o e-mail e foca a senha; nunca guarda a senha', async ({ page }) => {
  const SENHA = 'MinhaSenha#2026';
  await deslogado(page);
  afirma(await page.isChecked('#l-lembrar'), 'lembrar vem marcado');
  await page.fill('#l-email', 'carlos@lynkz.com.br'); await page.fill('#l-senha', SENHA); await page.click('#l-entrar');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#menu-sair');                          // sem rascunho: não pergunta
  await page.waitForSelector('#acesso:not([hidden]) #f-login');
  igual(await page.inputValue('#l-email'), 'carlos@lynkz.com.br', 'e-mail lembrado');
  igual(await page.evaluate(() => document.activeElement.id), 'l-senha', 'foco direto na senha');
  const tudo = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  afirma(!tudo.includes(SENHA), 'senha não fica no aparelho');
  await page.click('label[for="l-lembrar"]');
  await page.fill('#l-senha', SENHA); await page.click('#l-entrar');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#menu-sair');
  await page.waitForSelector('#acesso:not([hidden]) #f-login');
  igual(await page.inputValue('#l-email'), '', 'desmarcado: e-mail esquecido');
  afirma(!(await page.isChecked('#l-lembrar')), 'a escolha de não lembrar é mantida');
});

teste('lote B: senha errada foca a senha selecionada; 3 erros oferecem redefinir', async ({ page }) => {
  await deslogado(page);
  await page.fill('#l-email', 'carlos@lynkz.com.br');
  for (let i = 1; i <= 3; i++) {
    await page.fill('#l-senha', 'errada' + i); await page.click('#l-entrar');
    await page.locator('#l-senha-erro', { hasText: 'inválidos' }).waitFor();
    if (i === 1) {
      igual(await page.evaluate(() => document.activeElement.id), 'l-senha', 'foco na senha');
      afirma(await page.evaluate(() => { const s = document.activeElement; return s.selectionStart === 0 && s.selectionEnd === s.value.length; }), 'texto selecionado');
      igual(await page.locator('#l-redefinir').count(), 0, 'sem link antes de 3 erros');
    }
  }
  await page.click('#l-redefinir');
  await page.locator('#acesso h1', { hasText: 'Redefinir senha' }).waitFor();
});

teste('lote B: Perfil → Alterar senha confere a atual e grava a nova', async ({ page }) => {
  await abrir(page, { rota: '#/perfil' });
  await page.click('#pf-senha');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('#pf-atual').fill('errada');
  await d.locator('#pf-nova').fill('NovaSenha123');
  afirma((await d.locator('#pf-nova-forca .forca-texto').innerText()).includes('forte'), 'medidor de força ao vivo');
  await d.locator('#pf-nova2').fill('NovaSenha123');
  await d.locator('button[type="submit"]').click();
  await d.locator('#pf-atual-erro', { hasText: 'incorreta' }).waitFor();
  await d.locator('#pf-atual').fill('certa-123');
  await d.locator('button[type="submit"]').click();
  await d.waitFor({ state: 'detached' });
  await toastCom(page, 'Senha alterada');
  igual(await titulo(page), 'Perfil', 'continua logado no Perfil');
});

// ============================================================
//  v2.1 — LOTE C: Início e listas
// ============================================================
teste('lote C: valor do card da fila numa linha só no celular', async ({ page }) => {
  await abrir(page);
  const v = page.locator('.destaque .valor');
  afirma((await v.innerText()).startsWith('R$'), 'valor separado do número de campanhas');
  igual(await v.evaluate(e => e.getClientRects().length), 1, '"R$ …" não quebra de linha');
  afirma((await page.locator('.destaque-valor').innerText()).trim().endsWith('campanhas'), 'linha de cima só com a quantidade');
}, { largura: 390, altura: 844 });

teste('lote C: indicador do Início abre a lista filtrada com chip; × limpa e mostra todas', async ({ page }) => {
  await abrir(page);
  await page.locator('.numero-link', { hasText: 'Pendentes' }).click();
  await page.waitForFunction(() => location.hash === '#/campanhas?status=Pendente');
  const chip = page.locator('#cp-chips [data-tirar="status"]');
  igual((await chip.innerText()).trim(), 'Pendentes', 'chip do filtro da URL');
  igual(await page.locator('#cp-itens .cartao').count(), 3, 'lista só com as pendentes');
  await chip.click();
  await page.waitForFunction(() => location.hash === '#/campanhas');
  afirma(await page.locator('#cp-chips').isHidden(), 'chip some');
  igual(await page.getAttribute('#cp-status [data-status="Todas"]', 'aria-pressed'), 'true', 'volta para Todas');
  igual(await page.locator('#cp-itens .cartao').count(), 7, 'mostra todas');
  await page.click('#menu a[href="#/inicio"]');
  await page.locator('.numero-link', { hasText: 'Rebate comprometido' }).click();
  await page.waitForFunction(() => location.hash.includes('rebate=1'));
  afirma((await page.locator('#cp-chips').innerText()).includes('Aprovadas em novembro'), 'chip com o mês');
  afirma((await page.locator('#cp-chips').innerText()).includes('Com rebate'), 'chip do rebate');
});

teste('lote C: × da busca e Esc limpam e devolvem a lista', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  await page.click('#cp-status [data-status="Todas"]');
  const x = page.locator('[data-limpar-busca="cp-busca"]');
  afirma(await x.isHidden(), '× escondido sem texto');
  await page.fill('#cp-busca', 'biogenesis'); await page.waitForTimeout(400);
  igual(await page.locator('#cp-itens .cartao').count(), 1, 'busca filtra');
  afirma(await x.isVisible(), '× aparece com texto');
  const caixa = await x.boundingBox();
  afirma(caixa.width >= 44 && caixa.height >= 44, '× com 44 px');
  await x.click(); await page.waitForTimeout(400);
  igual(await page.inputValue('#cp-busca'), '', '× limpa');
  igual(await page.locator('#cp-itens .cartao').count(), 7, 'lista volta');
  igual(await page.evaluate(() => document.activeElement.id), 'cp-busca', 'foco volta para a busca');
  await page.fill('#cp-busca', 'zzzz'); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  igual(await page.inputValue('#cp-busca'), '', 'Esc limpa');
  igual(await page.locator('#cp-itens .cartao').count(), 7, 'lista volta depois do Esc');
  await page.click('#menu a[href="#/historico"]');
  await page.fill('#hs-busca', 'xyz'); await page.locator('[data-limpar-busca="hs-busca"]').click();
  igual(await page.inputValue('#hs-busca'), '', '× também no Histórico');
  await page.click('#menu a[href="#/gestao"]');
  await page.fill('#gs-busca', 'xyz'); await page.locator('[data-limpar-busca="gs-busca"]').click();
  igual(await page.inputValue('#gs-busca'), '', '× também na Gestão');
});

// ============================================================
//  v2.1 — LOTE D: detalhe e decisão
// ============================================================
teste('lote D: topo com o nome da campanha; legenda sem partes zeradas', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/1' });
  await page.locator('.det-titulo').first().waitFor();
  igual(await titulo(page), 'Vacinas Novembro', 'título do topo é a campanha');
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/2`); await page.locator('#cp-detalhe .det-titulo').waitFor();
  const leg = await page.locator('#cp-detalhe .regua-legenda').innerText();
  afirma(leg.includes('Tudo LYNKZ') && leg.includes('600,00'), 'uma parte só vira frase: ' + leg);
  afirma(!leg.includes('Indústria') && !leg.includes('Rebate'), 'sem partes zeradas');
});

teste('lote D: copiar CPF, código e dados do pagamento', async ({ page, contexto }) => {
  await contexto.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await abrir(page, { rota: '#/campanhas/2' });
  await page.locator('#cp-detalhe [aria-label="Copiar CPF"]').click();
  await toastCom(page, 'CPF copiado');
  igual(await page.evaluate(() => navigator.clipboard.readText()), '11144477735', 'CPF só com dígitos');
  await page.locator('#cp-detalhe [aria-label="Copiar código"]').click();
  igual(await page.evaluate(() => navigator.clipboard.readText()), 'C26111002', 'código da campanha');
  await page.locator('#cp-detalhe [data-copiar-aviso="Dados do pagamento copiados"]').click();
  const t = await page.evaluate(() => navigator.clipboard.readText());
  for (const trecho of ['Nome: João Pedro Lima', 'CPF: 111.444.777-35', 'Nascimento: 30/09/1988', 'Telefone: (99) 99999-0002', 'Valor: R$ 600,00', 'Campanha: C26111002 – Balconista destaque'])
    afirma(t.includes(trecho), 'pagamento contém ' + trecho);
  const b = await page.locator('#cp-detalhe [aria-label="Copiar CPF"]').boundingBox();
  afirma(b.width >= 44 && b.height >= 44, 'botão de copiar com 44 px');
});

teste('lote D: barra de decisão mostra custo e % com o texto da faixa', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/1' });
  const t = await page.locator('#cp-detalhe .decisao-custo').innerText();
  afirma(t.includes('R$ 3.100,00'), 'custo total: ' + t);
  afirma(t.includes('7,8% da meta') && t.includes('dentro do padrão'), 'percentual com texto da faixa: ' + t);
});

teste('lote D: celular mostra o custo acima dos botões', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/1' });
  const c = await page.locator('.decisao-custo').boundingBox(), b = await page.locator('[data-aprovar]').boundingBox();
  afirma(c.y + c.height <= b.y + 1, 'custo numa linha acima dos botões');
  igual(await page.locator('[data-aprovar] kbd').isVisible(), false, 'tecla de atalho escondida no celular');
}, { largura: 390, altura: 844 });

teste('lote D: atalhos A, R, J, K e ? no desktop; nada acontece digitando num campo', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/1' });
  await page.locator('#cp-detalhe [data-aprovar]').waitFor();
  igual(await page.getAttribute('#cp-detalhe [data-aprovar]', 'aria-keyshortcuts'), 'A', 'aria-keyshortcuts');
  afirma(await page.locator('#cp-detalhe [data-aprovar] kbd').isVisible(), 'tecla visível no desktop');
  await page.keyboard.press('j');
  await page.waitForFunction(() => location.hash === '#/campanhas/2');
  await page.keyboard.press('k');
  await page.waitForFunction(() => location.hash === '#/campanhas/1');
  await page.locator('#cp-detalhe [data-aprovar]').waitFor();
  await page.keyboard.press('r');
  await page.locator('dialog.dialogo', { hasText: 'Reprovar' }).waitFor();
  await page.keyboard.press('Escape');
  await page.locator('dialog.dialogo').waitFor({ state: 'detached' });
  await page.focus('#cp-busca');
  await page.keyboard.type('a');
  igual(await page.locator('[data-desfazer]').count(), 0, 'digitar "a" na busca não aprova');
  await page.locator('[data-limpar-busca="cp-busca"]').click(); await page.waitForTimeout(300);
  await page.locator('.det-titulo').first().click();
  await page.keyboard.press('a');
  await page.locator('[data-desfazer]').waitFor();
  await page.locator('[data-desfazer]').click();
  await toastCom(page, 'desfeita');
  await page.keyboard.press('Shift+?');
  await page.locator('dialog.dialogo', { hasText: 'Atalhos de teclado' }).waitFor();
});

// ============================================================
//  v2.1 — LOTE E: nova campanha
// ============================================================
teste('lote E: no celular com toque, a Nova abre sem campo focado', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.waitForTimeout(300);
  const foco = await page.evaluate(() => document.activeElement?.tagName);
  afirma(!['INPUT', 'SELECT', 'TEXTAREA'].includes(foco), 'nenhum campo focado: ' + foco);
}, { largura: 390, altura: 844, toque: true });

teste('lote E: "Rascunho salvo às hh:mm" aparece depois de digitar', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  afirma(await page.locator('#rs-form').isHidden(), 'sem rascunho, sem texto');
  await page.fill('#n-campanha', 'Rascunho com hora');
  await page.waitForTimeout(600);
  afirma(/^Rascunho salvo às \d{2}:\d{2}$/.test(await page.locator('#rs-form').innerText()), 'texto com a hora');
  igual(await page.locator('#rs-form').getAttribute('role'), 'status', 'anunciado por leitor de tela');
  await page.reload(); await page.waitForSelector('#app:not([hidden])'); await page.locator('#n-campanha').waitFor();
  afirma((await page.locator('#rs-form').innerText()).startsWith('Rascunho salvo às'), 'hora volta com o rascunho');
});

teste('lote E: atalhos de período preenchem as datas e mostram a duração', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  const hoje = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date()));
  const [y, m] = hoje.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  await page.click('[data-periodo="este"]');
  igual(await page.inputValue('#n-inicio'), `${hoje.slice(0, 7)}-01`, 'dia 1 do mês');
  igual(await page.inputValue('#n-fim'), ultimo, 'último dia do mês');
  igual(await page.getAttribute('[data-periodo="este"]', 'aria-pressed'), 'true', 'chip marcado');
  await page.click('[data-periodo="30"]');
  igual(await page.inputValue('#n-inicio'), hoje, 'começa hoje');
  igual(await page.locator('#n-duracao').innerText(), '30 dias', 'duração ao lado do Fim');
  igual(await page.getAttribute('[data-periodo="este"]', 'aria-pressed'), 'false', 'outro chip desmarca');
  await page.fill('#n-fim', '');
  await page.locator('#n-fim').dispatchEvent('change');
  igual(await page.getAttribute('[data-periodo="30"]', 'aria-pressed'), 'false', 'mudar a data à mão desmarca');
});

teste('lote E: "Usar como modelo" numa aprovada copia os campos, sem as datas', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas/4' });
  await page.locator('[data-modelo]').click();
  await page.waitForFunction(() => location.hash === '#/nova/de/4');
  igual(await titulo(page), 'Nova campanha', 'é campanha nova, não reenvio');
  afirma((await page.locator('#conteudo').innerText()).includes('como modelo'), 'nota de origem');
  igual(await page.inputValue('#n-campanha'), 'Combo Vermífugos', 'nome copiado');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Vansil"]', 'laboratório copiado');
  igual(await page.inputValue('#n-inicio'), '', 'início não copiado');
  igual(await page.inputValue('#n-fim'), '', 'fim não copiado');
});

// ============================================================
//  v2.1 — LOTE F: Excel da lista e Perfil
// ============================================================
async function lerExcelBaixado(page, clicar) {
  const [dl] = await Promise.all([page.waitForEvent('download'), clicar()]);
  const arq = path.join(SAIDA, dl.suggestedFilename()); await dl.saveAs(arq);
  const ws = XLSX_LER.read(fs.readFileSync(arq)).Sheets.Campanhas;
  return { nome: dl.suggestedFilename(), linhas: XLSX_LER.utils.sheet_to_json(ws) };
}

teste('lote F: Excel do Histórico filtrado tem só as reprovadas', async ({ page }) => {
  if (!XLSX_MJS) return 'pulado (instale xlsx em tests/e2e)';
  await abrir(page, { rota: '#/historico' });
  await page.click('#hs-status [data-status="Reprovada"]');
  const { nome, linhas } = await lerExcelBaixado(page, () => page.click('#hs-excel'));
  afirma(/^Campanhas_Reprovadas_\d{4}-\d{2}-\d{2}\.xlsx$/.test(nome), 'nome com o filtro: ' + nome);
  igual(linhas.length, 1, 'uma linha');
  afirma(linhas.every(l => l.Status === 'Reprovada'), 'só reprovadas');
});

teste('lote F: Excel de Campanhas segue os filtros da tela', async ({ page }) => {
  if (!XLSX_MJS) return 'pulado (instale xlsx em tests/e2e)';
  await abrir(page, { rota: '#/campanhas' });
  const { nome, linhas } = await lerExcelBaixado(page, () => page.click('#cp-excel'));
  afirma(nome.startsWith('Campanhas_Pendentes_'), 'nome: ' + nome);
  igual(linhas.length, 3, 'as 3 pendentes da tela');
  await page.fill('#cp-busca', 'zzzz'); await page.waitForTimeout(400);
  afirma(await page.locator('#cp-excel').isHidden(), 'lista vazia não oferece Excel');
});

teste('lote F: Perfil mostra o último acesso e a ordem das ações', async ({ page }) => {
  await abrir(page, { rota: '#/perfil' });
  afirma(/^Último acesso: hoje, \d{2}:\d{2}$/.test(await page.locator('.perfil-acesso').innerText()), 'último acesso');
  const ordem = await page.$$eval('#conteudo .perfil > *', els => els.map(e => e.id || e.querySelector('.painel-titulo')?.textContent || e.className));
  const i = t => ordem.findIndex(x => String(x).includes(t));
  afirma(i('Resumo') < i('Relatório') && i('Relatório') < i('pf-senha') && i('pf-senha') < i('pf-sair'), 'ordem: Resumo → Relatório → Alterar senha → Sair: ' + ordem.join(' | '));
});

// ============================================================
//  v2.1 — LOTE G: abertura mais rápida
// ============================================================
teste('lote S: aprovador confere no Qlik o total enviado e vê a diferença', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  // Campanha pendente 1 com consulta ao Qlik gravada pelo solicitante: R$ 1.000 (o Qlik simulado dá 1.600,49).
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const c = d.campanhas.find(x => x.id === 1);
    Object.assign(c, { compras_periodo: 1000, compras_consultado_em: new Date().toISOString(), data_inicio: '2026-10-01', data_fim: '2026-10-31' });
    d.empresas.find(e => e.id === c.empresa_id).codigo_cliente = '4821';
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  });
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/1`);
  await page.locator('[data-conferir-qlik]').click();
  const nota = page.locator('#det-notas .nota', { hasText: 'Qlik agora' });
  await nota.waitFor();
  const t = await nota.innerText();
  afirma(/1\.600,49/.test(t) && /Total diferente do enviado/.test(t), 'mostra o total atual e avisa a diferença: ' + t);
  await page.goto(`${BASE}/?papel=coordenador#/campanhas/1`);
  await page.locator('#det-notas').waitFor();
  igual(await page.locator('[data-conferir-qlik]').count(), 0, 'coordenador não vê o botão de conferência');
});

// a conferência do aprovador compara também as devoluções (Qlik simulado: código 4817 → total 1.300,49, devoluções 300).
teste('lote S: conferência no Qlik compara também as devoluções', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  const preparar = (devolucoes) => page.evaluate(dv => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const c = d.campanhas.find(x => x.id === 1);
    Object.assign(c, { compras_periodo: 1300.49, compras_devolucoes: dv, compras_consultado_em: new Date().toISOString(), data_inicio: '2026-10-01', data_fim: '2026-10-31' });
    d.empresas.find(e => e.id === c.empresa_id).codigo_cliente = '4817';
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  }, devolucoes);
  const conferir = async () => {
    await page.goto(`${BASE}/?papel=aprovador#/campanhas/1`);
    await page.reload();   // a conferência anterior fica na memória da página
    await page.locator('[data-conferir-qlik]').click();
    const nota = page.locator('#det-notas .nota', { hasText: 'Qlik agora' });
    await nota.waitFor();
    return nota.innerText();
  };
  await preparar(300);
  let t = await conferir();
  afirma(/devoluções −R\$\s?300,00/.test(t) && /Bate com o que foi enviado/.test(t), 'total e devoluções batem: ' + t);
  await preparar(100);
  t = await conferir();
  afirma(/Devoluções diferentes das enviadas \(−R\$\s?100,00\)/.test(t) && !/Total diferente/.test(t), 'avisa só a diferença das devoluções: ' + t);
  await preparar(null);   // campanha enviada pela 2.8.1: só o total é comparado
  t = await conferir();
  afirma(/Bate com o que foi enviado/.test(t), 'sem devoluções gravadas, compara só o total: ' + t);
});

teste('lote S: sem CDN de terceiros, CSP fechada no Supabase do config e service worker com todos os módulos', async ({ page }) => {
  const raiz = path.join(RAIZ, '..');
  const cab = fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8');
  const nginx = fs.readFileSync(path.join(raiz, 'deploy', 'lynkz-seguranca.conf'), 'utf8');
  const csp = cab.match(/Content-Security-Policy: (.+)/)[1];
  afirma(nginx.includes(csp), 'CSP do nginx igual à do _headers');
  afirma(/script-src 'self';/.test(csp), 'scripts só do próprio site');
  const host = new URL(fs.readFileSync(path.join(RAIZ, 'config.js'), 'utf8').match(/SUPABASE_URL:\s*"([^"]+)"/)[1]).host;
  afirma(csp.includes(`https://${host}`) && csp.includes(`wss://${host}`) && !csp.includes('*.supabase.co'), 'connect-src só no projeto do config.js');
  for (const h of ['Strict-Transport-Security', 'Cross-Origin-Opener-Policy', 'X-Frame-Options', 'X-Content-Type-Options']) afirma(cab.includes(h), h);
  const listar = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listar(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const codigo = listar(path.join(RAIZ, 'js')).map(f => fs.readFileSync(f, 'utf8')).join('\n') + fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  afirma(!/https:\/\/(esm\.sh|cdn\.|unpkg|jsdelivr)/.test(codigo), 'nenhum script de CDN no app');
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const faltam = listar(path.join(RAIZ, 'js')).map(f => path.relative(RAIZ, f).split(path.sep).join('/')).filter(m => !sw.includes(`'${m}'`));
  afirma(!faltam.length, 'módulo fora do ARQUIVOS do sw.js: ' + faltam.join(', '));
  igual(sw.match(/const VERSAO = '([^']+)'/)[1], fs.readFileSync(path.join(RAIZ, 'config.js'), 'utf8').match(/VERSAO: "([^"]+)"/)[1], 'VERSAO igual no sw.js e no config.js');
  igual(fs.readFileSync(path.join(RAIZ, 'js', 'app.js'), 'utf8').match(/VERSAO_APP = '([^']+)'/)[1], sw.match(/const VERSAO = '([^']+)'/)[1], 'VERSAO_APP do app.js igual à do sw.js e do config.js');
  await abrir(page);
  afirma(await page.evaluate(() => typeof window.supabase?.createClient === 'function'), 'supabase-js local carregado');
});

// config.js novo com módulos antigos → recarrega uma vez e abre; sem loop.
async function contarCargas(page) { let n = 0; page.on('load', () => n++); return () => n; }
teste('lote S: versão misturada recarrega uma vez e abre já na versão certa', async ({ page }) => {
  let primeira = true;
  await page.route('**/config.js*', async rota => {
    const r = await rota.fetch();
    let corpo = await r.text();
    if (primeira) { primeira = false; corpo = corpo.replace(/VERSAO: "[^"]+"/, 'VERSAO: "9.9.9"'); }
    await rota.fulfill({ response: r, body: corpo });
  });
  const cargas = await contarCargas(page);
  await abrir(page);
  igual(cargas(), 2, 'uma recarga só');
  igual(await page.evaluate(() => sessionStorage.getItem('lynkz-recarregou-para')), '9.9.9', 'marcou a versão que causou a recarga');
  afirma((await page.locator('.versao').first().innerText()).includes(await page.evaluate(() => window.CONFIG.VERSAO)), 'abre na versão do config.js');
});

teste('lote S: versão que continua misturada não entra em loop de recarga', async ({ page }) => {
  await page.route('**/config.js*', async rota => {
    const r = await rota.fetch();
    await rota.fulfill({ response: r, body: (await r.text()).replace(/VERSAO: "[^"]+"/, 'VERSAO: "9.9.9"') });
  });
  const avisos = [];
  page.on('console', m => { if (m.type() === 'warning') avisos.push(m.text()); });
  const cargas = await contarCargas(page);
  await abrir(page);
  for (let i = 0; i < 50 && cargas() < 2; i++) await page.waitForTimeout(100);   // máquina lenta: espera a recarga
  await page.waitForTimeout(800);
  igual(cargas(), 2, 'recarregou uma vez e parou');
  afirma(avisos.some(a => /Versão misturada/.test(a)), 'registra no console');
});

teste('lote G: todo módulo de public/js tem modulepreload no index.html', async ({ page }) => {
  const index = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const listar = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? listar(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
  const modulos = listar(path.join(RAIZ, 'js')).map(f => path.relative(RAIZ, f).split(path.sep).join('/'));
  const faltam = modulos.filter(m => !index.includes(`<link rel="modulepreload" href="${m}">`));
  afirma(!faltam.length, 'sem modulepreload (acrescente no index.html): ' + faltam.join(', '));
  const sobram = [...index.matchAll(/modulepreload" href="([^"]+)"/g)].map(m => m[1]).filter(h => !modulos.includes(h));
  afirma(!sobram.length, 'modulepreload de arquivo que não existe: ' + sobram.join(', '));
  const url = fs.readFileSync(path.join(RAIZ, 'config.js'), 'utf8').match(/SUPABASE_URL:\s*"([^"]+)"/)[1];
  afirma(index.includes(`<link rel="preconnect" href="${url}" crossorigin>`), 'preconnect do Supabase igual ao config.js');
  await abrir(page);                       // e o app abre normalmente com os preloads
});

// ============================================================
//  v2.3 — LOTE Q: clientes do Qlik e histórico das planilhas
// ============================================================
teste('lote Q: empresa do Qlik mostra código e vendedor; busca pelo código e pelo nome fantasia', async ({ page }) => {
  await abrir(page, { rota: '#/gestao' });
  await page.fill('#gs-busca', '4821'); await page.waitForTimeout(400);
  const t = await page.locator('#gs-itens').innerText();
  afirma(/Casa do Criador/.test(t) && /Cód\. 4821/.test(t) && /Caxias \/ MA/.test(t), 'lista mostra código, cidade e UF');
  await page.fill('#gs-busca', 'agropet'); await page.waitForTimeout(400);
  igual(await page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count(), 1, 'busca pelo nome fantasia');
  await page.click('#gs-itens a[href="#/gestao/empresas/3"]');
  await page.locator('#conteudo', { hasText: 'Código do cliente' }).waitFor();
  const f = await page.locator('#conteudo').innerText();
  afirma(/Bia Souza/.test(f) && /vêm do Qlik/.test(f), 'ficha mostra vendedor e de onde vêm os dados');
});

teste('lote Q: diálogo trava nome, CNPJ e cidade do Qlik e salva telefone', async ({ page }) => {
  await abrir(page, { rota: '#/gestao/empresas/3' });
  await page.click('#fx-editar');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  for (const id of ['#de-nome', '#de-cnpj', '#de-cidade']) afirma(await d.locator(id).evaluate(i => i.readOnly), `${id} só leitura`);
  afirma(await d.locator('#de-telefone').evaluate(i => i === document.activeElement), 'foco vai para o telefone');
  await d.locator('#de-telefone').fill('99981112222');
  await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  const e = (await db(page)).empresas.find(x => x.id === 3);
  igual(e.telefone, '99981112222', 'telefone gravado');
  igual(e.nome, 'Casa do Criador', 'nome continua o do Qlik');
});

teste('lote Q: Nova campanha acha a empresa pelo código do cliente', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  igual(await page.inputValue('#n-empresa'), 'Casa do Criador', 'empresa escolhida pelo código');
});

teste('lote Q: campanha importada tem selo, origem e serve de modelo', async ({ page }) => {
  await abrir(page, { rota: '#/historico' });
  afirma(/importada/.test(await page.locator('#hs-itens').innerText()), 'histórico marca a importada');
  const c = (await db(page)).campanhas.find(x => x.importada);
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/${c.id}`);
  await page.locator('.det-selos', { hasText: 'Importada' }).waitFor();
  afirma(/Planilha antiga/.test(await page.locator('#conteudo').innerText()), 'origem: planilha antiga');
  await page.click('[data-modelo]');
  await page.waitForFunction(() => location.hash.startsWith('#/nova/de/'));
  igual(await page.inputValue('#n-empresa'), 'Casa do Criador', 'modelo traz a empresa');
  igual(await page.inputValue('#n-campanha'), 'Campanha WellPet', 'modelo traz o nome');
});

teste('lote Q: com 1.500 clientes do Qlik, lê tudo (acima de 1.000) e desenha aos poucos', async ({ page }) => {
  const t0 = Date.now();
  await abrir(page, { rota: '#/gestao', extra: '&muitas=1500' });
  igual(await page.locator('#gs-resumo').innerText(), '1.503 empresas', 'leu as 1.503 ativas (não parou em 1.000)');
  igual(await page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count(), 60, 'desenha 60 de cada vez');
  await page.click('#gs-mais');
  igual(await page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count(), 360, 'Mostrar mais acrescenta');
  await page.fill('#gs-busca', '1499'); await page.waitForTimeout(400);
  igual(await page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count(), 1, 'busca no meio das 1.503');
  await page.goto(`${BASE}/?papel=aprovador&muitas=1500#/nova`);
  await page.waitForSelector('#n-empresa');
  await escolherNoCombo(page, '#n-empresa', 'cliente qlik 1500', 'CLIENTE QLIK 1500 LTDA');
  relatorio.volume = { empresas: 1503, ms: Date.now() - t0 };
});

// ============================================================
//  v2.4 — LOTE R: compras no Qlik e notas fiscais da campanha
// ============================================================
async function prepararCompras(page, { termo = '4821', empresa = 'Casa do Criador' } = {}) {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', termo, empresa);
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31');
  await page.dispatchEvent('#n-fim', 'change');
}
// Troca o código de cliente da Casa do Criador no banco simulado e recarrega (4820 = sem notas, 9999 = Qlik com erro).
async function trocarCodigo(page, codigo) {
  await page.evaluate(c => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    d.empresas.find(e => e.id === 3).codigo_cliente = c;
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  }, codigo);
  await page.goto(`${BASE}/?papel=aprovador#/nova`);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#n-empresa');
  await escolherNoCombo(page, '#n-empresa', 'casa do criador', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31');
  await page.dispatchEvent('#n-fim', 'change');
}

teste('lote R: cliente + laboratório + período mostram o que comprou e as notas; a soma acompanha a marcação', async ({ page }) => {
  await prepararCompras(page);
  await page.locator('.compras-total').waitFor();
  const t = await page.locator('#compras-corpo').innerText();
  afirma(/R\$\s*1\.600,49/.test(t) && /OURO FINO SAUDE ANIMAL/.test(t) && /01\/10\/2026 a 31\/10\/2026/.test(t), 'total, fornecedor e período na frase');
  igual(await page.locator('input[data-nota]').count(), 3, 'três notas listadas');
  igual(await page.locator('#notas-soma').innerText(), 'Nenhuma nota marcada.', 'começa sem nenhuma marcada');
  await page.check('input[data-nota="0"]'); await page.check('input[data-nota="1"]');
  afirma(/2 notas marcadas · R\$\s*1\.500,50/.test(await page.locator('#notas-soma').innerText()), 'soma das duas marcadas');
  await page.click('#notas-todas');
  afirma(/3 notas marcadas/.test(await page.locator('#notas-soma').innerText()), 'marcar todas');
  await page.click('#notas-nenhuma');
  igual(await page.locator('input[data-nota]:checked').count(), 0, 'limpar desmarca');
});

teste('lote R: empresa sem código do Qlik e "Recurso próprio" não consultam nada', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('#compras-corpo', { hasText: 'não tem código de cliente do Qlik' }).waitFor();
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  // Ouro Fino + Recurso próprio: consulta só a Ouro Fino e avisa que o Recurso próprio fica fora.
  await escolherNoCombo(page, '#n-laboratorio', 'recurso', 'Recurso próprio');
  await page.locator('#compras-corpo', { hasText: 'Recurso próprio não entra na consulta' }).waitFor();
  await page.click('[data-tirar-lab="Ouro Fino"]');
  await page.locator('#compras-corpo', { hasText: 'não está no Qlik' }).waitFor();
});

teste('v2.12: Nova com dois laboratórios — consulta os dois juntos, grava "A, B" e o filtro acha por qualquer um', async ({ page }) => {
  const pedidos = [];
  page.on('request', r => { if (r.url().includes('/api/qlik/compras')) pedidos.push(JSON.parse(r.postData() || '{}')); });
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Ouro Fino","Avert"]', 'os dois escolhidos, na ordem');
  igual(await page.inputValue('#n-laboratorio'), '', 'campo livre para o próximo');
  // Quem já foi escolhido some da lista.
  await page.fill('#n-laboratorio', ''); await page.type('#n-laboratorio', 'ouro', { delay: 15 });
  igual(await page.locator('#n-laboratorio ~ .combo-lista [role=option]', { hasText: 'Ouro Fino' }).count(), 0, 'Ouro Fino não aparece de novo');
  await page.keyboard.press('Escape');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('#compras-corpo .compras-total').waitFor();
  const ultimo = pedidos[pedidos.length - 1];
  igual(JSON.stringify(ultimo.fornecedor_padrao), '["OURO FINO*","*Avert*"]', 'o Qlik recebe os dois laboratórios');
  afirma((await page.locator('#compras-corpo').innerText()).includes('somando os fornecedores escolhidos'), 'avisa que é a soma');
  // Tirar e pôr de novo: a consulta segue a lista.
  await page.click('[data-tirar-lab="Avert"]');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Ouro Fino"]', 'tirou o Avert');
  for (let i = 0; i < 40 && typeof pedidos[pedidos.length - 1].fornecedor_padrao !== 'string'; i++) await page.waitForTimeout(100);
  igual(pedidos[pedidos.length - 1].fornecedor_padrao, 'OURO FINO*', 'com um só, o pedido volta ao formato antigo');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-campanha', 'Dois laboratórios');
  await page.locator('[data-enviar]:visible').first().click();
  await page.locator('dialog.dialogo button', { hasText: 'Enviar assim' }).click();   // sem meta: o app avisa
  await page.waitForFunction(() => /^#\/campanhas\/\d+/.test(location.hash));
  const d = await db(page);
  const c = d.campanhas.find(x => x.campanha === 'Dois laboratórios');
  igual(c.laboratorio, 'Ouro Fino, Avert', 'grava os dois na campanha');
  afirma((await page.locator('.det-sub').first().innerText()).includes('Ouro Fino, Avert'), 'detalhe mostra os dois');
  await page.goto(`${BASE}/#/campanhas`);
  await page.selectOption('#cp-lab', 'Avert');
  await page.locator('#cp-itens .cartao', { hasText: 'Dois laboratórios' }).waitFor();
  igual(await page.locator('#cp-lab option[value="Ouro Fino, Avert"]').count(), 0, 'o filtro lista cada laboratório, não a dupla');
});

teste('lote R: cliente sem compras no período avisa', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4820');
  await page.locator('#compras-corpo', { hasText: 'de outros fornecedores' }).waitFor();   // comprou R$ 850 de outros
  const t = await page.locator('#compras-corpo').innerText();
  afirma(/R\$\s?850,00/.test(t) && /nada de Ouro Fino/.test(t), 'diz quanto comprou de outros e que nada deste laboratório');
  afirma(!/LABORATORIO_QLIK|config\.js| de o /.test(t), 'sem texto técnico nem "de o laboratório"');
});

teste('lote R: Qlik sem nenhuma compra do cliente avisa para chamar o TI', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4800');
  await page.locator('#compras-corpo .nota-alerta', { hasText: 'de nenhum fornecedor' }).waitFor();
  afirma(/avise o TI/.test(await page.locator('#compras-corpo').innerText()), 'orienta o que fazer');
});

teste('lote R: erro do Qlik oferece tentar de novo e não trava o envio da campanha', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '9999');
  await page.locator('#compras-tentar').waitFor();
  afirma(/Não foi possível consultar o Qlik/.test(await page.locator('#compras-corpo').innerText()), 'mensagem do erro');
  await page.fill('#n-campanha', 'Sem Qlik'); await page.fill('#n-inv-lynkz', '100'); await page.fill('#n-meta', '5.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const c = (await db(page)).campanhas.at(-1);
  igual(c.campanha, 'Sem Qlik', 'campanha enviada mesmo com o Qlik fora'); igual(c.compras_consultado_em, null, 'sem consulta registrada');
});

teste('lote R: enviar grava o total consultado e só as notas marcadas; o detalhe mostra', async ({ page }) => {
  await prepararCompras(page);
  await page.locator('input[data-nota]').first().waitFor();
  await page.check('input[data-nota="0"]'); await page.check('input[data-nota="2"]');
  await page.fill('#n-campanha', 'Com notas'); await page.fill('#n-inv-lynkz', '200'); await page.fill('#n-meta', '8.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const c = d.campanhas.at(-1);
  igual(c.compras_periodo, 1600.49, 'total consultado gravado'); afirma(!!c.compras_consultado_em, 'data da consulta gravada');
  const notas = d.campanha_notas.filter(n => n.campanha_id === c.id);
  igual(notas.map(n => n.numero).sort().join(','), '209001,211500', 'só as duas marcadas');
  igual(notas.find(n => n.numero === '211500').serie, '2', 'série gravada');
  await page.locator('#det-notas', { hasText: 'NF 209001' }).waitFor();
  const painel = await page.locator('#det-notas').innerText();
  afirma(/1\.600,49/.test(painel) && /NF 211500 · série 2/.test(painel) && /2 notas na campanha/.test(painel), 'detalhe lista as notas e o total');
});

teste('lote R: com 12 notas mostra 5, "Ver todas" abre as 12 e "Marcar todas" soma as 12 (Nova e detalhe)', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4812');
  await page.locator('#notas-ver').waitFor();
  igual(await page.locator('input[data-nota]:visible').count(), 5, '5 notas aparecem');
  igual((await page.locator('#notas-ver').innerText()).trim(), 'Ver todas as 12 notas', 'botão diz quantas são');
  await page.click('#notas-todas');
  afirma(/12 notas marcadas · R\$\s?1\.266,00/.test(await page.locator('#notas-soma').innerText()), 'marcar todas soma as 12, inclusive as recolhidas');
  igual(await page.locator('input[data-nota]:visible').count(), 5, 'marcar não abre a lista');
  await page.click('#notas-ver');
  igual(await page.locator('input[data-nota]:visible').count(), 12, '"Ver todas" mostra as 12');
  igual(await page.locator('#notas-ver').getAttribute('aria-expanded'), 'true', 'aria-expanded acompanha');
  await page.fill('#n-campanha', 'Doze notas'); await page.fill('#n-inv-lynkz', '200'); await page.fill('#n-meta', '8.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  await page.locator('#det-notas [data-ver-notas]').waitFor();
  igual(await page.locator('#det-notas .nota-linha:not(.nota-total):visible').count(), 5, 'detalhe mostra 5');
  afirma(/12 notas na campanha/.test(await page.locator('#det-notas').innerText()), 'a linha da soma fica visível');
  await page.click('#det-notas [data-ver-notas]');
  igual(await page.locator('#det-notas .nota-linha:not(.nota-total):visible').count(), 12, 'detalhe abre as 12');
});

// devolução no período. A nota de provável devolução fica riscada, fora da soma e sem marcar;
// a linha "Devoluções no período" fecha a conta: soma das notas − devoluções = total.
teste('lote R: devolução que fecha com uma nota — nota riscada, fora da soma; o detalhe mostra igual', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4817');
  await page.locator('#compras-devolucoes').waitFor();
  const corpo = await page.locator('#compras-corpo').innerText();
  afirma(/comprou R\$\s?1\.300,49/.test(corpo), 'total já líquido: ' + corpo);
  afirma(/Devoluções no período: −R\$\s?300,00 \(1 nota\)/.test(corpo), 'linha de devoluções: ' + corpo);
  const riscada = page.locator('.pessoa.nota-devolvida');
  igual(await riscada.count(), 1, 'uma nota riscada');
  afirma(/NF 209001/.test(await riscada.innerText()) && /Provável devolução/.test(await riscada.innerText()), 'é a NF 209001, com o selo');
  afirma(await riscada.locator('input').isDisabled(), 'sem poder marcar');
  igual(await page.locator('input[data-nota]').count(), 3, 'nenhuma nota sai da lista');
  await page.click('#notas-todas');
  afirma(/2 notas marcadas · R\$\s?1\.300,49/.test(await page.locator('#notas-soma').innerText()), '"Marcar todas" deixa a riscada de fora: soma = total');
  await page.fill('#n-campanha', 'Com devolução'); await page.fill('#n-inv-lynkz', '200'); await page.fill('#n-meta', '8.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const c = d.campanhas.at(-1);
  igual(c.compras_periodo, 1300.49, 'total gravado'); igual(c.compras_devolucoes, 300, 'devoluções gravadas');
  igual((c.compras_devolvidas || []).map(n => n.numero).join(','), '209001', 'nota de provável devolução gravada');
  igual(d.campanha_notas.filter(n => n.campanha_id === c.id).map(n => n.numero).sort().join(','), '210818,211500', 'só as marcadas em campanha_notas');
  await page.locator('#det-notas .nota-devolvida').waitFor();
  const painel = await page.locator('#det-notas').innerText();
  afirma(/Devoluções no período\s*−R\$\s?300,00 \(1 nota\)/.test(painel), 'detalhe mostra a linha: ' + painel);
  afirma(/NF 209001/.test(await page.locator('#det-notas .nota-devolvida').innerText()) && /Provável devolução/.test(painel), 'detalhe mostra a nota riscada');
  afirma(/2 notas na campanha/.test(painel) && /1\.300,49/.test(painel), 'a riscada não entra na soma do detalhe');
});

teste('lote R: devolução sem nota que feche — linha aparece, nenhuma riscada; a conta fecha', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4818');
  await page.locator('#compras-devolucoes').waitFor();
  const corpo = await page.locator('#compras-corpo').innerText();
  afirma(/comprou R\$\s?1\.550,49/.test(corpo), 'total já líquido');
  afirma(/Devoluções no período: −R\$\s?50,00 \(nota de origem não identificada no Qlik\)/.test(corpo), 'linha sem nota: ' + corpo);
  igual(await page.locator('.nota-devolvida').count(), 0, 'nenhuma nota riscada');
  await page.click('#notas-todas');
  afirma(/3 notas marcadas · R\$\s?1\.600,49/.test(await page.locator('#notas-soma').innerText()), 'soma das notas (1.600,49) − devoluções (50) = total (1.550,49)');
  await page.fill('#n-campanha', 'Devolução sem nota'); await page.fill('#n-meta', '8.000');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const c = (await db(page)).campanhas.at(-1);
  igual(c.compras_devolucoes, 50, 'devoluções gravadas'); igual((c.compras_devolvidas || []).length, 0, 'sem nota riscada');
  await page.locator('#det-notas', { hasText: 'Devoluções no período' }).waitFor();
  afirma(/nota de origem não identificada/.test(await page.locator('#det-notas').innerText()), 'detalhe explica');
});

teste('lote R: mudar o período consulta de novo e zera a marcação', async ({ page }) => {
  await prepararCompras(page);
  await page.locator('input[data-nota]').first().waitFor();
  await page.check('input[data-nota="0"]');
  await page.fill('#n-fim', '2026-11-15'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('.compras-total', { hasText: '15/11/2026' }).waitFor();
  igual(await page.locator('input[data-nota]:checked').count(), 0, 'marcação vem zerada na nova consulta');
});

const chipMarca = (page, nome) => page.locator(`[data-marca="${nome}"]`);
teste('lote R: marcas são opcionais, uma ou várias filtram total e notas, são gravadas e zeram ao trocar o período', async ({ page }) => {
  const pedidos = [];
  page.on('request', r => { if (r.url().includes('/api/qlik/compras')) pedidos.push(JSON.parse(r.postData() || '{}')); });
  await prepararCompras(page);
  await chipMarca(page, 'WELLPET').waitFor();
  const chips = await page.locator('[data-marca]').allInnerTexts();
  afirma(/WELLPET\s*R\$\s*1\.200,50/.test(chips[0]) && /PROTEÇÃO\s*R\$\s*399,99/.test(chips[1]), 'marcas com o valor comprado, da maior para a menor: ' + chips.join(' | '));
  igual(await page.locator('[data-marca][aria-pressed="true"]').count(), 0, 'começa sem marca (todas)');
  igual(await page.locator('input[data-nota]').count(), 3, 'sem marca: três notas');

  // Uma marca
  await chipMarca(page, 'WELLPET').click();
  await page.locator('.compras-total', { hasText: 'marca WELLPET' }).waitFor();
  afirma(/R\$\s*1\.200,50/.test(await page.locator('.compras-total').innerText()), 'total só da marca');
  igual(await page.locator('input[data-nota]').count(), 1, 'só a nota da marca');
  igual(await chipMarca(page, 'WELLPET').getAttribute('aria-pressed'), 'true', 'a marca fica marcada');
  igual(await page.locator('[data-marca]').count(), 2, 'a lista de marcas continua completa');
  igual(await page.evaluate(() => document.activeElement?.dataset.marca), 'WELLPET', 'o foco volta ao botão da marca');
  igual(pedidos.at(-1).marca, 'WELLPET', 'uma marca vai como texto');

  // Duas marcas
  await chipMarca(page, 'PROTEÇÃO').click();
  await page.locator('.compras-total', { hasText: 'marcas WELLPET e PROTEÇÃO' }).waitFor();
  igual(JSON.stringify(pedidos.at(-1).marca), '["WELLPET","PROTEÇÃO"]', 'duas marcas vão como lista');
  igual(await page.locator('input[data-nota]').count(), 3, 'notas das duas marcas');
  afirma(/R\$\s*1\.600,49/.test(await page.locator('.compras-total').innerText()), 'total das duas marcas');

  await page.check('input[data-nota="1"]');
  await page.fill('#n-campanha', 'WellPet e Proteção outubro'); await page.fill('#n-inv-lynkz', '100'); await page.fill('#n-meta', '5.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const c = d.campanhas.at(-1);
  igual(c.compras_marca, 'WELLPET; PROTEÇÃO', 'as duas marcas gravadas'); igual(c.compras_periodo, 1600.49, 'total das marcas gravado');
  await page.locator('#det-notas', { hasText: 'marcas WELLPET e PROTEÇÃO' }).waitFor();

  // "Ver todas as marcas" desmarca; trocar o período zera as marcas.
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31'); await page.dispatchEvent('#n-fim', 'change');
  await chipMarca(page, 'PROTEÇÃO').click();
  await page.locator('.compras-total', { hasText: 'marca PROTEÇÃO' }).waitFor();
  await page.click('[data-marcas-todas]');
  await page.locator('.compras-total', { hasNotText: 'marca' }).waitFor();
  igual(await page.locator('[data-marca][aria-pressed="true"]').count(), 0, '"Ver todas as marcas" desmarca');
  await chipMarca(page, 'PROTEÇÃO').click();
  await page.locator('.compras-total', { hasText: 'marca PROTEÇÃO' }).waitFor();
  await page.fill('#n-fim', '2026-11-15'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('.compras-total', { hasText: '15/11/2026' }).waitFor();
  igual(await page.locator('[data-marca][aria-pressed="true"]').count(), 0, 'mudar o período volta para todas as marcas');
});

teste('v2.14: várias marcas com vários fornecedores; detalhe confere no Qlik com as mesmas marcas', async ({ page }) => {
  const pedidos = [];
  page.on('request', r => { if (r.url().includes('/api/qlik/compras')) pedidos.push(JSON.parse(r.postData() || '{}')); });
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31'); await page.dispatchEvent('#n-fim', 'change');
  await chipMarca(page, 'WELLPET').click();
  await page.locator('.compras-total', { hasText: 'marca WELLPET' }).waitFor();
  await chipMarca(page, 'PROTEÇÃO').click();
  await page.locator('.compras-total', { hasText: 'marcas WELLPET e PROTEÇÃO' }).waitFor();
  const ult = pedidos.at(-1);
  igual(JSON.stringify(ult.fornecedor_padrao), '["OURO FINO*","*Avert*"]', 'os dois fornecedores');
  igual(JSON.stringify(ult.marca), '["WELLPET","PROTEÇÃO"]', 'as duas marcas');
  const vio = (await axe(page, 'Nova marcas')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade das marcas: ' + JSON.stringify(vio));
  await page.fill('#n-campanha', 'Duas marcas, dois fornecedores'); await page.fill('#n-meta', '5000');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const id = await page.evaluate(() => +location.hash.match(/\d+$/)[0]);
  // Aprovador confere no Qlik: mesmas marcas e fornecedores.
  await page.goto(`${BASE}/?papel=aprovador#/campanhas/${id}`); await page.reload();
  await page.locator('[data-conferir-qlik]').click();
  await page.locator('#det-notas .nota', { hasText: 'Qlik agora' }).waitFor();
  igual(JSON.stringify(pedidos.at(-1).marca), '["WELLPET","PROTEÇÃO"]', 'conferência usa as marcas gravadas');
  afirma((await page.locator('#det-notas').innerText()).includes('marcas WELLPET e PROTEÇÃO'), 'detalhe mostra as marcas');
});

// ============================================================
//  v2.1 — telas novas no modo escuro: legíveis e sem problema grave de acessibilidade
// ============================================================
for (const largura of [390, 1440]) {
  teste(`escuro ${largura}px: manutenção, faixa de erro e diálogo de senha passam no axe`, async ({ page }) => {
    const graves = (v, onde) => v.filter(x => ['critical', 'serious'].includes(x.impacto)).map(x => `${x.id} em ${onde}: ${x.alvos.join(' | ')}`);
    const problemas = [];
    await page.goto(`${BASE}/?papel=aprovador&zerar=1&sem=campanhas_app,empresas,balconistas#/inicio`);
    await page.locator('.manutencao-caixa').waitFor();
    await page.locator('.manutencao-detalhes summary').click();
    problemas.push(...graves(await axe(page, `escuro-manutencao-${largura}`), 'manutenção'));
    await page.screenshot({ path: path.join(SAIDA, `escuro-manutencao-${largura}.png`) });

    await page.goto(`${BASE}/?papel=aprovador&zerar=1&falhar=campanhas_app#/campanhas`);
    await page.locator('#faixa-erro:not([hidden])').waitFor();
    problemas.push(...graves(await axe(page, `escuro-faixa-erro-${largura}`), 'faixa de erro'));
    await page.screenshot({ path: path.join(SAIDA, `escuro-faixa-erro-${largura}.png`) });

    await abrir(page, { rota: '#/perfil' });
    await page.click('#pf-senha');
    await page.locator('dialog.dialogo').waitFor();
    await page.fill('#pf-nova', 'abc12345');
    problemas.push(...graves(await axe(page, `escuro-senha-${largura}`), 'diálogo de senha'));
    await page.screenshot({ path: path.join(SAIDA, `escuro-senha-${largura}.png`) });
    afirma(!problemas.length, problemas.join('\n      '));
  }, { largura, altura: largura === 390 ? 844 : 900, escuro: true });
}

// ============================================================
//  10. TODAS AS TELAS × TAMANHOS: sem rolagem lateral, acessibilidade, capturas
// ============================================================
const TELAS = ['#/inicio', '#/campanhas', '#/campanhas/2', '#/nova', '#/historico', '#/gestao', '#/gestao/empresas/2', '#/perfil', '#/usuarios', '#/comissoes', '#/comissoes?aba=premiacoes', '#/comissoes?aba=contrato', '#/comissoes?aba=cadastro', '#/comissoes?aba=parametros', '#/comissoes?aba=historico'];
for (const [largura, altura] of [[360, 740], [390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
  teste(`telas ${largura}px: sem rolagem lateral${[390, 1440].includes(largura) ? ', acessibilidade e capturas' : ''}`, async ({ page }) => {
    const problemas = [];
    for (const rota of TELAS) {
      await abrir(page, { rota });
      if (rota === '#/nova' && largura < 900) {
        // no celular a Nova tem passos; vai até o 3, onde aparece "Quem recebe" (Swile).
        await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz');
        await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
        await page.fill('#n-campanha', 'Captura');
        await page.click('[data-passo-continuar]');
        await page.selectOption('#n-pagamento', 'Swile'); await page.fill('#n-inv-lynkz', '100');
        await page.click('[data-passo-continuar]');
        await page.locator('#passo-atual', { hasText: '3 de 3' }).waitFor();
      } else if (rota === '#/nova') { await page.selectOption('#n-pagamento', 'Swile'); await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz'); await page.click('#n-campanha'); }
      await page.waitForTimeout(250);
      const nome = `${rota.replace(/[#/?=&]+/g, '-').replace(/^-/, '')}-${largura}`;
      if (!(await semOverflow(page, nome))) problemas.push('rolagem lateral em ' + nome);
      if ([390, 1440].includes(largura)) {
        await page.screenshot({ path: path.join(SAIDA, nome + '.png'), fullPage: true });
        const v = await axe(page, nome);
        v.filter(x => ['critical', 'serious'].includes(x.impacto)).forEach(x => problemas.push(`axe ${x.impacto} ${x.id} em ${nome}: ${x.alvos.join(' | ')}`));
      }
    }
    if ([390, 1440].includes(largura)) {
      await deslogado(page);
      await page.screenshot({ path: path.join(SAIDA, `login-${largura}.png`) });
      (await axe(page, 'login-' + largura)).filter(x => ['critical', 'serious'].includes(x.impacto)).forEach(x => problemas.push(`axe ${x.impacto} ${x.id} no login`));
      await abrir(page, { rota: '#/campanhas/3' }); await page.click('[data-reprovar]'); await page.locator('dialog.dialogo').waitFor();
      (await axe(page, 'dialogo-' + largura)).filter(x => ['critical', 'serious'].includes(x.impacto)).forEach(x => problemas.push(`axe ${x.impacto} ${x.id} no diálogo`));
      await page.screenshot({ path: path.join(SAIDA, `dialogo-reprovar-${largura}.png`) });
    }
    afirma(!problemas.length, problemas.join('\n      '));
  }, { largura, altura });
}

// ============================================================
//  v2.7 — limites, envio tudo-ou-nada, combo, busca por CNPJ, títulos, alinhamento
// ============================================================
teste('v2.7: rebate acima de 100% marca o campo sem ir ao banco; base e gatilho são obrigatórios com rebate', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  const antes = (await db(page)).campanhas.length;
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-campanha', 'Rebate demais');
  await page.click('label[for="n-rebate"]');
  await page.fill('#n-meta', '40000'); await page.fill('#n-rebate-pct', '150');
  await page.locator('[data-enviar]:visible').first().click();
  afirma((await erroDo(page, 'n-rebate-pct').innerText()).includes('0 a 100%'), 'erro no campo % de rebate');
  afirma(await erroDo(page, 'n-rebate-base').isVisible(), 'pede a base de cálculo');
  afirma(await erroDo(page, 'n-rebate-gatilho').isVisible(), 'pede quando o rebate é devido');
  igual((await db(page)).campanhas.length, antes, 'nada foi gravado');
  await page.fill('#n-meta', '2000000000');
  await page.locator('[data-enviar]:visible').first().click();
  afirma((await erroDo(page, 'n-meta').innerText()).includes('limite'), 'meta acima de R$ 1 bilhão');
});

teste('v2.7: enviar é tudo ou nada — campanha recusada não deixa balconista novo nem notas', async ({ page }) => {
  await abrir(page, { rota: '#/nova', papel: 'coordenador' });
  const r = await page.evaluate(async () => {
    const { campanhas } = await import('/js/dados/campanhas.js');
    try {
      await campanhas.enviar({
        campanha: { cliente: 'x', empresa_id: 3, laboratorio: 'Avert', campanha: 'Recusada pelo banco', rebate_pct: 150 },
        balconista: { empresa_id: 3, nome_completo: 'Fulano de Tal', cpf: '12345678909', data_nascimento: '1990-01-01', email: 'f@x.com', telefone: '98912345678' },
        notas: [{ numero: '1', serie: '1', data: '2026-10-01', valor: 10 }],
      });
      return 'enviou';
    } catch (e) { return e.message; }
  });
  afirma(/passou do limite/i.test(r), 'erro de limite em português: ' + r);
  const d = await db(page);
  afirma(!d.balconistas.some(b => b.cpf === '12345678909'), 'balconista não ficou cadastrado');
  afirma(!d.campanhas.some(c => c.campanha === 'Recusada pelo banco'), 'campanha não existe');
  igual(d.campanha_notas.length, 0, 'nenhuma nota gravada');
});

teste('v2.7: com empresa escolhida, a lista não abre sozinha ao voltar o foco', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await page.focus('#n-campanha');
  await page.focus('#n-empresa');
  afirma(await page.locator('#n-empresa ~ .combo-lista').isHidden(), 'lista continua fechada');
  await page.click('#n-empresa');
  afirma(await page.locator('#n-empresa ~ .combo-lista').isVisible(), 'abre no clique');
});

teste('v2.7: busca de empresa acha o CNPJ com e sem pontuação (Gestão e Nova)', async ({ page }) => {
  await abrir(page, { rota: '#/gestao' });
  const linhas = () => page.locator('#gs-itens a[href^="#/gestao/empresas/"]').count();
  for (const termo of ['12.345.678/0001-95', '12345678000195']) {
    await page.fill('#gs-busca', termo); await page.waitForTimeout(400);
    igual(await linhas(), 1, `Gestão acha ${termo}`);
  }
  await page.goto(`${BASE}/?papel=aprovador#/nova`);
  await page.waitForSelector('#n-empresa');
  await page.click('#n-empresa'); await page.keyboard.type('12.345.678/0001-95', { delay: 10 });
  afirma(await page.locator('#n-empresa ~ .combo-lista [role=option]', { hasText: 'Agropecuária São Luís' }).count() === 1, 'Nova acha pelo CNPJ formatado');
});

teste('v2.7: título da aba usa a marca e o topo não mostra "Início" ao abrir direto na Nova', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  igual(await page.title(), 'Campanhas · LYNKZ', 'título da aba');
  await abrir(page, { rota: '#/nova' });
  igual(await titulo(page), 'Nova campanha', 'topo da Nova');
});

for (const largura of [390, 1440]) {
  teste(`v2.7: Início e Fim ficam na mesma linha mesmo com erro só no Fim (${largura}px)`, async ({ page }) => {
    await abrir(page, { rota: '#/nova' });
    await page.fill('#n-inicio', '2026-12-10'); await page.fill('#n-fim', '2026-12-01'); await page.locator('#n-fim').dispatchEvent('change');
    await erroDo(page, 'n-fim').waitFor();
    const a = await page.locator('#n-inicio').boundingBox(), b = await page.locator('#n-fim').boundingBox();
    afirma(Math.abs(a.y - b.y) < 1, `campos alinhados: ${a.y} x ${b.y}`);
  }, { largura, altura: 900 });
}

// no celular a Nova tem 3 passos; no computador continua uma página só.
teste('v2.9: Nova em 3 passos no celular — erro no passo 1, Voltar mantém os dados, envio igual', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  const altura = async () => page.evaluate(() => document.documentElement.scrollHeight / innerHeight);
  const alturas = [];
  igual((await page.locator('#passo-atual').innerText()).trim(), '1 de 3 · Cliente', 'começa no passo 1');
  afirma(!(await page.locator('#n-inv-lynkz').isVisible()), 'valores ficam no passo 2');
  igual(await page.locator('[data-enviar]:visible').count(), 0, 'sem "Enviar" antes do passo 3');
  afirma(await page.locator('[data-acrescentar="n-mecanica"]').isVisible() && !(await page.locator('#n-mecanica').isVisible()), '"Como funciona" recolhido');
  await page.click('[data-passo-continuar]');
  await erroDo(page, 'n-empresa').waitFor();
  igual((await page.locator('#passo-atual').innerText()).trim(), '1 de 3 · Cliente', 'erro segura no passo 1');
  afirma(!(await erroDo(page, 'n-inv-lynkz').isVisible()), 'só valida os campos do passo');
  await escolherNoCombo(page, '#n-empresa', 'casa do criador', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-campanha', 'Passos 390');
  await page.click('[data-periodo="este"]');
  alturas.push(await altura());
  await page.screenshot({ path: path.join(SAIDA, 'nova-passo1-390.png'), fullPage: true });
  await page.click('[data-passo-continuar]');
  igual((await page.locator('#passo-atual').innerText()).trim(), '2 de 3 · Valores', 'passo 2');
  afirma(!(await page.locator('#n-campanha').isVisible()), 'passo 1 escondido');
  await page.fill('#n-inv-lynkz', '200'); await page.fill('#n-meta', '8.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('input[data-nota]').first().waitFor();
  alturas.push(await altura());
  await page.screenshot({ path: path.join(SAIDA, 'nova-passo2-390.png'), fullPage: true });
  await page.click('[data-passo-voltar]');
  igual(await page.inputValue('#n-campanha'), 'Passos 390', 'Voltar mantém os dados');
  await page.click('[data-passo-continuar]'); await page.click('[data-passo-continuar]');
  igual((await page.locator('#passo-atual').innerText()).trim(), '3 de 3 · Revisão', 'passo 3');
  const resumo = await page.locator('#resumo-passos').innerText();
  afirma(/Casa do Criador/.test(resumo) && /R\$\s?200,00/.test(resumo) && /2,5%/.test(resumo), 'revisão mostra empresa, custo e % da meta: ' + resumo);
  alturas.push(await altura());
  await page.screenshot({ path: path.join(SAIDA, 'nova-passo3-390.png'), fullPage: true });
  // Tolerância de 1,7 tela: no CI a fonte do Google é bloqueada e a substituta do Linux é mais alta
  // (passo 2: 1,65 tela no Linux, 1,57 no Windows). No celular, com a fonte de verdade, fica perto de 1,5.
  afirma(alturas.every(a => a <= 1.7), 'cada passo cabe em ~1,5 tela: ' + alturas.map(a => a.toFixed(2)).join(' / '));
  igual(await page.locator('[data-passo="1"]').first().evaluate(e => getComputedStyle(e).display), 'none', 'passo 1 escondido no 3');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const c = (await db(page)).campanhas.at(-1);
  igual(c.campanha, 'Passos 390', 'campanha gravada'); igual(c.investimento_lynkz, 200, 'valor do passo 2 gravado');
}, { largura: 390, altura: 844 });

teste('v2.9: com erro em outro passo, "Enviar" leva até ele; o passo fica no rascunho', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'casa do criador', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-campanha', 'Volta ao erro');
  await page.click('[data-passo-continuar]');
  await page.selectOption('#n-pagamento', 'Swile');   // exige investimento LYNKZ (passo 2) e quem recebe (passo 3)
  await page.click('[data-passo-continuar]');
  await erroDo(page, 'n-inv-lynkz').waitFor();
  await page.fill('#n-inv-lynkz', '100');
  await page.click('[data-passo-continuar]');
  igual((await page.locator('#passo-atual').innerText()).trim(), '3 de 3 · Revisão', 'chegou ao passo 3');
  await page.click('[data-ir-passo="2"]');
  await page.fill('#n-inv-lynkz', '');
  await page.click('[data-ir-passo="3"]');
  await page.locator('[data-enviar]:visible').first().click();
  await erroDo(page, 'n-inv-lynkz').waitFor();
  igual((await page.locator('#passo-atual').innerText()).trim(), '2 de 3 · Valores', 'Enviar voltou ao passo do primeiro erro');
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForSelector('#app:not([hidden])');
  await page.locator('#passo-atual', { hasText: '2 de 3' }).waitFor();
}, { largura: 390, altura: 844 });

// v2.9 (D1–D5): ajustes de celular.
teste('v2.9: D1 placeholders da busca não cortam e D2 filtros numa linha com o ativo à vista (360 px)', async ({ page }) => {
  // Largura do texto do placeholder (mesma fonte do campo) x espaço útil do campo.
  const cabe = sel => page.evaluate(s => {
    const i = document.querySelector(s); const cs = getComputedStyle(i);
    const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const util = i.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    return { texto: i.placeholder, largura: ctx.measureText(i.placeholder).width, util, descrito: !!document.getElementById(i.getAttribute('aria-describedby') || '-') };
  }, sel);
  for (const [rota, sel] of [['#/campanhas', '#cp-busca'], ['#/gestao', '#gs-busca'], ['#/historico', '#hs-busca']]) {
    await abrir(page, { rota });
    const r = await cabe(sel);
    afirma(r.largura <= r.util, `placeholder "${r.texto}" cabe: ${r.largura.toFixed(0)} de ${r.util.toFixed(0)} px`);
    afirma(r.descrito, `${sel}: a dica completa vai no aria-describedby`);
  }
  for (const [rota, grupo, alvo] of [['#/campanhas', '#cp-status', 'Todas'], ['#/historico', '#hs-status', 'Reprovada']]) {
    await abrir(page, { rota });
    await page.click(`${grupo} [data-status="${alvo}"]`);
    const r = await page.evaluate(g => {
      const caixa = document.querySelector(g), bs = [...caixa.querySelectorAll('.filtro')];
      const a = caixa.querySelector('[aria-pressed="true"]').getBoundingClientRect(), c = caixa.getBoundingClientRect();
      return { linhas: new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size, visivel: a.left >= c.left - 1 && a.right <= c.right + 1,
               pagina: document.documentElement.scrollWidth <= innerWidth };
    }, grupo);
    igual(r.linhas, 1, `${grupo}: uma linha só`);
    afirma(r.visivel, `${grupo}: filtro ativo à vista`);
    afirma(r.pagina, `${grupo}: sem rolagem lateral da página`);
  }
}, { largura: 360, altura: 740 });

teste('v2.9: D3 ficha sem número órfão e D4 histórico em cartões (390 px)', async ({ page }) => {
  await abrir(page, { rota: '#/gestao/empresas/1' });
  const topos = await page.$$eval('.numeros-3 .numero', ns => ns.map(n => Math.round(n.getBoundingClientRect().top)));
  igual(new Set(topos).size, 1, 'os 3 números na mesma linha');
  await abrir(page, { rota: '#/historico' });
  await page.locator('.hs-cartoes .cartao').first().waitFor();
  afirma(!(await page.locator('#hs-itens .tabela-caixa').isVisible()), 'tabela escondida no celular');
  const r = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('.hs-cartoes .cartao-com-acoes')];
    return { n: cs.length, media: cs.reduce((t, c) => t + c.getBoundingClientRect().height, 0) / cs.length, rodape: cs[0]?.querySelector('.cartao-acoes')?.innerText };
  });
  afirma(r.n > 0 && r.media < 220, `cartão compacto: ${r.media.toFixed(0)} px de altura média`);
  afirma(/(Aprovada|Reprovada) em \d{2}\/\d{2}\/\d{4} · /.test(r.rodape), 'rodapé com a data da decisão e quem decidiu: ' + r.rodape);
  await page.screenshot({ path: path.join(SAIDA, 'historico-390.png'), fullPage: false });
}, { largura: 390, altura: 844 });

teste('v2.9: D5 nenhum texto de conteúdo abaixo de 13 px (390 px)', async ({ page }) => {
  // 12 px só em selos, régua, contadores, botões pequenos, títulos de painel, cabeçalhos de tabela e atalhos.
  const PODE_12 = '.selo, .regua, .regua-legenda, .mini, .contador, .btn-pequeno, .painel-titulo, .tabela th, kbd, .atalho, .passo, .menu-marca, .acesso-marca, .bi-item, .campo-opcional, .campo-opc, .toast-acao, .manutencao-detalhes, .esqueleto';
  const pequenos = [];
  for (const rota of ['#/inicio', '#/campanhas', '#/campanhas/2', '#/nova', '#/historico', '#/gestao', '#/gestao/empresas/1', '#/perfil', '#/usuarios', '#/comissoes?aba=cadastro', '#/comissoes?aba=parametros']) {
    await abrir(page, { rota });
    pequenos.push(...(await page.evaluate(([r, pode]) => {
      const fora = [];
      for (const el of document.querySelectorAll('#conteudo *, #menu *')) {
        const proprio = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (!proprio || el.closest(pode) || !el.getClientRects().length) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 12.9) fora.push(`${r} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${el.textContent.trim().slice(0, 30)}" ${px}px`);
      }
      return fora;
    }, [rota, PODE_12])));
  }
  afirma(!pequenos.length, 'texto de conteúdo abaixo de 13 px:\n' + [...new Set(pequenos)].slice(0, 15).join('\n'));
}, { largura: 390, altura: 844 });

teste('v2.7: enviar sem período ou sem meta avisa; Voltar não envia, "Enviar assim" envia', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  const antes = (await db(page)).campanhas.length;
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-campanha', 'Sem período nem meta');
  await page.locator('[data-enviar]:visible').first().click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  afirma((await d.innerText()).includes('período e meta'), 'diálogo cita período e meta');
  await d.locator('button', { hasText: 'Voltar' }).click();
  await d.waitFor({ state: 'detached' });
  igual((await db(page)).campanhas.length, antes, 'Voltar não grava');
  await page.fill('#n-meta', '5000'); await page.fill('#n-inicio', '2026-12-01'); await page.fill('#n-fim', '2026-12-31');
  await page.locator('[data-enviar]:visible').first().click();     // completa: envia direto, sem aviso
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  igual((await db(page)).campanhas.length, antes + 1, 'com tudo preenchido envia sem perguntar');
});

teste('v2.7: depois de enviar, a campanha aparece na lista mesmo com filtro de laboratório de outro', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas?status=Todas', papel: 'coordenador' });
  await page.selectOption('#cp-lab', 'Premier');
  await page.evaluate(() => { location.hash = '#/nova'; });     // navegação interna: o filtro de laboratório continua guardado
  await page.waitForSelector('#n-empresa');
  await escolherNoCombo(page, '#n-empresa', 'casa do', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await page.fill('#n-campanha', 'Aparece na lista'); await page.fill('#n-meta', '5000');
  await page.fill('#n-inicio', '2026-12-01'); await page.fill('#n-fim', '2026-12-31');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  await page.locator('#cp-itens .cartao[aria-current="true"]').waitFor({ timeout: 5000 });
  afirma((await page.locator('#cp-itens .cartao[aria-current="true"]').innerText()).includes('Aparece na lista'), 'a campanha nova está selecionada na lista');
});

// ============================================================
//  v2.10 — ADP (autorização de pagamento das campanhas Swile)
// ============================================================
// Duas aprovadas com Swile em outubro: a 2 (balconista cadastrado, pedida pela Bia) e uma avulsa da Bia sem cadastro.
async function prepararAdp(page) {
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const c2 = d.campanhas.find(x => x.id === 2);
    Object.assign(c2, { status: 'Aprovada', aprovador_nome: 'Ana Aprovadora', data_decisao: '2026-11-03', data_inicio: '2026-10-01', data_fim: '2026-10-31', mecanica: 'R$ 3,00 por dose vendida' });
    const n = d.seq.campanhas + 1; d.seq.campanhas = n;
    d.campanhas.push({ ...c2, id: n, codigo: 'C2610' + n, cliente: 'Casa do Criador', empresa_id: 3, balconista_id: null, campanha: 'Prescrição Avert',
      tipo: null, mecanica: null, investimento_lynkz: 100, swile_nome_completo: 'Beatriz de Sousa Barros', swile_cpf: '52998224725', swile_email: 'bia.vet@exemplo.com', swile_data_nascimento: '1999-03-21' });
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  });
}

// CSP de produção (sem upgrade-insecure-requests, que no http do teste trocaria tudo por https).
async function comCspDeProducao(contexto) {
  const csp = fs.readFileSync(path.join(RAIZ, '_headers'), 'utf8').match(/Content-Security-Policy: (.+)/)[1].replace(/;?\s*upgrade-insecure-requests/, '');
  await contexto.route(u => u.origin === BASE && (u.pathname === '/' || u.pathname === '/index.html'), async r => {
    const resp = await r.fetch();
    await r.fulfill({ response: resp, headers: { ...resp.headers(), 'content-security-policy': csp } });
  });
}

// PDF gerado pelo pdf-lib: abre os streams (Flate). texto = os <hex> Tj (WinAnsi ≈ latin1);
// bruto = arquivo + streams abertos (os objetos ficam em object streams comprimidos).
function abrirPdf(bytes) {
  const bin = bytes.toString('latin1');
  const partes = [], abertos = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(bin))) {
    const ini = m.index + m[0].length, fim = bin.indexOf('endstream', ini);
    let s;
    try { s = zlib.inflateSync(Buffer.from(bin.slice(ini, fim), 'latin1')).toString('latin1'); } catch { continue; }
    abertos.push(s);
    for (const t of s.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) partes.push(Buffer.from(t[1], 'hex').toString('latin1'));
  }
  return { texto: partes.join('\n'), bruto: bin + abertos.join('\n') };
}
const paginasPdf = b => (b.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

teste('v2.10: ADP — aprovador edita e gera o PDF no modelo, com CSP de produção', async ({ page, contexto }) => {
  await comCspDeProducao(contexto);
  const csp = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await abrir(page, { rota: '#/inicio' });
  await prepararAdp(page);
  await page.goto(`${BASE}/?papel=aprovador#/campanhas`);
  await page.reload();
  await page.locator('#cp-adp').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  igual(await page.locator('#adp-mes').inputValue(), '2026-10', 'sugere o mês das campanhas');
  igual(await d.locator('.adp-item').count(), 2, 'as duas aprovadas com Swile de outubro');
  igual(await d.locator('.adp-bloqueado').count(), 0, 'aprovador vê os dados de quem recebe');
  afirma(/Gerar PDF \(2 · R\$\s?700,00\)/.test(await d.locator('[type=submit]').innerText()), 'botão com quantidade e total');
  const v = d.locator('#adp-v-0');
  await v.fill('150'); await v.blur();
  afirma(/Gerar PDF \(2 · R\$\s?750,00\)/.test(await d.locator('[type=submit]').innerText()), 'total acompanha o valor digitado');
  // Edição da linha 1: observação e nome; o resumo acompanha.
  await d.locator('[data-adp-editar="0"] summary').click();
  igual(await page.inputValue('#adp-nasc-0'), '1999-03-21', 'nascimento vem dos dados Swile da campanha');
  await page.fill('#adp-nasc-0', '');
  await page.fill('#adp-obs-0', 'R$ 10,00 por prescrição Avert, totalizando 15 prescrições');
  await page.fill('#adp-fav-0', 'Beatriz Sousa Barros');
  afirma((await d.locator('[data-adp-resumo="0"]').innerText()).includes('Beatriz Sousa Barros'), 'resumo segue o nome editado');
  // Vencimento: padrão de 7 dias úteis após hoje, editável, nunca antes da emissão.
  const padrao = await page.evaluate(async () => {
    const { somaDiasUteis, hojeCivil } = await import('/js/lib/regras.js');
    return somaDiasUteis(hojeCivil(), 7);
  });
  igual(await page.inputValue('#adp-venc'), padrao, 'vencimento padrão = 7 dias úteis');
  afirma((await page.locator('#adp-venc-dica').innerText()).includes('7 dias úteis'), 'dica explica a regra');
  await page.fill('#adp-venc', '2020-01-02');
  await d.locator('[type=submit]').click();
  afirma((await erroDo(page, 'adp-venc').innerText()).includes('antes da emissão'), 'vencimento no passado é recusado');
  afirma((await erroDo(page, 'adp-nasc-0').innerText()).includes('nascimento'), 'nascimento é obrigatório');
  await page.fill('#adp-venc', '2030-01-15');
  await page.fill('#adp-nasc-0', '1999-03-21');
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('[type=submit]').click()]);
  igual(dl.suggestedFilename(), 'ADP - CAMPANHAS - OUTUBRO 2026.pdf', 'nome do arquivo');
  await toastCom(page, 'ADP de outubro 2026 gerada');
  const arq = path.join(SAIDA, 'adp.pdf'); await dl.saveAs(arq);
  const bytes = fs.readFileSync(arq);
  afirma(bytes.slice(0, 5).toString() === '%PDF-', 'é PDF');
  const { texto: t, bruto } = abrirPdf(bytes);
  igual(paginasPdf(bruto), 1, 'uma página');
  igual((bruto.match(/\/Subtype\s*\/Image/g) || []).length, 2, 'as duas logos');
  for (const esperado of ['AUTORIZAÇÃO DE PAGAMENTO', 'OUTUBRO 2026', 'LYNKZ DIST S.A - MATRIZ', '15/01/2030', 'R$ 750,00', 'CASA DO CRIADOR',
    'PREMIAÇÃO CAMPANHA', 'R$ 10,00 por prescrição Avert, totalizando 15 prescrições', 'R$ 150,00', 'PET CENTER IMPERATRIZ', 'R$ 600,00',
    'Beatriz Sousa Barros', '529.982.247-25', '21/03/1999', 'bia.vet@exemplo.com', 'João Pedro Lima', '30/09/1988', 'NASCIMENTO',
    'ASSINATURA DO AUTORIZANTE DO PAGAMENTO', `Emitido em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}`]) {
    afirma(t.includes(esperado), 'PDF tem: ' + esperado);
  }
  afirma(!t.includes('VENC.'), 'sem a coluna de vencimento (já está na faixa de cima)');
  afirma(!/Elaborado por|Ana Aprovadora|Data:/.test(t), 'sem nomes nem campo de data: a identificação vem da assinatura');
  igual(await page.locator('#adp-autorizante').count(), 0, 'diálogo sem o campo de quem assina');
  const camp = await db(page);
  afirma(!camp.campanhas.some(c => c.swile_nome_completo === 'Beatriz Sousa Barros'), 'edição não grava na campanha');
  afirma(!csp.length, 'nada bloqueado pela CSP: ' + csp.join(' | '));
});

teste('v2.10: ADP — muitas campanhas viram mais páginas, com o cabeçalho da tabela repetido', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  await prepararAdp(page);
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const base = d.campanhas.find(x => x.id === 2);
    for (let k = 0; k < 28; k++) {
      const n = ++d.seq.campanhas;
      d.campanhas.push({ ...base, id: n, codigo: 'C2610X' + n, cliente: 'Cliente extra ' + String(k).padStart(2, '0'), investimento_lynkz: 10 });
    }
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  });
  await page.goto(`${BASE}/?papel=aprovador#/campanhas`);
  await page.reload();
  await page.locator('#cp-adp').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('[type=submit]').click()]);
  const bytes = fs.readFileSync(await dl.path());
  const { texto: t, bruto } = abrirPdf(bytes);
  const pags = paginasPdf(bruto);
  afirma(pags >= 2, 'mais de uma página: ' + pags);
  igual((t.match(/^CAMPANHAS$/gm) || []).length >= 1 && (t.match(/^OBSERVAÇÃO AO FISCAL/gm) || []).length >= 2, true, 'cabeçalho da tabela repetido na página seguinte');
  afirma(t.includes(`Página ${pags} de ${pags}`), 'numeração das páginas');
  afirma(t.includes('R$ 980,00'), 'total com as 30 campanhas');
});

teste('v3.2: ADP — "todas as aprovadas" junta meses e a pessoa escolhe uma a uma', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  await prepararAdp(page);
  await page.evaluate(() => {   // uma aprovada de setembro, para misturar meses
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const base = d.campanhas.find(x => x.id === 2);
    const n = ++d.seq.campanhas;
    d.campanhas.push({ ...base, id: n, codigo: 'C2609X' + n, cliente: 'Pet Setembro', data_inicio: '2026-09-01', data_fim: '2026-09-30', investimento_lynkz: 40 });
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  });
  await page.goto(`${BASE}/?papel=aprovador#/campanhas`);
  await page.reload();
  await page.locator('#cp-adp').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  await page.selectOption('#adp-mes', 'todas');
  igual(await d.locator('.adp-item').count(), 3, 'as três aprovadas com Swile, de outubro e setembro');
  igual(await d.locator('[data-adp-marca]:checked').count(), 0, 'começam desmarcadas');
  afirma((await d.locator('.adp-item', { hasText: 'Pet Setembro' }).innerText()).includes('Setembro 2026'), 'mostra o mês de cada campanha');
  await d.locator('[type=submit]').click();
  afirma((await d.locator('.dialogo-erro, [role=alert]').first().innerText()).includes('Marque pelo menos'), 'sem nada marcado não gera');
  // Busca + "Marcar todas" marca só as visíveis.
  await page.fill('#adp-busca', 'setembro');
  igual(await d.locator('.adp-item:visible').count(), 1, 'busca filtra');
  await page.check('#adp-todas');
  await page.fill('#adp-busca', '');
  igual(await d.locator('[data-adp-marca]:checked').count(), 1, 'marcar todas respeita a busca');
  await d.locator('.adp-item', { hasText: 'Casa do Criador' }).locator('[data-adp-marca]').check();
  afirma(/Gerar PDF \(2 · R\$\s?140,00\)/.test(await d.locator('[type=submit]').innerText()), 'botão soma só as marcadas');
  await page.fill('#adp-venc', '2030-01-15');
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('[type=submit]').click()]);
  igual(dl.suggestedFilename(), 'ADP - CAMPANHAS - SETEMBRO A OUTUBRO 2026.pdf', 'nome com o período');
  await toastCom(page, 'ADP de setembro a outubro 2026 gerada');
  const { texto: t } = abrirPdf(fs.readFileSync(await dl.path()));
  for (const esperado of ['SETEMBRO A OUTUBRO 2026', 'PET SETEMBRO', 'CASA DO CRIADOR', 'R$ 140,00']) afirma(t.includes(esperado), 'PDF tem: ' + esperado);
  afirma(!t.includes('PET CENTER IMPERATRIZ'), 'a desmarcada fica de fora');
});

teste('v2.10: ADP — usuário regular gera; quem recebe de campanha de outro sem cadastro fica de fora', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  await prepararAdp(page);
  await page.goto(`${BASE}/?papel=coordenador#/historico`);
  await page.reload();
  await page.locator('#hs-adp').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  igual(await d.locator('.adp-item').count(), 2, 'as duas aparecem');
  igual(await d.locator('.adp-bloqueado').count(), 1, 'a avulsa de outra pessoa fica bloqueada');
  afirma((await d.locator('.adp-item').nth(0).innerText()).includes('João Pedro Lima'), 'a do balconista usa o cadastro e vem antes da bloqueada');
  afirma(await d.locator('.adp-item').nth(1).evaluate(e => e.classList.contains('adp-bloqueado')), 'a bloqueada fica no fim');
  afirma(/Gerar PDF \(1 · R\$\s?600,00\)/.test(await d.locator('[type=submit]').innerText()), 'só a que tem dados');
  await d.locator('[data-adp-editar="0"] summary').click();
  igual(await page.inputValue('#adp-nasc-0'), '1988-09-30', 'nascimento vem do cadastro');
  const vio = (await axe(page, 'ADP diálogo 360 px')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade do diálogo: ' + JSON.stringify(vio));
  afirma(await semOverflow(page, 'ADP diálogo 360 px'), 'sem rolagem lateral em 360 px');
  await d.locator('[data-adp-marca]:not([disabled])').uncheck();
  await d.locator('[type=submit]').click();
  await d.locator('.dialogo-erro', { hasText: 'Marque pelo menos uma campanha' }).waitFor();
  await d.locator('[data-adp-marca]:not([disabled])').check();
  await d.locator('#adp-v-0').fill('0');
  await page.fill('#adp-cpf-0', '111.111.111-11');
  await d.locator('[data-adp-editar="0"] summary').click();   // fecha: o erro tem de reabrir
  await d.locator('[type=submit]').click();
  afirma((await erroDo(page, 'adp-v-0').innerText()).includes('valor a pagar'), 'valor zerado é recusado');
  afirma(await d.locator('[data-adp-editar="0"]').evaluate(e => e.open), 'linha com erro reabre a edição');
  afirma((await erroDo(page, 'adp-cpf-0').innerText()).includes('CPF inválido'), 'CPF inválido é recusado');
  await d.locator('[data-fechar]').click();
  await d.waitFor({ state: 'detached' });
  afirma(await page.evaluate(() => document.activeElement?.id) === 'hs-adp', 'foco volta ao botão');
}, { largura: 360, altura: 740, toque: true });

// ============================================================
//  v2.13 — FORNECEDORES: até 5, divisão da meta e da indústria, rebate proporcional
// ============================================================
const clicarInterruptor = (page, id) => page.locator(`label[for="${id}"]`).click();

teste('v2.13: no máximo 5 fornecedores; o 6º não entra e tirar um libera', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  afirma((await page.locator('label[for="n-laboratorio"]').innerText()).includes('Fornecedores'), 'campo chama "Fornecedores"');
  for (const [t, o] of [['ouro', 'Ouro Fino'], ['avert', 'Avert'], ['vansil', 'Vansil'], ['premier', 'Premier'], ['farm', 'Farmina']]) {
    await escolherNoCombo(page, '#n-laboratorio', t, o);
  }
  igual((await labsEscolhidos(page)).length, 5, '5 escolhidos');
  await page.fill('#n-laboratorio', ''); await page.type('#n-laboratorio', 'kel', { delay: 15 });
  igual(await page.locator('#n-laboratorio ~ .combo-lista [role=option]').count(), 0, 'nenhuma opção com 5 escolhidos');
  afirma((await page.locator('#n-laboratorio ~ .combo-lista').innerText()).includes('Limite de 5 fornecedores'), 'explica o limite');
  await page.keyboard.press('Escape');
  await page.click('[data-tirar-lab="Farmina"]');
  await escolherNoCombo(page, '#n-laboratorio', 'kel', 'Kelco');
  igual(JSON.stringify(await labsEscolhidos(page)), '["Ouro Fino","Avert","Vansil","Premier","Kelco"]', 'tirando um, entra outro');
  // Rascunho com 6 (de outra versão, por exemplo): só os 5 primeiros entram.
  await page.waitForFunction(() => localStorage.getItem('lynkz_rascunho_campanha_v2'));
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('lynkz_rascunho_campanha_v2'));
    r.laboratorio = 'Ouro Fino, Avert, Vansil, Premier, Farmina, Kelco';
    localStorage.setItem('lynkz_rascunho_campanha_v2', JSON.stringify(r));
  });
  await page.reload(); await page.waitForSelector('#n-labs');
  igual((await labsEscolhidos(page)).length, 5, 'rascunho com 6 abre com 5');
});

teste('v2.13: dividir por fornecedor — meta e indústria por fornecedor, rebate proporcional, grava e mostra no detalhe', async ({ page }) => {
  await abrir(page, { rota: '#/nova', papel: 'coordenador' });
  await escolherNoCombo(page, '#n-empresa', 'casa', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  afirma(await page.locator('#bloco-divisao').isHidden(), 'com um fornecedor não há divisão');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  afirma(await page.locator('#bloco-divisao').isVisible(), 'com dois aparece "Dividir por fornecedor"');
  await page.fill('#n-campanha', 'Meta dividida');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31');
  // Meta e indústria já digitadas: ao ligar, são repartidas em partes iguais.
  await page.fill('#n-meta', '30000'); await page.fill('#n-inv-industria', '1500,01');
  await clicarInterruptor(page, 'n-dividir');
  igual(await page.inputValue('#n-div-meta-0'), '15.000,00', 'meta repartida (1)');
  igual(await page.inputValue('#n-div-meta-1'), '15.000,00', 'meta repartida (2)');
  igual(await page.inputValue('#n-div-ind-0'), '750,00', 'indústria repartida (1)');
  igual(await page.inputValue('#n-div-ind-1'), '750,01', 'centavo que sobra vai para o último');
  afirma(await page.locator('#n-meta').evaluate(i => i.readOnly) && await page.locator('#n-inv-industria').evaluate(i => i.readOnly), 'totais ficam só leitura');
  await page.fill('#n-div-meta-0', '20000'); await page.fill('#n-div-meta-1', '10000');
  await page.fill('#n-div-ind-0', '1000'); await page.fill('#n-div-ind-1', '500');
  igual(await page.inputValue('#n-meta'), '30.000,00', 'meta total = soma');
  igual(await page.inputValue('#n-inv-industria'), '1.500,00', 'indústria total = soma');
  await clicarInterruptor(page, 'n-rebate');
  await page.fill('#n-rebate-pct', '2'); await page.fill('#n-rebate-teto', '500');
  await page.selectOption('#n-rebate-base', { index: 1 }); await page.selectOption('#n-rebate-gatilho', { index: 1 });
  igual(await page.locator('#n-div-parte-0').innerText(), '66,7% da meta · rebate estimado R$ 333,33', 'parte do 1º (teto repartido)');
  igual(await page.locator('#n-div-parte-1').innerText(), '33,3% da meta · rebate estimado R$ 166,67', 'parte do 2º');
  afirma((await page.locator('#div-soma').innerText()).includes('meta R$ 30.000,00'), 'soma visível');
  // Valor inválido num fornecedor: erro no campo dele.
  await page.fill('#n-div-meta-1', '1,2,3');
  await page.locator('[data-enviar]:visible').first().click();
  afirma((await erroDo(page, 'n-div-meta-1').innerText()).includes('Valor inválido'), 'erro no campo do fornecedor');
  await page.fill('#n-div-meta-1', '10000');
  // Rascunho guarda a divisão.
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForSelector('#n-labs');
  igual(await page.inputValue('#n-div-meta-0'), '20.000,00', 'rascunho volta com a divisão');
  igual(await page.inputValue('#n-div-ind-1'), '500,00', 'rascunho volta com a indústria');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /^#\/campanhas\/\d+/.test(location.hash));
  const c = (await db(page)).campanhas.find(x => x.campanha === 'Meta dividida');
  igual(c.meta, 30000, 'meta total gravada');
  igual(c.investimento_industria, 1500, 'indústria total gravada');
  igual(JSON.stringify(c.fornecedores), '[{"nome":"Ouro Fino","meta":20000,"investimento_industria":1000},{"nome":"Avert","meta":10000,"investimento_industria":500}]', 'divisão gravada');
  const painel = page.locator('.painel', { has: page.locator('.painel-titulo', { hasText: 'Por fornecedor' }) });
  await painel.waitFor();
  const t = await painel.innerText();
  afirma(/Ouro Fino[\s\S]*20\.000,00[\s\S]*66,7%[\s\S]*1\.000,00[\s\S]*333,33/.test(t), 'detalhe: Ouro Fino com meta, %, indústria e rebate: ' + t);
  afirma(/Avert[\s\S]*10\.000,00[\s\S]*166,67/.test(t), 'detalhe: Avert');
  // Usar como modelo traz a divisão.
  await page.click('[data-modelo]');
  await page.waitForSelector('#n-div-meta-0');
  igual(await page.inputValue('#n-div-meta-0'), '20.000,00', 'modelo copia a divisão');
  afirma(await page.locator('#n-dividir').isChecked(), 'modelo já vem dividindo');
});

teste('v2.13: tirar fornecedor até ficar um desfaz a divisão e grava sem ela; Excel tem a coluna da divisão', async ({ page }) => {
  await abrir(page, { rota: '#/nova', papel: 'coordenador' });
  await escolherNoCombo(page, '#n-empresa', 'casa', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await escolherNoCombo(page, '#n-laboratorio', 'avert', 'Avert');
  await escolherNoCombo(page, '#n-laboratorio', 'vansil', 'Vansil');
  await clicarInterruptor(page, 'n-dividir');
  await page.fill('#n-div-meta-0', '1000'); await page.fill('#n-div-meta-1', '2000'); await page.fill('#n-div-meta-2', '3000');
  igual(await page.inputValue('#n-meta'), '6.000,00', 'soma de três');
  await page.click('[data-tirar-lab="Avert"]');
  igual(await page.locator('.div-linha').count(), 2, 'a linha do Avert sai');
  igual(await page.inputValue('#n-div-meta-1'), '3.000,00', 'Vansil mantém o que foi digitado');
  igual(await page.inputValue('#n-meta'), '4.000,00', 'soma acompanha');
  await page.click('[data-tirar-lab="Vansil"]');
  afirma(await page.locator('#bloco-divisao').isHidden(), 'com um, a divisão some');
  afirma(!(await page.locator('#n-meta').evaluate(i => i.readOnly)), 'meta volta a ser editável');
  await page.fill('#n-campanha', 'Volta a um');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /^#\/campanhas\/\d+/.test(location.hash));
  const c = (await db(page)).campanhas.find(x => x.campanha === 'Volta a um');
  igual(c.fornecedores, null, 'sem divisão');
  igual(c.meta, 4000, 'meta que estava na tela');
  igual(await page.locator('.painel-titulo', { hasText: 'Por fornecedor' }).count(), 0, 'detalhe sem o painel');
  // Excel: coluna "Fornecedores" e "Divisão por Fornecedor".
  if (!XLSX_MJS) return;
  await page.evaluate(() => {
    const d = JSON.parse(sessionStorage.getItem('simulado-db-v3'));
    const c = d.campanhas.find(x => x.campanha === 'Volta a um');
    Object.assign(c, { laboratorio: 'Ouro Fino, Avert', meta: 3000, investimento_industria: 0, rebate_pct: 1, rebate_teto: 0,
      fornecedores: [{ nome: 'Ouro Fino', meta: 1000, investimento_industria: 0 }, { nome: 'Avert', meta: 2000, investimento_industria: 0 }] });
    sessionStorage.setItem('simulado-db-v3', JSON.stringify(d));
  });
  await page.goto(`${BASE}/?papel=coordenador#/campanhas?status=Todas`); await page.reload();
  await page.fill('#cp-busca', 'Volta a um'); await page.waitForTimeout(400);
  const { linhas } = await lerExcelBaixado(page, () => page.click('#cp-excel'));
  igual(linhas.length, 1, 'uma linha');
  igual(linhas[0].Fornecedores, 'Ouro Fino, Avert', 'coluna Fornecedores');
  igual(linhas[0]['Divisão por Fornecedor'], 'Ouro Fino: meta R$ 1.000,00 · indústria R$ 0,00 · rebate R$ 10,00 | Avert: meta R$ 2.000,00 · indústria R$ 0,00 · rebate R$ 20,00', 'coluna da divisão');
});

teste('v2.13: banco recusa divisão que não confere (mensagem em português)', async ({ page }) => {
  await abrir(page, { rota: '#/inicio', papel: 'coordenador' });
  const r = await page.evaluate(async () => {
    const { sb } = await import('/js/lib/supabase.js');
    const a = await sb.rpc('enviar_campanha', { p_campanha: { cliente: 'x', empresa_id: 3, laboratorio: 'Ouro Fino, Avert', campanha: 'Não confere', meta: 10,
      fornecedores: [{ nome: 'Ouro Fino', meta: 1, investimento_industria: 0 }, { nome: 'Avert', meta: 1, investimento_industria: 0 }] } });
    const b = await sb.rpc('enviar_campanha', { p_campanha: { cliente: 'x', empresa_id: 3, laboratorio: 'Ouro Fino, Avert, Vansil, Premier, Farmina, Kelco', campanha: 'Seis' } });
    const { detalhar } = await import('/js/dados/erros.js');
    return [detalhar(a.error).mensagem, detalhar(b.error).mensagem];
  });
  afirma(r[0].includes('divisão por fornecedor não confere'), 'mensagem da divisão: ' + r[0]);
  afirma(r[1].includes('No máximo 5 fornecedores'), 'mensagem do limite: ' + r[1]);
});

teste('v2.13: divisão no celular (390 px) — sem rolagem lateral e acessível', async ({ page }) => {
  await abrir(page, { rota: '#/nova', papel: 'coordenador' });
  await escolherNoCombo(page, '#n-empresa', 'casa', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'biog', 'Biogénesis Bagó Pet');
  await escolherNoCombo(page, '#n-laboratorio', 'pet nut', 'Pet Nutrition');
  await page.fill('#n-campanha', 'Celular');
  await page.locator('[data-passo-continuar]:visible').first().click();
  await clicarInterruptor(page, 'n-dividir');
  await page.fill('#n-div-meta-0', '123456789'); await page.fill('#n-div-ind-1', '9999999');
  await page.locator('#bloco-divisao').scrollIntoViewIfNeeded();
  afirma(await semOverflow(page, 'Nova divisão 390 px'), 'sem rolagem lateral');
  const vio = (await axe(page, 'Nova divisão 390 px')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
  // A revisão (passo 3) mostra a divisão.
  await page.locator('[data-passo-continuar]:visible').first().click();
  const rev = await page.locator('#resumo-passos').innerText();
  afirma(rev.includes('Biogénesis Bagó Pet') && rev.includes('meta R$ 123.456.789,00'), 'revisão mostra a divisão: ' + rev);
}, { largura: 390, altura: 844, toque: true });

// ============================================================
//  v3.0 — temas, convite de usuário
// ============================================================
teste('v3.0: tema — botão da barra lateral alterna claro, escuro e daltônico; o Perfil mostra e troca; fica salvo', async ({ page }) => {
  await abrir(page, { rota: '#/perfil' });
  const tema = () => page.evaluate(() => document.documentElement.dataset.tema);
  igual(await tema(), 'claro', 'aparelho claro → tema claro');
  igual(await page.locator('input[name="pf-tema"]:checked').inputValue(), 'auto', 'começa em Automático');
  const b = page.locator('#menu-tema');
  afirma((await b.getAttribute('aria-label')).includes('Trocar para Escuro'), 'botão diz para onde vai: ' + await b.getAttribute('aria-label'));
  await b.click(); igual(await tema(), 'escuro', '1º toque: escuro');
  igual(await page.locator('input[name="pf-tema"]:checked').inputValue(), 'escuro', 'Perfil acompanha o botão');
  await b.click(); igual(await tema(), 'daltonico', '2º toque: daltônico');
  await b.click(); igual(await tema(), 'claro', '3º toque: volta ao claro');
  await page.locator('label.tema-opcao', { hasText: 'Daltônico' }).click();
  igual(await tema(), 'daltonico', 'Perfil troca o tema');
  const cor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--faixa-verde').trim());
  igual(cor.toUpperCase(), '#0072B2', 'daltônico usa azul no lugar do verde');
  await page.reload(); await page.waitForSelector('#app:not([hidden])');
  igual(await tema(), 'daltonico', 'escolha fica salva no aparelho');
  await page.locator('label.tema-opcao', { hasText: 'Automático' }).click();
  igual(await tema(), 'claro', 'Automático volta a seguir o aparelho');
});

for (const t of ['escuro', 'daltonico']) {
  teste(`v3.0: tema ${t} — telas principais passam no axe (contraste) no celular e no computador`, async ({ page }) => {
    const problemas = [];
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      await page.setViewportSize({ width: w, height: h });
      await abrir(page, { rota: '#/inicio' });
      await page.evaluate(v => localStorage.setItem('lynkz_tema', JSON.stringify(v)), t);
      for (const rota of ['#/inicio', '#/campanhas/1', '#/historico', '#/perfil']) {
        await page.goto(`${BASE}/?papel=aprovador${rota}`); await page.reload();
        await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(400);
        igual(await page.evaluate(() => document.documentElement.dataset.tema), t, 'tema aplicado');
        const v = (await axe(page, `${t} ${w}px ${rota}`)).filter(x => ['critical', 'serious'].includes(x.impacto));
        problemas.push(...v.map(x => `${w}px ${rota}: ${x.id} ${x.alvos.join(' | ')}`));
      }
    }
    afirma(!problemas.length, 'acessibilidade: ' + problemas.join('\n      '));
  });
}

teste('v3.0: convidar usuário — valida, envia, a pessoa aparece com acesso e o e-mail repetido é recusado', async ({ page }) => {
  await abrir(page, { rota: '#/usuarios' });
  await page.click('#us-convidar');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('[type=submit]').click();
  afirma((await erroDo(page, 'cv-nome').innerText()).includes('nome'), 'nome obrigatório');
  afirma((await erroDo(page, 'cv-email').innerText()).includes('e-mail'), 'e-mail obrigatório');
  await page.fill('#cv-nome', '  Maria   Lima ');
  await page.fill('#cv-email', 'bia@lynkz.com.br');
  await d.locator('[type=submit]').click();
  afirma((await erroDo(page, 'cv-email').innerText()).includes('Já existe'), 'e-mail de quem já tem conta é recusado sem ir ao servidor');
  await page.fill('#cv-email', 'Maria.Lima@LYNKZ.com.br');
  await d.locator('label.pessoa', { hasText: 'Administrador' }).click();
  await d.locator('[type=submit]').click();
  await toastCom(page, 'Convite enviado para maria.lima@lynkz.com.br');
  const novo = Object.values((await db(page)).perfis).find(u => u.email === 'maria.lima@lynkz.com.br');
  afirma(novo && novo.nome === 'Maria Lima' && novo.papel === 'aprovador' && novo.ativo, 'conta criada com nome, perfil e acesso: ' + JSON.stringify(novo));
  const lista = page.locator('#us-t-ativos').locator('..');
  await lista.locator('li', { hasText: 'Maria Lima' }).waitFor();
  afirma((await lista.locator('li', { hasText: 'Maria Lima' }).innerText()).includes('Administrador'), 'entra com o perfil escolhido e acesso');
  const vio = (await axe(page, 'Usuários com convite')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

teste('v3.0: convite sem a chave no servidor mostra a causa no diálogo; usuário comum não vê o botão', async ({ page }) => {
  await abrir(page, { rota: '#/usuarios', extra: '&convite=sem-chave' });
  await page.click('#us-convidar');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  await page.fill('#cv-nome', 'Teste'); await page.fill('#cv-email', 'teste@lynkz.com.br');
  await d.locator('[type=submit]').click();
  await d.locator('.dialogo-erro', { hasText: 'falta configurar a chave' }).waitFor();
  await d.locator('[data-fechar]').click();
  await abrir(page, { rota: '#/usuarios', papel: 'coordenador' });
  igual(await page.locator('#us-convidar').count(), 0, 'sem botão para quem não é administrador');
}, { largura: 390, altura: 844, toque: true });

teste('v3.0: link de convite abre "Crie sua senha" e, salvando, entra direto no app', async ({ page }) => {
  await page.goto(`${BASE}/?zerar=1#access_token=t&refresh_token=r&type=invite`);
  await page.locator('#acesso h1', { hasText: 'Crie sua senha' }).waitFor();
  afirma(!page.url().includes('access_token'), 'token fora da URL');
  await page.fill('#n-senha', '1234567890'); await page.fill('#n-senha2', '1234567890');
  await page.click('#n-ok');
  await page.waitForSelector('#app:not([hidden])');
  igual(await page.evaluate(() => localStorage.getItem('lynkz_recuperacao_pendente')), null, 'marca removida');
});

// ============================================================
//  v3.1 — filtros por fornecedor e cliente, excluir campanha, ADP no Perfil, sem terceiros
// ============================================================
const caixa = (page, sel) => page.locator(sel).evaluate(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; });

teste('v3.1: filtro por cliente e fornecedor, proporcionais no celular (360 px)', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  await page.click('#cp-status [data-status="Todas"]');
  const cartoes = () => page.locator('#cp-itens .cartao').count();
  const total = await cartoes();
  afirma(await page.locator('#cp-cliente option', { hasText: 'Agropecuária São Luís' }).count() === 1, 'cliente com campanha aparece uma vez');
  igual(await page.locator('#cp-cliente option', { hasText: 'CLIENTE QLIK' }).count(), 0, 'cliente sem campanha não entra na lista');
  await page.selectOption('#cp-cliente', 'Agropecuária São Luís');
  igual(await cartoes(), 2, 'só as campanhas do cliente');
  await page.selectOption('#cp-lab', 'Vansil');
  igual(await cartoes(), 1, 'cliente + fornecedor juntos');
  afirma((await page.locator('#cp-itens .cartao').innerText()).includes('Combo Vermífugos'), 'a campanha certa');
  await page.selectOption('#cp-lab', '');
  await page.selectOption('#cp-cliente', '');
  igual(await cartoes(), total, 'limpar volta tudo');
  const [lab, cli, sw] = [await caixa(page, '#cp-lab'), await caixa(page, '#cp-cliente'), await caixa(page, 'label[for="cp-minhas"]')];
  igual(lab.y, cli.y, 'fornecedor e cliente na mesma linha');
  afirma(Math.abs(lab.w - cli.w) <= 1, `mesma largura (${lab.w} x ${cli.w})`);
  afirma(sw.y > lab.y, '"Só as minhas" embaixo no celular');
  afirma(await semOverflow(page, 'Campanhas filtros 360 px'), 'sem rolagem lateral');
  const vio = (await axe(page, 'Campanhas filtros 360 px')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
  // Filtro guardado some quando um indicador do Início abre a lista (o número tem de bater).
  await page.selectOption('#cp-cliente', 'Casa do Criador');
  await page.evaluate(() => { location.hash = '#/campanhas?status=Pendente'; });
  await page.waitForFunction(() => document.querySelector('#cp-cliente')?.value === '');
}, { largura: 360, altura: 740 });

teste('v3.1: filtros numa linha quando a lista é larga (1000 px)', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas' });
  const [lab, cli, sw] = [await caixa(page, '#cp-lab'), await caixa(page, '#cp-cliente'), await caixa(page, 'label[for="cp-minhas"]')];
  afirma(Math.abs(lab.w - cli.w) <= 1, 'mesma largura');
  afirma(sw.x > cli.x && Math.abs((sw.y + 22) - (cli.y + 22)) < 30, '"Só as minhas" ao lado');
  await page.selectOption('#cp-cliente', 'Pet Center Imperatriz');
  await page.click('#cp-status [data-status="Todas"]');
  igual(await page.locator('#cp-itens .cartao').count(), 2, 'filtra por cliente no computador');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cp-excel')]);
  afirma(/Pet-Center-Imperatriz/.test(dl.suggestedFilename()), 'nome do Excel leva o cliente: ' + dl.suggestedFilename());
}, { largura: 1000, altura: 800 });

teste('v3.1: administrador exclui campanha com motivo; sai da lista e fica registrada', async ({ page }) => {
  await abrir(page, { rota: '#/campanhas/2' });
  await page.locator('[data-excluir]').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  afirma((await d.innerText()).includes('Balconista destaque'), 'diálogo diz qual campanha');
  const vio = (await axe(page, 'Excluir campanha diálogo')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade do diálogo: ' + JSON.stringify(vio));
  await d.locator('button', { hasText: 'Excluir de vez' }).click();
  afirma((await erroDo(page, 'ex-motivo').innerText()).includes('motivo'), 'motivo é obrigatório');
  igual((await db(page)).campanhas.filter(c => c.id === 2).length, 1, 'sem motivo nada é excluído');
  await page.fill('#ex-motivo', 'Enviada em duplicidade');
  await d.locator('button', { hasText: 'Excluir de vez' }).click();
  await toastCom(page, 'excluída');
  await page.waitForFunction(() => location.hash === '#/campanhas');
  const banco = await db(page);
  igual(banco.campanhas.filter(c => c.id === 2).length, 0, 'saiu do banco');
  igual(banco.campanhas_excluidas?.[0]?.motivo, 'Enviada em duplicidade', 'registro guarda o motivo');
  await page.click('#cp-status [data-status="Todas"]');
  igual(await page.locator('#cp-itens .cartao[data-id="2"]').count(), 0, 'saiu da lista');
}, { largura: 1440 });

teste('v3.1: usuário regular não vê "Excluir campanha" e o banco recusa', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/campanhas/3' });
  await page.locator('.det-reenviar').waitFor();
  igual(await page.locator('[data-excluir]').count(), 0, 'sem botão para usuário regular');
  const r = await page.evaluate(async () => {
    const { sb } = await import('/js/lib/supabase.js');
    return (await sb.rpc('excluir_campanha', { p_id: 3, p_motivo: 'tentativa direta' })).error?.code;
  });
  igual(r, '42501', 'chamada direta recusada');
  igual((await db(page)).campanhas.filter(c => c.id === 3).length, 1, 'campanha continua');
}, { largura: 390, altura: 844 });

teste('v3.1: Perfil gera ADP em PDF (além do Excel)', async ({ page }) => {
  await abrir(page, { rota: '#/inicio' });
  await prepararAdp(page);
  await page.goto(`${BASE}/?papel=aprovador#/perfil`);
  await page.reload();
  await page.locator('#pf-adp').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  igual(await d.locator('.adp-item').count(), 2, 'as aprovadas com Swile do mês');
  const [dl] = await Promise.all([page.waitForEvent('download'), d.locator('[type=submit]').click()]);
  afirma(/\.pdf$/i.test(dl.suggestedFilename()), 'baixa um PDF: ' + dl.suggestedFilename());
  const [xl, ad] = [await caixa(page, '#pf-excel'), await caixa(page, '#pf-adp')];
  afirma(await semOverflow(page, 'Perfil 390 px'), 'sem rolagem lateral');
  afirma(xl.w > 0 && ad.w > 0, 'os dois botões aparecem');
}, { largura: 390, altura: 844 });

teste('v3.1: sem pedidos a terceiros (fonte no próprio site) e Excel com a biblioteca enxuta', async ({ page, contexto }) => {
  await comCspDeProducao(contexto);
  const fora = [];
  page.on('request', r => { const u = new URL(r.url()); if (u.origin !== BASE && !u.protocol.startsWith('data')) fora.push(u.host); });
  const csp = [];
  page.on('console', m => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await abrir(page, { rota: '#/perfil' });
  const fonte = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('600 16px "Instrument Sans"') && [...document.fonts].some(f => f.family.includes('Instrument Sans') && f.status === 'loaded'); });
  afirma(fonte, 'Instrument Sans carregada do próprio site');
  igual(fora.length, 0, 'nenhum pedido para fora: ' + fora.join(', '));
  if (XLSX_LER) {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#pf-excel')]);
    const wb = XLSX_LER.read(fs.readFileSync(await dl.path()));
    afirma(XLSX_LER.utils.sheet_to_json(wb.Sheets.Campanhas).length >= 5, 'planilha abre e tem as campanhas');
  }
  igual(csp.length, 0, 'sem bloqueio de CSP: ' + csp.join(' | '));
}, { largura: 1440 });

// ============================================================
//  v3.2: comissões (cadastro, parâmetros e prévia do mês)
// ============================================================
async function previaOutubro(page) {
  await abrir(page, { rota: '#/comissoes' });
  await page.selectOption('#cm-mes', '2026-10');
  await page.click('#cm-buscar');
  await page.locator('.cm-destaque').waitFor();
}

teste('v3.2: comissões — só administrador vê o menu e a tela', async ({ page }) => {
  await abrir(page, { papel: 'coordenador', rota: '#/comissoes' });
  igual(await page.locator('[data-nav="comissoes"]').count(), 0, 'coordenador sem menu Comissões');
  await page.locator('.vazio-titulo', { hasText: 'Só administradores' }).waitFor();
});

teste('v3.3: comissões — apuração separa Farelo, aplica acordo e contrato e lista os novos no Qlik', async ({ page }) => {
  await previaOutubro(page);
  const texto = await page.locator('#cm-conteudo').innerText();
  afirma(texto.includes('A pagar em outubro 2026'), 'destaque do mês');
  afirma(texto.includes('Elielson Serpa Mendes') && texto.includes('R$ 26.336,69') && texto.includes('R$ 4.880,12'), 'CLT com Farelo e comissão (2,5% + 1%)');
  afirma(/Nayra Juliana Lima Vale[\s\S]*Paga o acordo[\s\S]*R\$ 5\.000,00/.test(texto), 'acordo mínimo como piso');
  afirma(/Rayane Cunha dos Anjos[\s\S]*R\$ 150,00[\s\S]*R\$ 867,28/.test(texto), 'premiação gravada do mês entra no valor a pagar');
  afirma(/Seldiana[\s\S]*R\$ 3\.607,04[\s\S]*R\$ 2\.051,85[\s\S]*R\$ 5\.658,89/.test(texto), 'PJ: 3% + 2% e contrato 1,2%');
  afirma(texto.includes('Novos no Qlik') && texto.includes('SEM CADASTRO LTDA') && !texto.includes('Alesandro'), 'novos no Qlik listados; desativado fora');
  igual(await page.locator('[data-ligar], #cm-novo').count(), 0, 'sem "Ligar a alguém" nem "Novo comissionado"');
  afirma(texto.includes('Não comissionam: TERRAZOO'), 'TERRAZOO ignorado');
  const vio = (await axe(page, 'Comissões apuração')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
  // Completar o cadastro de quem chegou do Qlik: soma na hora, sem consultar o Qlik de novo.
  await page.click('[data-completar="SEM CADASTRO LTDA"]');
  afirma((await page.locator('dialog .cm-qlik').innerText()).includes('SEM CADASTRO LTDA'), 'nome do Qlik fixo no diálogo');
  igual(await page.locator('#dc-nomes-qlik').count(), 0, 'nome do Qlik não se digita');
  await page.selectOption('#dc-regime', 'PJ');
  igual(await page.inputValue('#dc-pct-principal'), '5', '% principal do PJ');
  await page.fill('#dc-pj-documento', '12.345.678/0001-95');
  await page.click('dialog button[type="submit"]');
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.locator('.cm-sem').waitFor({ state: 'detached' });
  afirma(/Sem Cadastro Ltda[\s\S]*R\$ 76,52/.test(await page.locator('#cm-conteudo').innerText()), 'entrou na comissão como PJ (5%)');
  const novo = (await db(page)).comissionados.find(c => c.nomes_qlik.join() === 'SEM CADASTRO LTDA');
  afirma(novo && novo.regime === 'PJ' && novo.pj_documento === '12345678000195', 'gravado: ' + JSON.stringify(novo));
});

teste('v3.4: comissões — o mês escolhido fica no endereço e volta com a apuração', async ({ page }) => {
  await previaOutubro(page);
  afirma(page.url().endsWith('#/comissoes?aba=previa&mes=2026-10'), 'mês no endereço: ' + page.url());
  await page.click('[data-aba="premiacoes"]');
  await page.locator('#cm-form-premio').waitFor();
  afirma(page.url().endsWith('aba=premiacoes&mes=2026-10'), 'aba e mês no endereço: ' + page.url());
  await page.click('[data-aba="previa"]');
  await page.locator('.cm-destaque', { hasText: 'outubro 2026' }).waitFor();
  // Sai pelo menu e volta: mesmo mês, com a consulta da memória (sem buscar no Qlik de novo).
  let consultas = 0;
  page.on('request', rq => { if (rq.url().includes('/api/qlik/comissoes')) consultas++; });
  await page.evaluate(() => { location.hash = '#/inicio'; });
  await page.waitForFunction(() => location.hash === '#/inicio');
  await page.evaluate(() => { location.hash = '#/comissoes'; });
  await page.locator('.cm-destaque', { hasText: 'outubro 2026' }).waitFor();
  igual(await page.inputValue('#cm-mes'), '2026-10', 'seletor no mês lembrado');
  igual(consultas, 0, 'sem nova consulta ao Qlik');
  // Recarregar: o mês vem do endereço.
  await page.reload();
  await page.waitForSelector('#cm-mes');
  igual(await page.inputValue('#cm-mes'), '2026-10', 'mês do endereço depois de recarregar');
  // Endereço com outro mês troca o mês da tela.
  await page.evaluate(() => { location.hash = '#/comissoes?aba=premiacoes&mes=2026-09'; });
  await page.locator('#cm-t-premio', { hasText: 'setembro 2026' }).waitFor();
});

teste('v3.4: comissões — novos no Qlik em lote: marcar dois e cadastrar como CLT', async ({ page }) => {
  // Sem o TERRAZOO nos "não comissionam", os novos passam a ser dois.
  await abrir(page, { rota: '#/comissoes?aba=parametros' });
  await page.fill('#cp-nomes_ignorados', '');
  await page.click('#cm-form-param button[type="submit"]');
  await page.locator('.cm-alterado').waitFor();
  await page.click('[data-aba="previa"]');
  await page.selectOption('#cm-mes', '2026-10');
  await page.click('#cm-buscar');
  await page.locator('.cm-lote').waitFor();
  igual(await page.locator('[data-lote]').count(), 2, 'dois novos com caixa de marcar');
  await page.click('#cm-lote-ok');
  await toastCom(page, 'Marque pelo menos um');
  await page.check('#cm-lote-todos');
  igual(await page.locator('#cm-lote-n').innerText(), '2 marcados', 'contador');
  await page.uncheck('[data-lote="TERRAZOO"]');
  igual(await page.locator('#cm-lote-todos').evaluate(i => i.indeterminate), true, '"Marcar todos" pela metade');
  await page.check('[data-lote="TERRAZOO"]');
  await page.click('#cm-lote-ok');
  afirma((await page.locator('[data-campo="cm-lote-acao"] .campo-erro').innerText()).includes('Escolha'), 'pede a ação');
  await page.selectOption('#cm-lote-acao', 'CLT');
  await page.click('#cm-lote-ok');
  const dlg = page.locator('dialog', { hasText: 'Cadastrar 2 vendedores como CLT?' });
  const textoDlg = await dlg.innerText();
  afirma(textoDlg.includes('SEM CADASTRO LTDA') && textoDlg.includes('TERRAZOO') && textoDlg.includes('Farelo'), 'confirmação com os nomes e os %: ' + textoDlg);
  await dlg.locator('button[type="submit"]').click();
  await toastCom(page, '2 vendedores entraram na comissão como CLT');
  await page.locator('.cm-sem').waitFor({ state: 'detached' });
  const p = (await db(page)).comissao_parametros[0];
  const novos = (await db(page)).comissionados.filter(c => ['SEM CADASTRO LTDA', 'TERRAZOO'].includes(c.nomes_qlik[0]));
  afirma(novos.length === 2 && novos.every(c => c.regime === 'CLT' && c.pct_principal === p.pct_clt_principal && c.pct_farelo === p.pct_clt_farelo), 'gravados como CLT com os % padrão: ' + JSON.stringify(novos));
  afirma(novos.some(c => c.nome === 'Sem Cadastro Ltda'), 'nome legível');
  afirma((await page.locator('#cm-conteudo').innerText()).includes('Terrazoo'), 'entraram na tabela CLT');
  const vio = (await axe(page, 'Comissões lote')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

// WCAG 2.5.8: alvo de toque com pelo menos 24 px de altura.
teste('v3.4: celular (360 px) — links no meio do texto e escolha de tema com 24 px de toque', async ({ page }) => {
  const altura = async sel => (await page.locator(sel).first().boundingBox()).height;
  await abrir(page, { rota: '#/inicio' });
  afirma(await altura('.aviso-usuarios a') >= 24, '"Liberar em Usuários" com 24 px');
  await abrir(page, { rota: '#/campanhas/2' });
  afirma(await altura('a.link-toque[href^="#/gestao/empresas/"]') >= 24, 'nome do balconista com 24 px');
  await abrir(page, { rota: '#/perfil' });
  afirma(await altura('.tema-opcao input') >= 24, 'botão de tema com 24 px');
  afirma(await altura('.tema-opcao') >= 44, 'cartão do tema inteiro clicável');
}, { largura: 360, altura: 740, toque: true });

teste('v3.3: comissões — "não comissiona" tira o nome dos novos e grava nos parâmetros', async ({ page }) => {
  await previaOutubro(page);
  await page.click('[data-ignorar="SEM CADASTRO LTDA"]');
  await page.click('dialog button[type="submit"]');
  await page.locator('.cm-sem').waitFor({ state: 'detached' });
  afirma((await db(page)).comissao_parametros[0].nomes_ignorados.includes('SEM CADASTRO LTDA'), 'gravado nos parâmetros');
});

teste('v3.3: comissões — premiação lançada e removida muda o valor a pagar', async ({ page }) => {
  await previaOutubro(page);
  await page.click('[data-aba="premiacoes"]');
  await page.locator('#cm-form-premio').waitFor();
  await page.click('#cm-form-premio button[type="submit"]');
  igual(await semErroVisivel(page), 3, 'três campos obrigatórios');
  // Ajuste: desconto com motivo, entra depois do acordo.
  await page.selectOption('#aj-pessoa', { label: 'Alex (PJ)' });
  await page.fill('#aj-motivo', 'Desconto de adiantamento');
  await page.fill('#aj-valor', '50,00');
  await page.click('#cm-form-ajuste button[type="submit"]');
  await page.locator('[data-remover^="ajuste:"]').waitFor();
  const aj = (await db(page)).comissao_ajustes[0];
  afirma(aj && aj.valor === -50 && aj.motivo === 'Desconto de adiantamento' && aj.mes === '2026-10', 'ajuste gravado negativo: ' + JSON.stringify(aj));
  await page.selectOption('#pr-pessoa', { label: 'Alex (PJ)' });
  await page.fill('#pr-desc', 'Campanha Farmina');
  await page.fill('#pr-valor', '200,00');
  await page.click('#cm-form-premio button[type="submit"]');
  await page.locator('[data-remover^="premio:"]').nth(1).waitFor();
  afirma((await page.locator('#cm-conteudo').innerText()).includes('R$ 350,00'), 'total das premiações do mês');
  const p = (await db(page)).comissao_premiacoes.find(x => x.descricao === 'Campanha Farmina');
  afirma(p && p.mes === '2026-10' && p.comissionado_id === 5 && p.valor === 200, 'gravada no mês: ' + JSON.stringify(p));
  await page.click('[data-aba="previa"]');
  afirma(/Alex[\s\S]*R\$ 200,00[\s\S]*Ajustes −R\$ 50,00[\s\S]*R\$ 8\.602,97/.test(await page.locator('#cm-conteudo').innerText()), 'premiação e ajuste no valor a pagar do Alex');
  await page.click('[data-aba="premiacoes"]');
  await page.click(`[data-remover="premio:${p.id}"]`);
  await page.click('dialog button[type="submit"]');
  await page.locator('[data-remover^="premio:"]').nth(1).waitFor({ state: 'detached' });
  afirma((await db(page)).comissao_premiacoes.find(x => x.id === p.id).ativo === false, 'removida fica desativada');
  const vio = (await axe(page, 'Comissões premiações')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

teste('v3.3: comissões — contrato do mês: meta e realizado informado com motivo', async ({ page }) => {
  await previaOutubro(page);
  await page.click('[data-aba="contrato"]');
  await page.locator('[data-contrato="5"]').waitFor();
  afirma((await page.locator('#cm-conteudo').innerText()).includes('Meta do cadastro'), 'sem meta do mês, mostra a do cadastro');
  await page.click('[data-contrato="5"]');
  await page.fill('#ct-mf', '250.000,00');
  await page.click('dialog button[type="submit"]');
  await page.locator('dialog').waitFor({ state: 'detached' });
  afirma(/Alex[\s\S]*Faturamento abaixo de 100%/.test(await page.locator('#cm-conteudo').innerText()), 'meta maior: não atinge');
  await page.click('[data-contrato="5"]');
  await page.fill('#ct-rf', '260.000,00');
  await page.click('dialog button[type="submit"]');
  afirma((await page.locator('[data-campo="ct-mot"] .campo-erro').innerText()).includes('motivo'), 'realizado informado pede motivo');
  await page.fill('#ct-mot', 'Notas de setembro fora do Qlik');
  await page.click('dialog button[type="submit"]');
  await page.locator('dialog').waitFor({ state: 'detached' });
  const t = await page.locator('#cm-conteudo').innerText();
  afirma(t.includes('Realizado informado: Notas de setembro fora do Qlik') && t.includes('R$ 2.600,00'), 'prêmio de 1% sobre o informado (104%)');
  const m = (await db(page)).comissao_mes_pj.find(x => x.comissionado_id === 5);
  afirma(m.meta_faturamento === 250000 && m.realizado_faturamento === 260000 && m.nf_numero === '300', 'gravado no mês sem perder a NF: ' + JSON.stringify(m));
  const vio = (await axe(page, 'Comissões contrato')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

teste('v3.3: comissões — Excel no formato de outubro, recibos e ADP dos PJ com a NF', async ({ page }) => {
  await previaOutubro(page);
  // Excel: quatro abas, com a base do Qlik.
  const [xl] = await Promise.all([page.waitForEvent('download'), page.click('#cm-excel')]);
  igual(xl.suggestedFilename(), 'Comissoes Lynkz - Outubro 2026.xlsx', 'nome do Excel');
  if (XLSX_LER) {
    const wb = XLSX_LER.read(fs.readFileSync(await xl.path()));
    igual(wb.SheetNames.join('|'), 'Campanha mensal|Ajustes|Contrato de Resultado - Mês|Análise de comissões|Base Qlik 26 - 25', 'abas da planilha de outubro e a de ajustes');
    const an = XLSX_LER.utils.sheet_to_json(wb.Sheets['Análise de comissões'], { header: 1 });
    afirma(an.some(l => l[2] === 'Seldiana' && Math.abs(l[16] - 5658.89) < 0.001), 'Seldiana com o total da tela');
    afirma(String(wb.Sheets['Análise de comissões'].K5?.f || '').startsWith('ROUND('), 'comissão com fórmula');
  }
  // Recibos: um PDF com uma página por PJ com valor a pagar.
  const [rc] = await Promise.all([page.waitForEvent('download'), page.click('#cm-recibos')]);
  igual(rc.suggestedFilename(), 'Recibos - Comissao Outubro 2026.pdf', 'nome dos recibos');
  const recibo = abrirPdf(fs.readFileSync(await rc.path()));
  igual(paginasPdf(recibo.bruto), 2, 'uma página por PJ');
  afirma(recibo.texto.includes('RECIBO DE PAGAMENTO') && recibo.texto.includes('DOMINGOS DAS MERCES ARAUJO JUNIOR') && recibo.texto.includes('R$ 5.658,89'), 'recibo com quem recebe e o total');
  // ADP: NF obrigatória, gravada no mês.
  await page.click('#cm-adp');
  await page.locator('#ap-venc').waitFor();
  igual(await page.inputValue('#ap-nf-0'), '300', 'NF gravada vem preenchida');
  await page.click('dialog button[type="submit"]');
  afirma((await page.locator('[data-campo="ap-nf-1"] .campo-erro').innerText()).includes('número da NF'), 'NF obrigatória');
  afirma((await page.locator('[data-campo="ap-nv-0"] .campo-erro').innerText()).includes('valor da NF'), 'valor da NF obrigatório');
  await page.fill('#ap-nf-1', '18');
  await page.fill('#ap-nv-1', '5.658,89');
  await page.fill('#ap-nv-0', '8.000,00');
  afirma(await page.locator('[data-ap-dif="0"]').isVisible(), 'avisa na hora que o valor da NF não bate');
  await page.click('dialog button[type="submit"]');
  await page.locator('dialog', { hasText: 'Uma nota com valor diferente' }).waitFor();
  const [adp] = await Promise.all([page.waitForEvent('download'), page.locator('dialog', { hasText: 'Uma nota com valor diferente' }).locator('button[type="submit"]').click()]);
  igual(adp.suggestedFilename(), 'ADP - COMISSOES PJ - OUTUBRO 2026.pdf', 'nome da ADP');
  const pdf = abrirPdf(fs.readFileSync(await adp.path()));
  afirma(pdf.texto.includes('DOCUMENTOS DIVERSOS / NF') && pdf.texto.includes('SERVIÇOS PRESTADOS PJ') && pdf.texto.includes('R$ 14.111,86'), 'ADP com departamento e total: ' + pdf.texto.match(/R\$ [\d.,]+/g));
  afirma(/\n18\n/.test(pdf.texto) && /\n300\n/.test(pdf.texto), 'números das NF na ADP');
  const nfSel = (await db(page)).comissao_mes_pj.find(x => x.comissionado_id === 6);
  afirma(nfSel?.nf_numero === '18' && nfSel?.nf_valor === 5658.89, 'número e valor da NF da Seldiana gravados no mês: ' + JSON.stringify(nfSel));
});

teste('v3.3: comissões — fechar o mês grava no histórico, trava os lançamentos e reabrir pede motivo', async ({ page }) => {
  await previaOutubro(page);
  await page.click('#cm-fechar');
  await page.click('dialog button[type="submit"]');
  await page.locator('#cm-reabrir').waitFor();
  const t = await page.locator('#cm-conteudo').innerText();
  afirma(t.includes('Mês fechado em') && t.includes('Pago em outubro 2026') && !(await page.locator('#cm-buscar, [data-completar]').count()), 'mês fechado mostra a cópia, sem buscar nem completar');
  const f = (await db(page)).comissao_fechamentos[0];
  afirma(f && f.mes === '2026-10' && f.status === 'fechado' && f.dados.resultado.linhas.length >= 6 && f.dados.cadastro.some(c => c.id === 5), 'cópia gravada');
  await page.click('[data-aba="premiacoes"]');
  await page.locator('.cm-fechado').waitFor();
  igual(await page.locator('#cm-form-premio, #cm-form-ajuste, [data-remover]').count(), 0, 'sem lançar nem remover no mês fechado');
  await page.click('[data-aba="contrato"]');
  await page.locator('.cm-fechado').waitFor();
  igual(await page.locator('[data-contrato]').count(), 0, 'contrato travado');
  // Recibo do mês fechado sai da cópia.
  await page.click('[data-aba="historico"]');
  await page.locator('[data-abrir-mes="2026-10"]').waitFor();
  afirma((await page.locator('#cm-conteudo').innerText()).includes('Outubro 2026'), 'mês no histórico');
  await page.click('[data-abrir-mes="2026-10"]');
  await page.locator('#cm-reabrir').waitFor();
  const [rc] = await Promise.all([page.waitForEvent('download'), page.click('[data-recibo="6"]')]);
  afirma(abrirPdf(fs.readFileSync(await rc.path())).texto.includes('R$ 5.658,89'), 'recibo da cópia');
  await page.click('#cm-reabrir');
  await page.click('dialog button[type="submit"]');
  afirma((await page.locator('[data-campo="rb-motivo"] .campo-erro').innerText()).includes('motivo'), 'reabrir pede motivo');
  await page.fill('#rb-motivo', 'NF do Alex errada');
  await page.click('dialog button[type="submit"]');
  await page.locator('#cm-fechar').waitFor();
  afirma((await page.locator('#cm-conteudo').innerText()).includes('reaberto'), 'aviso de mês reaberto');
  const f2 = (await db(page)).comissao_fechamentos[0];
  afirma(f2.status === 'reaberto' && f2.motivo_reabertura === 'NF do Alex errada' && f2.dados.resultado, 'reaberto mantém a cópia');
  const vio = (await axe(page, 'Comissões histórico')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

teste('v3.3: comissões — cadastro só edita quem veio do Qlik e avisa o que falta no PJ', async ({ page }) => {
  await abrir(page, { rota: '#/comissoes?aba=cadastro' });
  await page.locator('.usuarios-lista').first().waitFor();
  igual(await page.locator('#cm-novo').count(), 0, 'sem botão de cadastro novo');
  await page.fill('#cm-busca', 'domingos');
  afirma((await page.locator('#cm-lista').innerText()).includes('Seldiana') && !(await page.locator('#cm-lista').innerText()).includes('Elielson'), 'busca pela razão social');
  igual(await page.evaluate(() => document.activeElement.id), 'cm-busca', 'busca não perde o foco');
  await page.fill('#cm-busca', '');
  await page.click('[data-editar="5"]');
  igual(await page.locator('#dc-nomes-qlik, #dc-meta-faturamento').count(), 0, 'nome do Qlik e metas não ficam no cadastro');
  await page.fill('#dc-pj-pix', '');
  await page.click('dialog button[type="submit"]');
  await page.locator('dialog').waitFor({ state: 'detached' });
  afirma((await page.locator('#cm-lista').innerText()).includes('Falta para o recibo e a ADP: chave PIX'), 'avisa o que falta');
  const vio = (await axe(page, 'Comissões cadastro')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
});

teste('v3.3: comissões — parâmetros validam, gravam e pedem nova consulta', async ({ page }) => {
  await previaOutubro(page);
  await page.click('[data-aba="parametros"]');
  await page.locator('#cm-form-param').waitFor();
  await page.fill('#cp-cod_farelo', '66a');
  await page.fill('#cp-dia_corte', '31');
  await page.click('#cm-form-param button[type="submit"]');
  igual(await semErroVisivel(page), 2, 'dois erros na tela');
  await page.fill('#cp-cod_farelo', '6611');
  await page.fill('#cp-dia_corte', '20');
  await page.click('#cm-form-param button[type="submit"]');
  await page.locator('.cm-alterado').waitFor();
  const p = (await db(page)).comissao_parametros[0];
  afirma(p.cod_farelo === '6611' && p.dia_corte === 20, 'parâmetros gravados');
  await page.click('[data-aba="previa"]');
  const t = await page.locator('#cm-conteudo').innerText();
  afirma(t.includes('fornecedor 6611') && t.includes('Vendas de 21/09/2026 a 20/10/2026') && !t.includes('A pagar em'), 'apuração usa o parâmetro novo e pede nova consulta');
});

teste('v3.2: comissões — erro do Qlik aparece com o que fazer', async ({ page }) => {
  await abrir(page, { rota: '#/comissoes' });
  await page.selectOption('#cm-mes', { index: 1 });
  await page.route('**/api/qlik/comissoes', r => r.fulfill({ status: 502, contentType: 'application/json', body: '{"erro":"O Qlik demorou demais para responder."}' }));
  await page.click('#cm-buscar');
  await page.locator('.nota-alerta', { hasText: 'O Qlik demorou demais para responder.' }).waitFor();
  igual(await page.locator('.cm-destaque').count(), 0, 'sem resultado antigo na tela');
});

teste('v3.2: comissões no celular (360 px) e no tema escuro — sem rolagem lateral e acessível', async ({ page }) => {
  await previaOutubro(page);
  afirma(await semOverflow(page, 'Comissões 360 px'), 'sem rolagem lateral');
  const vio = (await axe(page, 'Comissões 360 escuro')).filter(x => ['critical', 'serious'].includes(x.impacto));
  afirma(!vio.length, 'acessibilidade: ' + JSON.stringify(vio));
  for (const aba of ['premiacoes', 'contrato', 'cadastro']) {
    await page.click(`[data-aba="${aba}"]`);
    await page.locator(aba === 'cadastro' ? '.usuarios-lista' : aba === 'contrato' ? '[data-contrato]' : '#cm-form-premio').first().waitFor();
    afirma(await semOverflow(page, `Comissões ${aba} 360 px`), `${aba} sem rolagem lateral`);
  }
}, { largura: 360, altura: 740, toque: true, escuro: true });

// As tabelas de comissões têm 7 colunas: entre 700 e 1100 px rolam na própria caixa, sem empurrar a página nem cortar colunas.
teste('v3.3: comissões em 1024 px com as vendas buscadas — Apuração e Contrato sem rolagem lateral', async ({ page }) => {
  await previaOutubro(page);
  afirma(await semOverflow(page, 'Comissões apuração 1024 px'), 'apuração sem rolagem lateral');
  await page.click('[data-aba="contrato"]');
  await page.locator('[data-contrato]').first().waitFor();
  afirma(await semOverflow(page, 'Comissões contrato 1024 px'), 'contrato sem rolagem lateral');
  const cortada = await page.evaluate(() => [...document.querySelectorAll('.cm-tabela')].some(t => t.scrollWidth > t.parentElement.clientWidth && getComputedStyle(t.parentElement).overflowX !== 'auto'));
  afirma(!cortada, 'nenhuma tabela cortada pela caixa');
}, { largura: 1024, altura: 768 });

// ============================================================
//  execução
// ============================================================
const filtro = process.argv[2];
let ok = 0, falhou = 0, pulado = 0;
for (const t of testes.filter(t => !filtro || t.nome.includes(filtro))) {
  const { contexto, page, erros } = await novaPagina(t.opcoes);
  const ini = Date.now();
  let res = 'ok', detalhe = '';
  try {
    const r = await t.fn({ page, contexto, erros });
    if (typeof r === 'string') { res = 'pulado'; detalhe = r; }
    const graves = erros.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Erro sem tradução|status of 502/.test(e));
    if (graves.length) throw new Falha('erros no console:\n      ' + graves.join('\n      '));
  } catch (e) {
    res = 'falhou'; detalhe = e instanceof Falha ? e.message : (e.stack || String(e)).split('\n').slice(0, 4).join('\n      ');
    await page.screenshot({ path: path.join(SAIDA, 'FALHA-' + t.nome.replace(/[^\w]+/g, '-').slice(0, 60) + '.png') }).catch(() => {});
  }
  const ms = Date.now() - ini;
  relatorio.testes.push({ nome: t.nome, resultado: res, ms, detalhe });
  console.log(`${res === 'ok' ? '✔' : res === 'pulado' ? '–' : '✘'} ${t.nome} (${(ms / 1000).toFixed(1)}s)${detalhe ? '\n      ' + detalhe : ''}`);
  res === 'ok' ? ok++ : res === 'pulado' ? pulado++ : falhou++;
  await contexto.close();
}
await navegador.close(); servidor.close();
relatorio.fim = new Date().toISOString();
relatorio.resumo = { ok, falhou, pulado };
fs.writeFileSync(path.join(SAIDA, 'relatorio.json'), JSON.stringify(relatorio, null, 2));
const avisosAxe = relatorio.acessibilidade.flatMap(a => a.violacoes.filter(v => !['critical', 'serious'].includes(v.impacto)).map(v => `${a.tela}: ${v.impacto} ${v.id}`));
if (avisosAxe.length) console.log(`\nAvisos de acessibilidade (moderados/leves): ${avisosAxe.length}\n  ` + [...new Set(avisosAxe.map(x => x.split(': ')[1]))].join('\n  '));
console.log(`\n${ok} ok · ${falhou} falharam · ${pulado} pulados — detalhes em tests/e2e/saida/relatorio.json`);
process.exit(falhou ? 1 : 0);
