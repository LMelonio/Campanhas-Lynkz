# Privacidade dos dados pessoais — situação atual (v2.0.0)

Substitui o antigo `PRIVACIDADE-SWILE.md`.

## Decisão registrada (18/11/2026)

| Dado | Quem vê |
|---|---|
| Dados do recebedor Swile gravados na campanha (`swile_*`: nome, CPF, nascimento, e-mail, telefone) | Só o aprovador e o coordenador que fez a solicitação. |
| Cadastro de balconistas (nome, CPF, nascimento, e-mail, telefone) | Todo usuário **ativo** do app. |
| Usuário desativado ou visitante sem login | Nada. |

O cadastro de balconistas é compartilhado de propósito: qualquer coordenador precisa escolher
o balconista de uma empresa ao montar uma campanha, sem redigitar os dados.

## Como está garantido (no banco, não só na tela)

- **Campanhas:** a permissão de ler as colunas `swile_*` na tabela `campanhas` é retirada de todo
  usuário logado. O app lê a view `campanhas_app`, que devolve esses campos só a quem pode
  (`swile_visivel`). O tempo real do Supabase checa a mesma permissão por coluna e não envia os
  campos nos eventos. Consulta direta pelo console dá *permission denied*.
- **Empresas e balconistas:** RLS com `eh_ativo()` em leitura, cadastro e edição. Sem login ou com
  acesso desativado, a consulta volta vazia (ou é recusada). Não existe permissão de apagar.
- **Rascunho no aparelho:** o formulário de nova campanha guarda rascunho no `localStorage`
  **sem os 5 dados pessoais**. Guarda só a empresa e o balconista escolhido; ao voltar, os dados
  vêm de novo do cadastro (que o banco protege). "Outra pessoa" digitada à mão não fica salva.
  Sair da conta apaga o rascunho.
- **Excel:** sai com os dados Swile só das campanhas que a pessoa pode ver.

## Riscos que continuam

- Quem tem acesso de administrador ao painel do Supabase vê tudo.
- Quem baixa o Excel leva os dados para fora do app; o arquivo passa a ser responsabilidade de quem baixou.
- Todo usuário ativo vê o cadastro completo dos balconistas (decisão de negócio acima). Para restringir
  no futuro, o caminho é o mesmo das campanhas: retirar a leitura das colunas e servir por uma view.

## Para conferir

`sql/migracoes/03-validacao.sql` (comportamento: coordenador, aprovador, desativado, visitante) e
`sql/migracoes/06-validacao-v2.sql` (estrutura da v2, 12 linhas `true`).
