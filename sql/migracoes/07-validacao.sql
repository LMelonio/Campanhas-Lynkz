-- ============================================================
--  07 — VALIDAÇÃO (só leitura). Esperado: 11 linhas, todas com ok = true.
-- ============================================================
select n, ok, teste from (values
  (1, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'empresas'
        and column_name in ('codigo_cliente','nome_fantasia','uf','vendedor','origem','sincronizado_em')) = 6,
      'empresas tem as 6 colunas do Qlik'),
  (2, to_regclass('public.empresas_codigo_cliente_unico') is not null,
      'Código do cliente é único'),
  (3, public.cnpj_valido('11222333000181') and not public.cnpj_valido('11111111111111') and not public.cnpj_valido('11222333000182'),
      'cnpj_valido confere os dígitos'),
  (4, public.normalizar_nome('L Lazzarotti Reis LTDA') = public.normalizar_nome('L LAZZAROTTI REIS LTDA.'),
      'normalizar_nome ignora caixa, ponto e LTDA'),
  (5, exists (select 1 from pg_trigger where tgname = 'ao_proteger_qlik' and tgrelid = 'public.empresas'::regclass),
      'Dados do Qlik protegidos contra edição pelo app'),
  (6, not has_column_privilege('authenticated', 'public.empresas', 'codigo_cliente', 'INSERT,UPDATE')
      and not has_column_privilege('authenticated', 'public.empresas', 'origem', 'INSERT,UPDATE'),
      'App não grava código nem origem'),
  (7, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'campanhas_app' and column_name = 'importada'),
      'View campanhas_app entrega "importada"'),
  (8, not has_column_privilege('authenticated', 'public.campanhas', 'importada', 'INSERT,UPDATE'),
      'App não marca campanha como importada'),
  (9, not has_function_privilege('authenticated', 'public.importar_clientes_qlik(jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.importar_clientes_qlik(jsonb)', 'EXECUTE'),
      'App não executa a carga do Qlik'),
  (10, not has_function_privilege('authenticated', 'public.importar_historico_planilha(jsonb)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.importar_historico_planilha(jsonb)', 'EXECUTE'),
      'App não executa a carga das planilhas'),
  (11, not has_function_privilege('authenticated', 'public.unir_empresas(bigint, bigint)', 'EXECUTE'),
      'App não une empresas (só o SQL Editor)')
) t(n, ok, teste) order by n;
