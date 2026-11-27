-- ============================================================
--  19 — VALIDAÇÃO (só leitura). Esperado: 6 linhas, todas com ok = true.
--  Rode DEPOIS de 19-consulta-qlik-do-mes.sql. Linhas false = a migração não entrou.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.comissao_consultas') is not null,
      'tabela comissao_consultas existe'),
  (2, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.comissao_consultas')), false),
      'comissao_consultas com RLS ligada'),
  (3, (select count(*) = 3 from pg_policies where schemaname = 'public' and tablename = 'comissao_consultas' and cmd in ('SELECT', 'INSERT', 'UPDATE'))
      and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comissao_consultas' and cmd in ('DELETE', 'ALL')),
      'policies de ler, criar e alterar; nenhuma de apagar'),
  (4, to_regclass('public.comissao_consultas') is not null
      and not has_table_privilege('authenticated', 'public.comissao_consultas', 'delete')
      and not has_table_privilege('anon', 'public.comissao_consultas', 'select'),
      'ninguém apaga; visitante não lê'),
  (5, exists (select 1 from pg_trigger where tgname = 'ao_preparar_comissao_consulta' and not tgisinternal),
      'trigger de carimbo e trava do mês fechado ligado'),
  (6, to_regclass('public.comissao_consultas') is not null
      and not has_column_privilege('authenticated', 'public.comissao_consultas', 'consultado_por', 'UPDATE')
      and not has_column_privilege('authenticated', 'public.comissao_consultas', 'conferido_por', 'UPDATE'),
      'carimbos (quem consultou e quem conferiu) só pelo banco')
) t(n, ok, teste) order by n;
