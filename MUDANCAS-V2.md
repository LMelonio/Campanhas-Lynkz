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
