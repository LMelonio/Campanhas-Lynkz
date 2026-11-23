# Clientes do Qlik e planilhas antigas: passo a passo

Duas cargas alimentam o cadastro de empresas e balconistas, para a Nova campanha já vir preenchida:

| Carga | De onde | O que entra | Quando |
|---|---|---|---|
| Clientes do Qlik | Qlik Cloud (mesmo tenant do Painel Vendedor), pela chave de API no `.env` | Empresas com código do cliente, razão social, nome fantasia, CNPJ, cidade, UF e vendedor | Todo dia (GitHub Actions) ou quando você rodar |
| Planilhas antigas | `Campanhas Setembro.xlsx`, `Campanhas Outubro 2026.xlsx` (e as próximas, no mesmo formato) | Empresas, balconistas (os 5 dados da Swile) e as campanhas como **Aprovadas / Importadas** | Uma vez por planilha |

Ordem recomendada: **1 → 2 → 3 → 4** (planilhas antes do Qlik: assim a sincronização liga as empresas das planilhas ao código do cliente pelo nome, sem criar cadastro duplicado). As duas cargas podem rodar de novo sem duplicar nada.

---

## 1. Banco: rodar a migração 07 (uma vez)

No Supabase → SQL Editor:

1. Cole `sql/migracoes/07-clientes-qlik-e-historico.sql` e clique em **Run**.
2. Cole `sql/migracoes/07-validacao.sql` e clique em **Run**. Esperado: 11 linhas com `ok = true`.

Só acrescenta colunas e funções; não muda nenhuma campanha. Para desfazer: `07-rollback.sql`.

## 2. Arquivo `.env` (uma vez, no seu computador)

1. Na raiz do projeto, copie `.env.exemplo` para `.env`.
2. Preencha:
   - `QLIK_API_KEY`: Qlik Cloud → seu perfil → Configurações → **Chaves de API** → Gerar nova chave. Pode ser a mesma que o Painel Vendedor usa.
   - `QLIK_APP_ID`: o ID do app com a base de vendas (aparece no endereço: `/sense/app/<ID>/…`).
   - `QLIK_CAMPO_*`: o nome **exato** dos campos no app. Os padrões são os da base de vendas (`Cód. Cliente`, `Razão Social Cliente`, `CPF CNPJ Cliente`, `Cidade`, `UF`, `Vendedor`). Se existir um campo de nome fantasia, ponha em `QLIK_CAMPO_FANTASIA`.
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → **service_role** (secret).
3. Rode uma vez `cd scripts && npm install && cd ..` (instala `ws` e `xlsx`, usados só pelos scripts; o app não muda).

O `.env` não vai para o GitHub (`.gitignore`) e não fica em `public/`. A chave service_role ignora as regras de segurança do banco: guarde como senha.

## 3. Planilhas antigas (set/out 2026)

```bash
npm run importar:planilhas -- "Campanhas Setembro 2026.xlsx" "Campanhas Outubro 2026.xlsx"
```

O script mostra quantas campanhas, empresas e balconistas vão entrar, com **avisos** (entram, mas confira) e **erros** (não entram). Depois:

- **Opção A, sem chave:** abra `dados-privados/historico-AAAA-MM-DD.sql`, cole no SQL Editor do Supabase e clique em Run.
- **Opção B, com o `.env`:** rode o mesmo comando com `--enviar` no fim.

Regras:

- **Código fixo** `H` + AAMM + nº da linha (ex.: `H2609001`). Rodar de novo não duplica.
- **Data da decisão:** a "Data Solicitação" da planilha; sem ela (setembro), o último dia do mês do nome do arquivo. O mês pode ser forçado: `arquivo.xlsx:2026-09`.
- **Empresa:** procurada pelo nome normalizado; se não existe, é criada. Nomes escritos de outro jeito ficam em `scripts/de-para-empresas.json` (já tem `A J P CORREA → A J P CORREIA`).
- **Balconista:** cadastrado na empresa com os 5 dados da Swile. Se aparece mais de uma vez com dados diferentes, o cadastro fica com a campanha mais recente, e cada campanha guarda o que estava na planilha.
- **Laboratório:** `Ourofino` vira `Ouro Fino` e `Mundo Animal` vira `Biogénesis Bagó Pet` (lista do `config.js`).
- **Solicitante:** se o nome bate com um usuário do app, a campanha fica ligada a ele (aparece em "Só as minhas").

A pasta `dados-privados/` tem CPF, e-mail e telefone: não envie por e-mail nem suba no GitHub (já está no `.gitignore`).

## 4. Clientes do Qlik

```bash
npm run qlik:simular     # lê o Qlik, NÃO grava; gera dados-privados/clientes-qlik-AAAA-MM-DD.json
npm run qlik:clientes    # lê o Qlik e grava no Supabase
```

Confira o JSON da simulação antes da primeira gravação: quantidade de clientes, nomes e cidades.

Como o banco decide, cliente a cliente:

1. Já existe empresa com aquele **código** → atualiza nome, fantasia, CNPJ, cidade, UF e vendedor.
2. Empresa sem código com o **mesmo CNPJ** → ganha o código (não duplica).
3. Empresa sem código com o **mesmo nome** (sem acento, pontuação e LTDA) → ganha o código. É assim que as empresas das planilhas se ligam ao Qlik.
4. Senão → empresa nova.

Nunca apaga nem desativa. Cliente pessoa física (CPF) entra sem CNPJ, pelo código.

Empresa do Qlik no app: nome, CNPJ e cidade ficam travados (o banco também recusa). Telefone, observações, balconistas e ativar/desativar continuam livres.

**Todo dia, sozinho:** em GitHub → Settings → Secrets and variables → Actions, crie os secrets `QLIK_API_KEY`, `QLIK_APP_ID` e `SUPABASE_SERVICE_ROLE_KEY`. O workflow `Clientes do Qlik` roda de segunda a sábado às 07:23 (horário de Brasília), depois da carga do Painel. Também dá para rodar na hora em Actions → Clientes do Qlik → Run workflow.

**Sem API:** exporte a tabela de clientes do Qlik para Excel (colunas com os mesmos nomes dos campos) e rode
`node scripts/sincronizar-clientes-qlik.mjs --arquivo clientes.xlsx` (com `--simular` para só conferir).

## Conferência depois das cargas

No SQL Editor:

```sql
select origem, count(*) from empresas group by origem;            -- app / qlik / planilha
select count(*), sum(investimento_lynkz) from campanhas where importada;
select nome from empresas where origem = 'planilha' and codigo_cliente is null order by nome;  -- ainda sem vínculo com o Qlik
```

As empresas da última consulta não bateram pelo nome com nenhum cliente do Qlik (nome fantasia diferente da razão social, por exemplo "Pets Village"). Duas saídas:

- **Ainda não existe a empresa do Qlik:** ponha o CNPJ nela pelo app (Gestão → Editar) e rode a sincronização de novo. Ela liga pelo CNPJ.
- **Já existem os dois cadastros** (o da planilha e o do Qlik): una no SQL Editor. Passa campanhas e balconistas para o cadastro do Qlik e desativa o outro; nada é apagado.

```sql
select id, nome, codigo_cliente, cidade from empresas where nome ilike '%village%';
select public.unir_empresas(<id da planilha>, <id do Qlik>);
```
