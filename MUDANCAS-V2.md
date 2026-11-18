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
