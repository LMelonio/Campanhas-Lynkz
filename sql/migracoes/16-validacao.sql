-- ============================================================
--  16 — VALIDAÇÃO (só leitura). Esperado: 8 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, to_regclass('public.comissionados') is not null and to_regclass('public.comissao_parametros') is not null
      and to_regclass('public.comissao_auditoria') is not null,
      'tabelas comissionados, comissao_parametros e comissao_auditoria existem'),
  (2, (select count(*) = 1 from public.comissao_parametros where id = 1),
      'parâmetros com uma linha só'),
  (3, (select bool_and(relrowsecurity) from pg_class where oid in
        ('public.comissionados'::regclass, 'public.comissao_parametros'::regclass, 'public.comissao_auditoria'::regclass)),
      'RLS ligado nas três tabelas'),
  (4, not has_table_privilege('anon', 'public.comissionados', 'select')
      and not has_table_privilege('anon', 'public.comissao_parametros', 'select'),
      'visitante sem login não lê nada'),
  (5, not has_table_privilege('authenticated', 'public.comissionados', 'delete')
      and not has_table_privilege('authenticated', 'public.comissao_auditoria', 'insert'),
      'ninguém apaga comissionado nem escreve na auditoria pela API'),
  (6, exists (select 1 from pg_trigger where tgname = 'ao_preparar_comissionado' and not tgisinternal)
      and exists (select 1 from pg_trigger where tgname = 'ao_auditar_comissionado' and not tgisinternal),
      'triggers de preparo e auditoria ligados'),
  (7, (select count(*) = 6 and bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%eh_aprovador%')
         from pg_policies where schemaname = 'public'
          and tablename in ('comissionados', 'comissao_parametros', 'comissao_auditoria')),
      'políticas só para administrador'),
  (8, not exists (
        select 1 from public.comissionados a join public.comissionados b on a.id < b.id and a.ativo and b.ativo
         where a.nomes_qlik && b.nomes_qlik),
      'nenhum nome do Qlik em dois comissionados ativos')
) t(n, ok, teste) order by n;
