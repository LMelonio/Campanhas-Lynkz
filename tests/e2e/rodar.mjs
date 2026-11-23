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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { qlikSimulado, ROTA_QLIK } from '../../dev/qlik-simulado.mjs';

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
  await page.fill('#n-senha', '123'); await page.click('#n-ok');
  await page.locator('#n-msg', { hasText: '8 caracteres' }).waitFor();
  await page.fill('#n-senha', '12345678'); await page.fill('#n-senha2', '12345679'); await page.click('#n-ok');
  await page.locator('#n-msg', { hasText: 'não são iguais' }).waitFor();
  await page.fill('#n-senha2', '12345678'); await page.click('#n-ok');
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

teste('navegação: menu do celular abre, trava o fundo e fecha com Esc', async ({ page }) => {
  await abrir(page);
  await page.click('#bi-menu');
  afirma(await page.evaluate(() => document.body.classList.contains('menu-aberto')), 'menu aberto');
  afirma(await page.evaluate(() => document.querySelector('#conteudo').inert), 'conteúdo inerte com o menu aberto');
  igual(await page.getAttribute('#bi-menu', 'aria-expanded'), 'true', 'aria-expanded');
  await page.keyboard.press('Escape');
  afirma(!(await page.evaluate(() => document.body.classList.contains('menu-aberto'))), 'Esc fecha');
  afirma(!(await page.evaluate(() => document.querySelector('#conteudo').inert)), 'conteúdo volta a ser usável');
  await page.click('#bi-menu'); await page.click('#menu a[href="#/historico"]');
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
  igual(await page.inputValue('#n-laboratorio'), 'Farmina', 'laboratório copiado');
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
  igual(await page.inputValue('#n-laboratorio'), 'Biogénesis Bagó Pet', 'setas + Enter');
  await page.click('#n-laboratorio'); await page.keyboard.type('xyz'); await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
  igual(await page.inputValue('#n-laboratorio'), 'Biogénesis Bagó Pet', 'texto solto volta ao último válido');
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
  igual(await page.inputValue('#n-laboratorio'), 'Vansil', 'laboratório copiado');
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
  afirma(/1\.600,49/.test(t) && /Diferente/.test(t), 'mostra o total atual e avisa a diferença: ' + t);
  await page.goto(`${BASE}/?papel=coordenador#/campanhas/1`);
  await page.locator('#det-notas').waitFor();
  igual(await page.locator('[data-conferir-qlik]').count(), 0, 'coordenador não vê o botão de conferência');
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
  await abrir(page);
  afirma(await page.evaluate(() => typeof window.supabase?.createClient === 'function'), 'supabase-js local carregado');
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
  await escolherNoCombo(page, '#n-laboratorio', 'recurso', 'Recurso próprio');
  await page.locator('#compras-corpo', { hasText: 'não é um fornecedor do Qlik' }).waitFor();
});

teste('lote R: cliente sem compras no período avisa', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4820');
  await page.locator('#compras-corpo', { hasText: 'de outros laboratórios' }).waitFor();   // comprou R$ 850 de outros
  const t = await page.locator('#compras-corpo').innerText();
  afirma(/R\$\s?850,00/.test(t) && /nada de Ouro Fino/.test(t), 'diz quanto comprou de outros e que nada deste laboratório');
  afirma(!/LABORATORIO_QLIK|config\.js| de o /.test(t), 'sem texto técnico nem "de o laboratório"');
});

teste('lote R: Qlik sem nenhuma compra do cliente avisa para chamar o TI', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await trocarCodigo(page, '4800');
  await page.locator('#compras-corpo .nota-alerta', { hasText: 'de nenhum laboratório' }).waitFor();
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

teste('lote R: mudar o período consulta de novo e zera a marcação', async ({ page }) => {
  await prepararCompras(page);
  await page.locator('input[data-nota]').first().waitFor();
  await page.check('input[data-nota="0"]');
  await page.fill('#n-fim', '2026-11-15'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('.compras-total', { hasText: '15/11/2026' }).waitFor();
  igual(await page.locator('input[data-nota]:checked').count(), 0, 'marcação vem zerada na nova consulta');
});

teste('lote R: marca do laboratório é opcional, filtra total e notas, é gravada e some ao trocar o laboratório', async ({ page }) => {
  await prepararCompras(page);
  await page.locator('#n-marca').waitFor();
  const ops = await page.locator('#n-marca option').allInnerTexts();
  igual(ops[0], 'Todas as marcas', 'começa em "Todas as marcas"');
  afirma(/WELLPET · R\$\s*1\.200,50/.test(ops[1]) && /PROTEÇÃO · R\$\s*399,99/.test(ops[2]), 'marcas com o valor comprado, da maior para a menor');
  igual(await page.locator('input[data-nota]').count(), 3, 'sem marca: três notas');

  await page.selectOption('#n-marca', 'WELLPET');
  await page.locator('.compras-total', { hasText: 'marca WELLPET' }).waitFor();
  afirma(/R\$\s*1\.200,50/.test(await page.locator('.compras-total').innerText()), 'total só da marca');
  igual(await page.locator('input[data-nota]').count(), 1, 'só a nota da marca');
  igual(await page.locator('#n-marca').inputValue(), 'WELLPET', 'a marca continua escolhida');
  igual(await page.locator('#n-marca option').count(), 3, 'a lista de marcas continua completa');

  await page.check('input[data-nota="0"]');
  await page.fill('#n-campanha', 'WellPet outubro'); await page.fill('#n-inv-lynkz', '100'); await page.fill('#n-meta', '5.000');
  await page.selectOption('#n-pagamento', 'Desconto em nota');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const c = d.campanhas.at(-1);
  igual(c.compras_marca, 'WELLPET', 'marca gravada'); igual(c.compras_periodo, 1200.5, 'total da marca gravado');
  igual(d.campanha_notas.filter(n => n.campanha_id === c.id).map(n => n.numero).join(','), '210818', 'só a nota da marca');
  await page.locator('#det-notas', { hasText: 'marca WELLPET' }).waitFor();

  // trocar o laboratório zera a marca escolhida
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', '4821', 'Casa do Criador');
  await escolherNoCombo(page, '#n-laboratorio', 'ouro', 'Ouro Fino');
  await page.fill('#n-inicio', '2026-10-01'); await page.fill('#n-fim', '2026-10-31'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('#n-marca').waitFor();
  await page.selectOption('#n-marca', 'PROTEÇÃO');
  await page.locator('.compras-total', { hasText: 'marca PROTEÇÃO' }).waitFor();
  await page.fill('#n-fim', '2026-11-15'); await page.dispatchEvent('#n-fim', 'change');
  await page.locator('.compras-total', { hasText: '15/11/2026' }).waitFor();
  igual(await page.locator('#n-marca').inputValue(), '', 'mudar o período volta para "Todas as marcas"');
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
const TELAS = ['#/inicio', '#/campanhas', '#/campanhas/2', '#/nova', '#/historico', '#/gestao', '#/gestao/empresas/2', '#/perfil', '#/usuarios'];
for (const [largura, altura] of [[360, 740], [390, 844], [768, 1024], [1024, 768], [1280, 800], [1440, 900]]) {
  teste(`telas ${largura}px: sem rolagem lateral${[390, 1440].includes(largura) ? ', acessibilidade e capturas' : ''}`, async ({ page }) => {
    const problemas = [];
    for (const rota of TELAS) {
      await abrir(page, { rota });
      if (rota === '#/nova') { await page.selectOption('#n-pagamento', 'Swile'); await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz'); await page.click('#n-campanha'); }
      await page.waitForTimeout(250);
      const nome = `${rota.replace(/[#/]+/g, '-').replace(/^-/, '')}-${largura}`;
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
