# Mudanças da v2.12.0 (24/11/2026) — mais de um laboratório por campanha

Sem mudança de banco.
- **Nova campanha:** o campo agora é "Laboratórios" e aceita 1 ou mais. Cada laboratório escolhido vira um botão com ×
  logo abaixo do campo (clicar tira), e o campo fica livre para acrescentar o próximo. Quem já foi escolhido some da lista.
  Rascunho, reenviar e "Usar como modelo" trazem todos.
- **Compras no Qlik:** a consulta soma o que o cliente comprou de todos os laboratórios escolhidos (até 5), com as notas
  de todos. "Recurso próprio" não entra na consulta e a tela avisa. Vale também para "Conferir no Qlik agora" no detalhe.
- **Gravação:** os laboratórios vão juntos na coluna de sempre ("Ouro Fino, Avert"): cartões, detalhe, histórico, Excel e
  e-mail mostram assim, sem mudança. O filtro de laboratório da lista de Campanhas acha a campanha por qualquer um deles.

# Mudanças da v2.11.1 (27/11/2026) — ADP sem nomes

Sem mudança de banco.
- O PDF da ADP não leva mais "Elaborado por", o nome de quem assina nem o campo "Data: __/__/__": a identificação e a data
  vêm da assinatura no SignZoo. Fica só "Emitido em <data de hoje>" e o quadro "Assinatura do autorizante do pagamento".
- Saiu do diálogo o campo "Quem assina a autorização" (e `ADP.AUTORIZANTE` do `config.js`).

# Mudanças da v2.11.0 (27/11/2026) — ADP em PDF, com edição antes de gerar

Sem mudança de banco. Substitui a ADP em Excel da v2.10.0.
- **Gerar ADP** (Campanhas e Histórico, todos os usuários) agora baixa **`ADP - CAMPANHAS - <MÊS> <ANO>.pdf`**, uma página A4
  deitada pronta para o SignZoo: logos, faixa com empresa pagadora, loja, departamento, forma, **vencimento** e **total**;
  tabela **Campanhas** (cliente | tipo | observação ao fiscal | valor) com o total geral; tabela **Dados dos recebedores**
  (empresa pagadora | favorecido | forma | CPF | **nascimento** | e-mail Swile | R$) — sem a coluna de vencimento, que já está
  na faixa de cima; e o quadro da assinatura com o nome de quem assina. Lista grande vira mais páginas, com o cabeçalho
  da tabela repetido e "Página X de Y".
- **Editar antes de gerar:** em cada campanha, "Editar dados desta linha" abre cliente, tipo, observação ao fiscal,
  favorecido, CPF, e-mail e nascimento (já preenchidos). Valor a pagar, vencimento e "Quem assina a autorização" também
  mudam no diálogo. Tudo é conferido (CPF, e-mail, nascimento no passado) e a linha com erro abre sozinha.
  **As edições valem só para o PDF:** a campanha não muda.
- Quem recebe: dados Swile da campanha; se o usuário não pode vê-los, o cadastro do balconista; campanha de outra pessoa
  sem balconista cadastrado fica no fim, bloqueada, com o motivo.
- Textos fixos em `config.js` → `ADP` (agora com `AUTORIZANTE`).
- **pdf-lib 1.17.1** (MIT, módulo ES) em `public/vendor/`, carregado só ao gerar a ADP; o ExcelJS saiu. Testado com a CSP de produção.

# Mudanças da v2.10.0 (26/11/2026) — Gerar ADP (Excel; substituída pela v2.11.0)

# Mudanças da v2.9.1 (25/11/2026) — barra de baixo no celular

Sem mudança de banco.
- **Barra de baixo:** o botão "Menu" virou **"Perfil"**. Havia dois botões para o mesmo menu lateral (☰ no topo e Menu embaixo);
  agora o menu abre só pelo ☰ do topo, e o Perfil fica a um toque.
- **Aviso no ☰:** administrador com conta esperando liberação vê um ponto vermelho no ☰ (o item Usuários, com o número, está dentro do menu).
- **Toast:** o botão "Desfazer" não quebra mais em duas linhas ("DESFAZ / ER") no celular.

# Mudanças da v2.9.0 (24/11/2026) — origem: MELHORIAS-V2.9.md

**Banco — rodar `sql/migracoes/13-devolucoes-da-consulta.sql` ANTES de publicar o site (depois `13-validacao.sql`: 5 linhas `true`; desfazer: `13-rollback.sql`)**
- `campanhas.compras_devolucoes` e `compras_devolvidas` (até R$ 10 milhões e 50 notas); `enviar_campanha` grava as duas.
- Com a 13 no banco e o site ainda na 2.8.1, enviar campanha continua funcionando (as colunas ficam vazias).

**Correções**
- **Devoluções (A1):** o total do Qlik já desconta as devoluções, mas a nota devolvida vinha com o valor cheio e a soma
  das notas passava do total. Agora a nota de provável devolução (valor que fecha com o devolvido na série) aparece
  riscada, com o selo "Provável devolução", fora da soma e sem poder marcar; e a linha
  **"Devoluções no período: −R$ X (Y notas)"** fecha a conta. O detalhe mostra igual ao aprovador, e a conferência
  no Qlik compara total e devoluções. Excel ganhou a coluna "Devoluções no período (Qlik)".
- **Versão misturada (A2):** logo depois de publicar, a tela podia abrir com módulos da versão anterior. O app agora
  percebe, limpa as cópias guardadas e recarrega uma vez ("Atualizando para a versão…"), sem loop.
- **Ordem de publicação (A3):** quadro "Banco primeiro, site depois" no `PUBLICAR.md` e no `COMECE-AQUI.md`.

**Celular**
- **Nova campanha em 3 passos (B1)**, abaixo de 900 px: Cliente → Valores → Quem recebe e revisão. "Continuar" confere
  só o passo; "Enviar" leva ao passo do primeiro erro; o passo fica no rascunho. No computador, continua uma página só.
- **Notas recolhidas (B2):** com mais de 5, aparecem as 5 primeiras e "Ver todas as N notas" (Nova e detalhe).
- **Ajustes (D1–D5):** buscas com texto de exemplo curto; filtros de status numa linha só; os 3 números da ficha da
  empresa na mesma linha; Histórico em cartões (com a data e quem decidiu); textos de leitura em 13 px.

**Aprovador**
- **Aprovar e reprovar na lista (C1):** botões no cartão das campanhas pendentes, com o mesmo comportamento do detalhe
  (5 s para desfazer; motivo obrigatório na reprova).
- **Contas esperando liberação (C2):** número no menu "Usuários" e aviso no Início.
- **Aviso por e-mail (C3):** plano em `NOTIFICACOES.md` e função pronta em `supabase/functions/avisar-aprovador/`.
  **Não publicada** (precisa de conta no Resend e segredos no Supabase).

**Desempenho (E1):** a abertura lê só as colunas usadas e só as empresas ativas (as desativadas vêm sob demanda).
Medido na produção: −14% no volume das empresas e −49% no dos balconistas.

# Mudanças da v2.8.1 (23/11/2026) — consulta de compras no Qlik

Teste em produção (v2.6.0): a consulta devolvia **R$ 0,00 para qualquer cliente, laboratório e período**
(12 clientes × Ouro Fino em 12 meses, padrões genéricos como `*ltda*` e `marca:WELLPET`, sem erro).
**Causa (achada com o diagnóstico no Qlik real):** o app do Qlik abre com as **seleções salvas** de quem usou
por último (hoje: Ano 2026, jul/2026, Categoria 2 = PLANTAS NATURAIS). A consulta usava `Sum({<…>} …)`, que
parte dessas seleções, e a busca do período (`[Data Venda]={"=Num(…)…"}`) também era avaliada dentro delas.

- **Correção da consulta:** `Sum({1<…>} …)` e `Only({1} Num([Data Venda]))` no período: ignoram as seleções e aplicam
  só os filtros do app. Conferido no Qlik real: o total do período bate com o campo `Ano Venda` (2025 e 2026).
- **Sincronização de clientes:** tinha o mesmo defeito — trazia os clientes da seleção salva (4.908, quase todos de
  varejo). Agora conta só linhas de atacado (`Unidade de Negócio = ATACADO`, `Intercompany Geral = REGULAR`) ignorando
  as seleções: 2.474 clientes. Clientes de varejo que já entraram continuam no app (a sincronização não apaga).
- **Worker:** com total zero, devolve também `cliente_total` (tudo o que o cliente comprou no período, sem o laboratório).
- **Nova campanha:** a mensagem diz se o cliente comprou de outros laboratórios ou se o Qlik não devolve nada
  dele (e manda avisar o TI). Saiu o texto técnico "LABORATORIO_QLIK (public/config.js)" e o "de o laboratório".
- **Período:** o último dia entra inteiro (`< fim + 1`), mesmo se a data do Qlik vier com hora.
- **Novo script** `npm run qlik:diagnosticar` (só lê): mostra em qual filtro o valor zera. Ver NOTAS-FISCAIS-QLIK.md.

# Mudanças da v2.8.0 (23/11/2026) — usuários no app e balconistas por empresa

**Banco — rodar `sql/migracoes/12-usuarios-e-balconistas.sql` (depois `12-validacao.sql`; desfazer: `12-rollback.sql`)**
- Função `definir_perfil()`: o administrador libera contas, escolhe administrador ou usuário e troca o nome, pelo app.
  Ninguém tira o próprio papel de administrador nem o próprio acesso. Tudo continua em `auditoria_perfis`.
- Gatilho `limitar_balconistas_empresa`: no máximo 2 balconistas por empresa, contando os desativados.
- Sem administrador ainda? Rode uma vez o "PRIMEIRO ADMINISTRADOR" do topo da migração 12.

**Usuários (menu novo, só para administrador)**
- Contas novas aparecem em "Sem acesso" com **Liberar acesso** de um toque.
- "Editar" troca nome, papel (Administrador / Usuário) e acesso. Dar ou tirar administrador pede confirmação.
- Na tela inteira o papel aparece como **Administrador** ou **Usuário** (antes: Aprovador / Coordenador).

**Gestão**
- "Cadastrar empresa" saiu (as empresas vêm do Qlik). No lugar: **Cadastrar balconista**, que primeiro pede a empresa
  (a lista mostra "x de 2 balconistas" e avisa quando está no limite) e só então libera os dados.
- Lista e ficha mostram as vagas ("Balconistas: 1 de 2"). Com 2 cadastros, "Cadastrar" fica travado e a ficha explica
  que, para trocar a pessoa, edita-se o cadastro.

**Nova campanha**
- O combo de empresa não cadastra mais empresa; sem resultado, explica que o cliente novo é cadastrado no sistema (Qlik).
- Com 2 balconistas na empresa, "Outra pessoa" some: escolhe-se um dos dois.

# Mudanças da v2.7.0 (23/11/2026) — origem: MELHORIAS-V2.7.md

**Banco — rodar `sql/migracoes/11-enviar-campanha.sql` (depois `11-validacao.sql`; desfazer: `11-rollback.sql`)**
- Nova função `enviar_campanha()` (security invoker): balconista, campanha e notas fiscais são gravados
  **numa transação só**. Campanha recusada não deixa balconista novo para trás.

**Nova campanha**
- % de rebate limitado a 0–100 na tela; meta, investimentos, teto e tamanhos de texto seguem os mesmos
  limites do banco (`LIMITES` em `lib/regras.js`; `tests/regras.test.mjs` confere com `sql/schema.sql`).
- Com rebate ligado, "Base de cálculo" e "Quando o rebate é devido" são obrigatórios.
- Enviar sem período ou sem meta pergunta ("Enviar sem período e meta?") e deixa seguir.
- A lista de empresas não abre sozinha quando já há empresa escolhida (só no clique, seta ou ao digitar).
- Depois de enviar, a lista de Campanhas mostra a nova (tira o filtro de laboratório/busca se escondia).
- Início e Fim (e CPF/Nascimento) ficam alinhados quando só um mostra erro.

**Erros, buscas e textos**
- Erros de limite do banco (`campanhas_valores_faixa`, `campanhas_textos_tamanho`) têm mensagem própria.
- Busca de empresa acha o CNPJ com ou sem pontuação (Gestão e Nova).
- "1 campanha"/"N campanhas" no rodapé do Início; título da aba "Campanhas · LYNKZ"; topo sem "Início" no primeiro desenho.
- Desativar empresa avisa quantas campanhas pendentes continuam na fila.
- Nome do Excel cita o laboratório filtrado (ex.: `Campanhas_Todas_Avert_2026-11-23.xlsx`).
- Login apaga a chave de sessão do projeto Supabase antigo.

**Fica para depois (ver MELHORIAS-V2.7.md):** 3.3 (manter empresa no modelo), 3.7 (e-mail ao aprovador),
3.8 (tela de usuários), 3.9 (histórico das planilhas), 4 (leitura de perfis) e a parte de operação (seção 0).

# Mudanças da v2.1.0 (18/11/2026) — UX/UI

**Banco desatualizado e erros**
- Se o banco não tiver as tabelas desta versão, o app mostra **"Sistema em atualização"** (com
  "Detalhes para o TI" e "Tentar de novo") em vez de um erro em inglês.
- Falha ao carregar vira uma **faixa fixa** abaixo do topo, com "Tentar de novo", e as listas dizem
  **"Não foi possível carregar"** em vez de "Nada encontrado".
- Nenhum texto técnico em inglês na tela: o original vai para o console.

**Acesso e conta**
- Campo de senha com **olho** (mostrar/ocultar), aviso de **Caps Lock** e medidor de força na senha nova.
- Login: "Esqueci minha senha" ao lado do rótulo, **"Lembrar meu e-mail neste aparelho"** (só o e-mail),
  erro embaixo do campo com o texto selecionado e, depois de 3 erros, link para redefinir.
- **Alterar senha** no Perfil, sem sair da conta. **Sair** com rascunho pede confirmação.

**Início e listas**
- Card da fila em duas linhas ("3 campanhas" / "R$ 8.700 em custo total"); valor em reais nunca quebra.
- Os 4 números do mês são **clicáveis** e abrem a lista filtrada, com chip "×" para tirar o filtro.
- Busca com **×** para limpar (e Esc) em Campanhas, Histórico e Gestão.

**Detalhe e decisão**
- Topo com o nome da campanha; legenda da régua sem partes zeradas ("Tudo LYNKZ · R$ 600,00").
- **Copiar** CPF, e-mail, telefone, código e "Copiar dados do pagamento".
- Barra de decisão com **custo total e % da meta**.
- **Atalhos no computador:** A aprova, R reprova, J/K próxima/anterior, ? mostra a lista.

**Nova campanha**
- Sem teclado subindo sozinho no celular. "Rascunho salvo às hh:mm".
- Atalhos de período: **Este mês**, **Próximo mês**, **30 dias**; duração ao lado do Fim.
- **"Usar como modelo"** em qualquer campanha (sem copiar as datas).

**Histórico, Perfil e abertura**
- **"Baixar Excel desta lista"** em Campanhas e Histórico (só o que está filtrado na tela).
- Perfil com o último acesso.
- Abertura mais rápida: os módulos são baixados de uma vez (`modulepreload`).

Testes: 15 de regras, 70 de navegador (eram 44), acessibilidade sem problemas graves também no modo escuro.

# Mudanças da v2.0.1 (18/11/2026)

- **Publicação no Cloudflare** a partir do GitHub (`wrangler.jsonc`, `PUBLICAR.md`). O Netlify sai.
- O site agora é **só a pasta `public/`**: `sql/`, `tests/`, `dev/` e documentação nunca vão para o ar,
  em qualquer hospedagem. Modelo de **nginx** para o servidor da empresa (`deploy/`).
- **Correção:** editar empresa ou balconista na Gestão não atualizava a ficha na tela.
- **Correção:** sem internet, o app instalado não abriria depois da mudança para o Cloudflare
  (o service worker guardava `index.html`, que o Cloudflare redireciona).
- **Testes automáticos** em quatro camadas, rodando no GitHub a cada push (`TESTES.md`).
- Servidor local sem instalar nada: `node dev/servidor.mjs`.
- Removidos o `app.js` da v1 que tinha ficado na raiz e o `_redirects` do Netlify.
- Testes de navegador: rodam também no Windows (`import()` com URL `file://`), e o teste do Excel
  deixou de ser pulado (o pacote `xlsx` não exporta `package.json`).
- `.gitattributes` mantém LF em todos os arquivos de texto.

# Mudanças da v2.0.0

## Novidades

- **Gestão de empresas e balconistas.** Toda empresa cliente fica cadastrada (nome, CNPJ, cidade,
  telefone), com seus balconistas. Ficha da empresa mostra quanto já foi investido em campanhas
  aprovadas, os balconistas e as campanhas dela. Nada é apagado: desativa e reativa.
- **Nova campanha mais rápida.** Empresa escolhida do cadastro (ou cadastrada na hora, sem sair do
  formulário). Com pagamento Swile ou campanha de balconista, escolher o balconista preenche os 5
  dados; se algo mudou, o app oferece atualizar o cadastro.
- **Resumo de custo ao vivo** enquanto preenche: total, composição e faixa da régua.
- **Aprovar com "Desfazer".** Aprovar espera 5 segundos e depois abre a próxima pendente.
  Reprovar tem motivos rápidos.
- **Reenviar com ajustes:** campanha reprovada vira uma nova já preenchida.
- **Computador de verdade:** menu lateral, lista e detalhe lado a lado, tabela no histórico.
- **Modo escuro** automático, seguindo o celular.
- **Excel** com CNPJ, cidade e balconista; coluna nova não desalinha a formatação.

## Problema da v1 → solução na v2

| Problema na v1 | Solução na v2 |
|---|---|
| Nome do cliente digitado à mão, cada um de um jeito | Cadastro de empresas; `cliente` recebe o nome oficial |
| Dados do recebedor Swile redigitados a cada campanha | Cadastro de balconistas, escolhidos numa lista |
| Data da decisão gravada em UTC (decisão às 21h30 virava o dia seguinte) | Data no fuso `America/Fortaleza`, no banco e no app |
| `2.000` digitado no valor virava R$ 2,00 | Campo de valor em pt-BR (`lerValor`) |
| Tela inteira redesenhada a cada evento ao vivo: perdia rolagem, foco e o que estava sendo digitado | Tempo real relê só a linha; listas redesenham só a lista; formulário nunca |
| Voltar do Android saía do app | Rotas por endereço (`#/campanhas/12`) com histórico |
| Toast cobria os botões de decisão | Toast no alto à direita no desktop |
| Aprovação por engano sem volta | 5 s com "Desfazer" |
| Duas pessoas aprovando a mesma campanha: a segunda não sabia | "Esta campanha já foi aprovada por …" |
| Texto cinza claro com contraste 2,5:1 | Toda letra com contraste ≥ 4,5:1 |
| Erros só por toast, sem dizer qual campo | Erro em cada campo, foco no primeiro |
| HTML montado concatenando texto (risco de injeção) | `html\`\`` escapa tudo por padrão |
| Biblioteca do Supabase sem versão fixa | Versão fixa `2.119.0`; SheetJS oficial só ao exportar |
| Sem cabeçalhos de segurança; `schema.sql` e `.md` publicados junto | CSP em `_headers`; `_redirects` bloqueia `sql/`, `tests/`, `dev/` e `.md` |
| App lia a tabela direto se a view não existisse | Lê sempre `campanhas_app` |
| Um arquivo de 1.100 linhas | Módulos por assunto, regras puras com 14 testes |

## Banco

Migrações `04` (empresas e balconistas), `05` (fuso da decisão) e `06` (validação), com rollback.
Testadas num Postgres local imitando o Supabase: aplicar, validar, testar como coordenador ativo,
desativado e aprovador, desfazer e reaplicar. Ver `COMECE-AQUI.md`, Parte 0.
