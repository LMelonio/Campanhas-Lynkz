-- ============================================================
--  07 — CLIENTES DO QLIK E HISTÓRICO DAS PLANILHAS (v2.3.0)
--
--  1. empresas ganha os dados do cadastro do Qlik: código do cliente,
--     nome fantasia, UF, vendedor, origem e data da última sincronização.
--     Nome, CNPJ e cidade de empresa do Qlik só mudam pela sincronização
--     (o app não consegue alterá-los; telefone e observações continuam livres).
--  2. CNPJ passa a ter os dígitos verificadores conferidos no banco
--     (cnpj_valido), como o CPF. NOT VALID: não reprova o que já está gravado.
--  3. campanhas ganha "importada" (campanha que veio de planilha antiga).
--     O app não consegue gravar essa coluna.
--  4. Duas funções de carga, que só o SQL Editor e a chave service_role
--     executam (nunca o app):
--       importar_clientes_qlik(jsonb)      → scripts/sincronizar-clientes-qlik.mjs
--       importar_historico_planilha(jsonb) → scripts/importar-planilhas.mjs
--
--  Só acrescenta. Não altera nem apaga campanha, empresa ou balconista.
--  Pode rodar duas vezes. Para desfazer: 07-rollback.sql.
--  Depois de rodar: 07-validacao.sql (todas as linhas com "t").
-- ============================================================

-- ---------- funções de apoio ----------
-- CNPJ: dígitos verificadores (módulo 11) e sem sequência repetida.
-- Mesma regra de cnpjValido() em public/js/lib/regras.js.
create or replace function public.cnpj_valido(cnpj text)
returns boolean language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(cnpj,''), '\D', '', 'g');
  pesos1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  pesos2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  soma int; resto int; dv1 int; dv2 int; k int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  soma := 0;
  for k in 1..12 loop soma := soma + substring(d from k for 1)::int * pesos1[k]; end loop;
  resto := soma % 11; dv1 := case when resto < 2 then 0 else 11 - resto end;
  if dv1 <> substring(d from 13 for 1)::int then return false; end if;
  soma := 0;
  for k in 1..13 loop soma := soma + substring(d from k for 1)::int * pesos2[k]; end loop;
  resto := soma % 11; dv2 := case when resto < 2 then 0 else 11 - resto end;
  return dv2 = substring(d from 14 for 1)::int;
end $$;

-- Nome para comparar cadastros: sem acento, sem pontuação, maiúsculo e sem
-- LTDA/ME/EPP/EIRELI/SA. "L Lazzarotti Reis LTDA" = "L LAZZAROTTI REIS LTDA".
create or replace function public.normalizar_nome(t text)
returns text language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               upper(translate(coalesce(t,''),
                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
               '[^A-Z0-9 ]', ' ', 'g'),
             '\m(LTDA|ME|EPP|EIRELI|SA|S A)\M', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- ---------- EMPRESAS: dados do Qlik ----------
alter table public.empresas add column if not exists codigo_cliente  text;
alter table public.empresas add column if not exists nome_fantasia   text;
alter table public.empresas add column if not exists uf              text;
alter table public.empresas add column if not exists vendedor        text;
alter table public.empresas add column if not exists origem          text not null default 'app';
alter table public.empresas add column if not exists sincronizado_em timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'empresas_origem_valida') then
    alter table public.empresas add constraint empresas_origem_valida check (origem in ('app','qlik','planilha'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'empresas_cnpj_dv') then
    alter table public.empresas add constraint empresas_cnpj_dv check (cnpj is null or public.cnpj_valido(cnpj)) not valid;
  end if;
end $$;
create unique index if not exists empresas_codigo_cliente_unico on public.empresas (codigo_cliente) where codigo_cliente is not null;
create index if not exists idx_empresas_nome_normalizado on public.empresas (public.normalizar_nome(nome));

-- Nome, CNPJ e cidade de empresa do Qlik vêm do Qlik. Pelo app (usuário
-- logado), só telefone, observações e ativo mudam. A sincronização roda
-- com a chave service_role (sem usuário logado) e passa.
create or replace function public.proteger_dados_qlik()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.codigo_cliente is not null
     and (new.nome, new.cnpj, new.cidade) is distinct from (old.nome, old.cnpj, old.cidade) then
    raise exception 'Nome, CNPJ e cidade desta empresa vêm do Qlik e não podem ser alterados no app.';
  end if;
  return new;
end $$;
revoke execute on function public.proteger_dados_qlik() from public, anon, authenticated;

drop trigger if exists ao_proteger_qlik on public.empresas;
create trigger ao_proteger_qlik
  before update on public.empresas
  for each row execute function public.proteger_dados_qlik();

-- As colunas novas NÃO entram nos grants de insert/update do app
-- (continuam só nome, cnpj, cidade, telefone, observacoes, ativo).
-- A leitura (grant select na tabela) já cobre as colunas novas.

-- ---------- CAMPANHAS: marca de importada ----------
alter table public.campanhas add column if not exists importada boolean not null default false;

-- Mesma função do schema, agora sem deixar o app gravar "importada".
create or replace function public.reaplicar_permissoes_campanhas()
returns void language plpgsql security definer set search_path = public as $$
declare
  cols_view   text;
  cols_select text;
  cols_insert text;
begin
  select string_agg('c.' || quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols_view, cols_select
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not like 'swile\_%';

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_insert
  from information_schema.columns
  where table_schema = 'public' and table_name = 'campanhas'
    and column_name not in ('id','codigo','criado_em','aprovador_nome','data_decisao','motivo','importada');

  execute 'drop view if exists public.campanhas_app';
  execute format($v$
    create view public.campanhas_app with (security_invoker = true) as
    select %s,
           s.swile_nome_completo, s.swile_cpf, s.swile_data_nascimento,
           s.swile_email, s.swile_telefone,
           public.pode_ver_swile(c.solicitante_id) as swile_visivel
    from public.campanhas c
    left join lateral public.swile_da_campanha(c.id) s on true
  $v$, cols_view);
  execute 'revoke all on public.campanhas_app from public, anon, authenticated';
  execute 'grant select on public.campanhas_app to authenticated';

  execute 'revoke all on public.campanhas from anon';
  execute 'revoke select, insert, update, delete, truncate, references, trigger on public.campanhas from authenticated';
  execute format('grant select (%s) on public.campanhas to authenticated', cols_select);
  execute format('grant insert (%s) on public.campanhas to authenticated', cols_insert);
  execute 'grant update (status, motivo) on public.campanhas to authenticated';
end $$;
revoke execute on function public.reaplicar_permissoes_campanhas() from public, anon, authenticated;

select public.reaplicar_permissoes_campanhas();

-- ============================================================
--  CARGA 1 — CLIENTES DO QLIK
--  Recebe um array JSON: [{codigo, nome, fantasia, documento, cidade, uf, vendedor}]
--  Para cada cliente, nesta ordem:
--    a) já existe empresa com o código      → atualiza os dados do Qlik
--    b) empresa sem código com o mesmo CNPJ → vincula (ganha o código)
--    c) empresa sem código com o mesmo nome (normalizado, um único resultado)
--       → vincula. É assim que as empresas das planilhas ganham o código.
--    d) senão                               → cadastra nova (origem qlik)
--  Nunca desativa nem apaga: cliente que sumiu do Qlik continua como está.
--  CNPJ inválido ou já usado por outra empresa fica de fora (conta em cnpj_ignorado).
-- ============================================================
create or replace function public.importar_clientes_qlik(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r          jsonb;
  v_codigo   text; v_nome text; v_fantasia text; v_doc text; v_cnpj text;
  v_cidade   text; v_uf text; v_vendedor text;
  v_id       bigint;
  v_ids      bigint[];
  n_novas int := 0; n_atual int := 0; n_cnpj int := 0; n_nome int := 0; n_cnpj_ign int := 0; n_sem int := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Envie um array JSON de clientes.'; end if;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_codigo   := nullif(btrim(r->>'codigo'), '');
    v_nome     := nullif(btrim(regexp_replace(r->>'nome', '\s+', ' ', 'g')), '');
    v_fantasia := nullif(btrim(regexp_replace(r->>'fantasia', '\s+', ' ', 'g')), '');
    v_doc      := regexp_replace(coalesce(r->>'documento',''), '\D', '', 'g');
    v_cidade   := nullif(btrim(r->>'cidade'), '');
    v_uf       := nullif(upper(btrim(r->>'uf')), '');
    v_vendedor := nullif(btrim(r->>'vendedor'), '');
    if v_codigo is null or coalesce(char_length(v_nome), 0) < 2 then n_sem := n_sem + 1; continue; end if;

    -- Só CNPJ válido entra (CPF de pessoa física fica de fora: a coluna é de CNPJ).
    v_cnpj := case when public.cnpj_valido(v_doc) then v_doc end;

    v_id := null;
    select id into v_id from empresas where codigo_cliente = v_codigo;
    if v_id is null and v_cnpj is not null then
      select id into v_id from empresas where codigo_cliente is null and cnpj = v_cnpj;
      if v_id is not null then n_cnpj := n_cnpj + 1; end if;
    end if;
    if v_id is null then
      select array_agg(id) into v_ids from empresas
       where codigo_cliente is null
         and normalizar_nome(nome) in (normalizar_nome(v_nome), normalizar_nome(v_fantasia));
      if array_length(v_ids, 1) = 1 then v_id := v_ids[1]; n_nome := n_nome + 1; end if;
    end if;

    -- CNPJ já em outra empresa: não troca, para não quebrar o índice único.
    if v_cnpj is not null and exists (select 1 from empresas where cnpj = v_cnpj and id is distinct from v_id) then
      v_cnpj := null; n_cnpj_ign := n_cnpj_ign + 1;
    end if;

    if v_id is null then
      insert into empresas (nome, nome_fantasia, cnpj, cidade, uf, vendedor, codigo_cliente, origem, sincronizado_em)
      values (v_nome, v_fantasia, v_cnpj, v_cidade, v_uf, v_vendedor, v_codigo, 'qlik', now());
      n_novas := n_novas + 1;
    else
      update empresas set
        codigo_cliente  = v_codigo,
        nome            = v_nome,
        nome_fantasia   = coalesce(v_fantasia, nome_fantasia),
        cnpj            = coalesce(v_cnpj, cnpj),
        cidade          = coalesce(v_cidade, cidade),
        uf              = coalesce(v_uf, uf),
        vendedor        = coalesce(v_vendedor, vendedor),
        origem          = 'qlik',
        sincronizado_em = now()
      where id = v_id;
      n_atual := n_atual + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'recebidas', jsonb_array_length(p_linhas), 'novas', n_novas, 'atualizadas', n_atual,
    'vinculadas_por_cnpj', n_cnpj, 'vinculadas_por_nome', n_nome,
    'cnpj_ignorado', n_cnpj_ign, 'sem_codigo_ou_nome', n_sem);
end $$;
revoke execute on function public.importar_clientes_qlik(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.importar_clientes_qlik(jsonb) to service_role;
  end if;
end $$;

-- ============================================================
--  CARGA 2 — HISTÓRICO DAS PLANILHAS ANTIGAS
--  Recebe um array JSON gerado por scripts/importar-planilhas.mjs:
--  [{codigo, empresa, solicitante, laboratorio, campanha, tipo, mecanica,
--    forma_pagamento, data_inicio, data_fim, meta, valor, aprovador,
--    observacoes, data_decisao, criado_em,
--    recebedor: {nome, cpf, nascimento, email, telefone} | null}]
--  - empresa: acha pelo nome normalizado (nome ou nome fantasia); senão cadastra (origem planilha)
--  - balconista: cadastra se o CPF ainda não está na empresa (o primeiro da lista
--    vence; o script manda a campanha mais recente primeiro). Nunca sobrescreve.
--  - campanha: entra Aprovada e importada = true. Código repetido é ignorado,
--    então rodar o mesmo arquivo de novo não duplica nada.
--  Tudo ou nada: se uma linha tiver erro, nada é gravado e a mensagem diz qual.
-- ============================================================
create or replace function public.importar_historico_planilha(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; rec jsonb;
  v_emp bigint; v_bal bigint; v_ids bigint[]; v_sol uuid;
  v_cpf text; v_tel text;
  n_emp int := 0; n_bal int := 0; n_camp int := 0; n_rep int := 0;
begin
  if jsonb_typeof(p_linhas) <> 'array' then raise exception 'Envie um array JSON de campanhas.'; end if;

  for r in select * from jsonb_array_elements(p_linhas) loop
    v_bal := null; v_cpf := null; v_tel := null; v_sol := null; rec := null;
    if exists (select 1 from campanhas where codigo = r->>'codigo') then n_rep := n_rep + 1; continue; end if;

    begin
      -- empresa
      select array_agg(id) into v_ids from empresas
       where normalizar_nome(r->>'empresa') in (normalizar_nome(nome), normalizar_nome(nome_fantasia));
      if array_length(v_ids, 1) >= 1 then
        v_emp := v_ids[1];
      else
        insert into empresas (nome, origem) values (btrim(r->>'empresa'), 'planilha') returning id into v_emp;
        n_emp := n_emp + 1;
      end if;

      -- balconista (quem recebeu pela Swile)
      rec := r->'recebedor';
      if rec is not null and jsonb_typeof(rec) = 'object' then
        v_cpf := regexp_replace(rec->>'cpf', '\D', '', 'g');
        v_tel := regexp_replace(rec->>'telefone', '\D', '', 'g');
        select id into v_bal from balconistas where empresa_id = v_emp and cpf = v_cpf;
        if v_bal is null then
          insert into balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
          values (v_emp, btrim(regexp_replace(rec->>'nome', '\s+', ' ', 'g')), v_cpf,
                  (rec->>'nascimento')::date, lower(btrim(rec->>'email')), v_tel)
          returning id into v_bal;
          n_bal := n_bal + 1;
        end if;
      end if;

      -- solicitante: liga ao perfil quando o nome bate (aí ele vê a própria campanha em "Só as minhas")
      select id into v_sol from perfis where normalizar_nome(nome) = normalizar_nome(r->>'solicitante') limit 1;

      insert into campanhas (
        codigo, empresa_id, balconista_id, cliente, laboratorio, campanha, tipo, mecanica,
        forma_pagamento, data_inicio, data_fim, meta, investimento_lynkz, observacoes,
        status, solicitante_id, solicitante_nome, aprovador_nome, data_decisao, criado_em, importada,
        swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone)
      values (
        r->>'codigo', v_emp, v_bal, btrim(r->>'empresa'), r->>'laboratorio', r->>'campanha', r->>'tipo', r->>'mecanica',
        r->>'forma_pagamento', (r->>'data_inicio')::date, (r->>'data_fim')::date,
        coalesce((r->>'meta')::numeric, 0), coalesce((r->>'valor')::numeric, 0), nullif(r->>'observacoes', ''),
        'Aprovada', v_sol, r->>'solicitante', nullif(r->>'aprovador', ''), (r->>'data_decisao')::date,
        coalesce((r->>'criado_em')::timestamptz, now()), true,
        btrim(regexp_replace(rec->>'nome', '\s+', ' ', 'g')), v_cpf, (rec->>'nascimento')::date,
        lower(btrim(rec->>'email')), v_tel);
      n_camp := n_camp + 1;
    exception when others then
      raise exception 'Linha % (%): %', r->>'codigo', r->>'empresa', sqlerrm;
    end;
  end loop;

  return jsonb_build_object('campanhas', n_camp, 'ja_existiam', n_rep, 'empresas_novas', n_emp, 'balconistas_novos', n_bal);
end $$;
revoke execute on function public.importar_historico_planilha(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.importar_historico_planilha(jsonb) to service_role;
  end if;
end $$;

-- ============================================================
--  UNIR EMPRESAS DUPLICADAS
--  Quando a mesma loja ficou com dois cadastros (ex.: "Pets Village" da
--  planilha e "PETS VILLAGE HOTEL LTDA" do Qlik), passa campanhas e
--  balconistas de p_de para p_para e desativa p_de. Não apaga nada.
--  Balconista com o mesmo CPF nas duas: as campanhas passam a apontar
--  para o de p_para e o de p_de é desativado.
--  Uso no SQL Editor:  select public.unir_empresas(<id que sai>, <id que fica>);
-- ============================================================
create or replace function public.unir_empresas(p_de bigint, p_para bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b record; v_dest bigint; n_balc int := 0; n_camp int := 0;
begin
  if p_de = p_para then raise exception 'Escolha duas empresas diferentes.'; end if;
  if not exists (select 1 from empresas where id = p_de) or not exists (select 1 from empresas where id = p_para) then
    raise exception 'Empresa não encontrada (% ou %).', p_de, p_para;
  end if;

  for b in select * from balconistas where empresa_id = p_de loop
    select id into v_dest from balconistas where empresa_id = p_para and cpf = b.cpf;
    if v_dest is null then
      update balconistas set empresa_id = p_para where id = b.id;
    else
      update campanhas set balconista_id = v_dest where balconista_id = b.id;
      update balconistas set ativo = false where id = b.id;
    end if;
    n_balc := n_balc + 1;
  end loop;

  update campanhas set empresa_id = p_para where empresa_id = p_de;
  get diagnostics n_camp = row_count;

  update empresas d set
    telefone    = coalesce(d.telefone, o.telefone),
    observacoes = coalesce(d.observacoes, o.observacoes)
  from empresas o where d.id = p_para and o.id = p_de;
  update empresas set ativo = false,
    observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Unida à empresa #' || p_para)
  where id = p_de;

  return jsonb_build_object('campanhas_movidas', n_camp, 'balconistas_movidos', n_balc);
end $$;
revoke execute on function public.unir_empresas(bigint, bigint) from public, anon, authenticated;
