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
