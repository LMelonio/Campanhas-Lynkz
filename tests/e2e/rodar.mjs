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
async function novaPagina({ largura = 1440, altura = 900, sw = 'block', escuro = false } = {}) {
  const contexto = await navegador.newContext({
    viewport: { width: largura, height: altura }, locale: 'pt-BR', timezoneId: 'America/Fortaleza',
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
async function abrir(page, { papel = 'aprovador', rota = '#/inicio' } = {}) {
  await page.goto(`${BASE}/?papel=${papel}&zerar=1${rota}`);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#titulo')?.textContent.trim().length > 0 && !document.querySelector('.esqueleto'));
}
const db = page => page.evaluate(() => JSON.parse(sessionStorage.getItem('simulado-db-v2')));
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
  igual(await n('Pendente'), '3', 'pendentes'); igual(await n('Aprovada'), '2', 'aprovadas'); igual(await n('Reprovada'), '1', 'reprovadas');
  igual(await page.locator('#cp-itens .cartao').count(), 3, 'lista começa nas pendentes');
  await page.click('#cp-status [data-status="Todas"]');
  igual(await page.locator('#cp-itens .cartao').count(), 6, 'todas');
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
  igual(await page.locator('input[name="n-pessoa"]').count(), 3, '2 balconistas + outra pessoa');
  await page.check('input[name="n-pessoa"][value="2"]');
  igual(await page.inputValue('#n-rec-nome_completo'), 'João Pedro Lima', 'nome preenchido');
  igual(await page.inputValue('#n-rec-cpf'), '111.444.777-35', 'CPF preenchido');
  igual(await page.inputValue('#n-rec-telefone'), '(99) 99999-0002', 'telefone preenchido');
  afirma(await page.locator('#rec-atualizar').isHidden(), 'sem oferta de atualizar antes de editar');
  await page.fill('#n-rec-email', 'joao.novo@exemplo.com');
  afirma(await page.locator('#rec-atualizar').isVisible(), 'oferta de atualizar o cadastro aparece');
  afirma((await page.locator('#be-pct').innerText()).includes('7,5%'), 'resumo de custo ao vivo (1.500 / 20.000)');
  await page.locator('[data-enviar]:visible').first().click();
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
  await page.fill('#n-rec-nome_completo', 'Ana Clara Souza'); await page.fill('#n-rec-cpf', '39053344705');
  await page.fill('#n-rec-data_nascimento', '1996-03-10'); await page.fill('#n-rec-email', 'ana.clara@exemplo.com');
  await page.fill('#n-rec-telefone', '98912345678');
  afirma(await page.isChecked('#n-rec-salvar'), '"Salvar como balconista" ligado');
  await page.locator('[data-enviar]:visible').first().click();
  await page.waitForFunction(() => /#\/campanhas\/\d+$/.test(location.hash));
  const d = await db(page);
  const b = d.balconistas.find(x => x.cpf === '39053344705' && x.empresa_id === 3);
  afirma(!!b, 'balconista criado na empresa 3');
  igual(+d.campanhas.at(-1).balconista_id, b.id, 'campanha ligada ao balconista novo');
});

teste('nova: CPF de quem já é balconista da empresa é barrado', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await escolherNoCombo(page, '#n-empresa', 'pet center', 'Pet Center Imperatriz');
  await page.selectOption('#n-pagamento', 'Swile');
  await page.check('input[name="n-pessoa"][value="outra"]');
  await page.fill('#n-rec-cpf', '11144477735');
  await page.locator('[data-enviar]:visible').first().click();
  afirma((await erroDo(page, 'n-rec-cpf').innerText()).includes('João Pedro Lima'), 'avisa de quem é o CPF');
});

teste('nova: cadastrar empresa pelo combo já seleciona a empresa criada', async ({ page }) => {
  await abrir(page, { rota: '#/nova' });
  await page.click('#n-empresa'); await page.keyboard.type('Pet Vida Cohatrac', { delay: 10 });
  await page.locator('.combo-criar').click();
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  igual(await d.locator('#de-nome').inputValue(), 'Pet Vida Cohatrac', 'nome vem do que foi digitado');
  await d.locator('#de-cidade').fill('São Luís');
  await d.locator('button[type="submit"]').click();
  await d.waitFor({ state: 'detached' });
  igual(await page.inputValue('#n-empresa'), 'Pet Vida Cohatrac', 'empresa selecionada');
  afirma((await db(page)).empresas.some(e => e.nome === 'Pet Vida Cohatrac'), 'gravada no banco');
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

teste('gestão: cadastrar empresa valida, recusa CNPJ repetido e abre a ficha', async ({ page }) => {
  await abrir(page, { rota: '#/gestao' });
  await page.click('#gs-nova');
  const d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('#de-nome').fill('X'); await d.locator('#de-cnpj').fill('123');
  await d.locator('button[type="submit"]').click();
  afirma(await d.locator('#de-nome-erro').isVisible(), 'nome curto');
  afirma(await d.locator('#de-cnpj-erro').isVisible(), 'CNPJ incompleto');
  await d.locator('#de-nome').fill('Pet Nova Ltda'); await d.locator('#de-cnpj').fill('11222333000181');
  igual(await d.locator('#de-cnpj').inputValue(), '11.222.333/0001-81', 'máscara de CNPJ');
  await d.locator('button[type="submit"]').click();
  await d.locator('.dialogo-erro:not([hidden]), #de-cnpj-erro:not([hidden])').first().waitFor();
  afirma(/CNPJ/i.test(await d.innerText()), 'CNPJ repetido explicado no diálogo');
  await d.locator('#de-cnpj').fill('');
  await d.locator('button[type="submit"]').click();
  await d.waitFor({ state: 'detached' });
  await page.waitForFunction(() => /#\/gestao\/empresas\/\d+$/.test(location.hash));
  igual(await titulo(page), 'Pet Nova Ltda', 'abre a ficha da empresa nova');
});

teste('gestão: ficha edita empresa, cadastra/edita/desativa balconista e desativa empresa', async ({ page }) => {
  await abrir(page, { rota: '#/gestao/empresas/2' });
  await page.click('#fx-editar');
  let d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('#de-cidade').fill('Imperatriz - MA'); await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  afirma((await page.locator('#conteudo').innerText()).includes('Imperatriz - MA'), 'cidade editada');

  await page.click('#fx-novo-balc');
  d = page.locator('dialog.dialogo'); await d.waitFor();
  await d.locator('#db-nome_completo').fill('Clara Mendes'); await d.locator('#db-cpf').fill('11144477735');
  await d.locator('#db-data_nascimento').fill('1999-07-01'); await d.locator('#db-email').fill('clara@exemplo.com'); await d.locator('#db-telefone').fill('99988776655');
  await d.locator('button[type="submit"]').click();
  await page.waitForTimeout(600);
  afirma(/João Pedro Lima|já/i.test(await d.innerText()), 'CPF repetido na empresa é barrado');
  await d.locator('#db-cpf').fill('714.602.380-01');
  await d.locator('button[type="submit"]').click(); await d.waitFor({ state: 'detached' });
  afirma((await page.locator('#conteudo').innerText()).includes('Clara Mendes'), 'balconista novo na lista');

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

  await page.click('#fx-ativo');
  const c2 = page.locator('dialog.dialogo'); await c2.waitFor(); await c2.locator('button[type="submit"]').click(); await c2.waitFor({ state: 'detached' });
  await page.locator('#fx-ativo', { hasText: 'Reativar' }).waitFor();
  igual((await db(page)).empresas.find(e => e.id === 2).ativo, false, 'empresa desativada');
  afirma(await page.locator('#fx-novo-balc').isDisabled(), 'empresa desativada não recebe balconista');
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
  igual(await n('Aprovada'), '2', 'aprovadas'); igual(await n('Reprovada'), '1', 'reprovadas');
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
  igual(await page.locator('#cp-itens .cartao').count(), 6, 'mostra todas');
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
  igual(await page.locator('#cp-itens .cartao').count(), 6, 'lista volta');
  igual(await page.evaluate(() => document.activeElement.id), 'cp-busca', 'foco volta para a busca');
  await page.fill('#cp-busca', 'zzzz'); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  igual(await page.inputValue('#cp-busca'), '', 'Esc limpa');
  igual(await page.locator('#cp-itens .cartao').count(), 6, 'lista volta depois do Esc');
  await page.click('#menu a[href="#/historico"]');
  await page.fill('#hs-busca', 'xyz'); await page.locator('[data-limpar-busca="hs-busca"]').click();
  igual(await page.inputValue('#hs-busca'), '', '× também no Histórico');
  await page.click('#menu a[href="#/gestao"]');
  await page.fill('#gs-busca', 'xyz'); await page.locator('[data-limpar-busca="gs-busca"]').click();
  igual(await page.inputValue('#gs-busca'), '', '× também na Gestão');
});

// ============================================================
//  10. TODAS AS TELAS × TAMANHOS: sem rolagem lateral, acessibilidade, capturas
// ============================================================
const TELAS = ['#/inicio', '#/campanhas', '#/campanhas/2', '#/nova', '#/historico', '#/gestao', '#/gestao/empresas/2', '#/perfil'];
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
    const graves = erros.filter(e => !/favicon|ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|Erro sem tradução/.test(e));
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
