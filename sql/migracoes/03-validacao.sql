-- ============================================================
--  03 — VALIDAÇÃO DAS REGRAS DE SEGURANÇA
--
--  Cria 4 usuários e 3 campanhas FICTÍCIOS, testa o que cada um consegue
--  fazer fingindo ser ele (como o app faz), e DESFAZ TUDO no final: o
--  bloco termina com um erro proposital que cancela todas as gravações.
--  Nenhum usuário, campanha ou perfil real é alterado.
--
--  Cole o arquivo inteiro no SQL Editor e clique em Run. O resultado é
--  uma tabela com uma linha por teste e a coluna "ok".
--  Os testes da parte B aparecem como "pulado" se ela não foi aplicada.
-- ============================================================
create temp table if not exists resultado_validacao
  (n int, teste text, esperado text, obtido text, ok boolean);
truncate resultado_validacao;

do $$
#variable_conflict use_column
declare
  res       jsonb := '[]';
  obtido    text;
  qtd       int;
  txt       text;
  tem_b     boolean := to_regclass('public.campanhas_app') is not null;
  assin_ini text;
  assin_fim text;
  u_coord1  uuid := gen_random_uuid();
  u_coord2  uuid := gen_random_uuid();
  u_aprov   uuid := gen_random_uuid();
  u_inativo uuid := gen_random_uuid();
  c_swile   bigint;
  c_comum   bigint;
  c_inativo bigint;
begin
  select md5(coalesce(string_agg(t::text, '|' order by id), '')) into assin_ini from public.campanhas t;

  begin  -- tudo daqui até o "FIM_DOS_TESTES" é desfeito
    -- ---------- preparação (como administrador) ----------
    insert into auth.users (id, email) values
      (u_coord1,  'validacao-coord1-'  || u_coord1  || '@invalid.local'),
      (u_coord2,  'validacao-coord2-'  || u_coord2  || '@invalid.local'),
      (u_aprov,   'validacao-aprov-'   || u_aprov   || '@invalid.local'),
      (u_inativo, 'validacao-inativo-' || u_inativo || '@invalid.local');
    update perfis set nome = 'Coord Um (teste)'   where id = u_coord1;
    update perfis set nome = 'Coord Dois (teste)' where id = u_coord2;
    update perfis set nome = 'Aprovador (teste)', papel = 'aprovador' where id = u_aprov;
    update perfis set nome = 'Inativo (teste)', ativo = false where id = u_inativo;

    insert into campanhas (cliente, laboratorio, campanha, forma_pagamento, status, solicitante_id, solicitante_nome,
                           swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone)
    values ('Cliente Teste', 'Lab Teste', 'Campanha Swile (teste)', 'Swile', 'Pendente', u_coord1, 'Coord Um (teste)',
            'Maria Teste Silva', '52998224725', '1990-01-01', 'maria@invalid.local', '11999999999')
    returning id into c_swile;
    insert into campanhas (cliente, laboratorio, campanha, forma_pagamento, status, solicitante_id, solicitante_nome)
    values ('Cliente Teste', 'Lab Teste', 'Campanha comum (teste)', 'Desconto em nota', 'Pendente', u_coord2, 'Coord Dois (teste)')
    returning id into c_comum;

    -- ===== COORDENADOR ATIVO (coord1, dono da campanha Swile) =====
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claim.sub', u_coord1::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u_coord1, 'role', 'authenticated')::text, true);

    begin
      select count(*) into qtd from campanhas where id in (c_swile, c_comum);
      obtido := qtd || ' campanhas';
    exception when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',1,'teste','Coordenador ativo vê as campanhas de todos','esperado','2 campanhas','obtido',obtido);

    if tem_b then
      begin
        execute 'select swile_cpf from campanhas_app where id = $1' into txt using c_swile;
        obtido := coalesce(txt, 'vazio');
      exception when others then obtido := 'erro: ' || sqlerrm; end;
    else obtido := 'pulado'; end if;
    res := res || jsonb_build_object('n',2,'teste','Coordenador vê o CPF Swile da PRÓPRIA solicitação','esperado', case when tem_b then '52998224725' else 'pulado' end,'obtido',obtido);

    begin
      insert into campanhas (cliente, laboratorio, campanha, status, solicitante_id, solicitante_nome)
      values ('Cliente Teste', 'Lab Teste', 'Nova (teste)', 'Pendente', u_coord1, 'NOME FALSO');
      select solicitante_nome into txt from campanhas where campanha = 'Nova (teste)' and solicitante_id = u_coord1;
      obtido := 'criou, nome gravado: ' || txt;
    exception when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',3,'teste','Coordenador cria campanha; nome do solicitante vem do perfil','esperado','criou, nome gravado: Coord Um (teste)','obtido',obtido);

    begin
      insert into campanhas (cliente, laboratorio, campanha, status, solicitante_id)
      values ('Cliente Teste', 'Lab Teste', 'Em nome de outro (teste)', 'Pendente', u_coord2);
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',4,'teste','Coordenador cria campanha em nome de outro','esperado','bloqueado','obtido',obtido);

    begin
      insert into campanhas (cliente, laboratorio, campanha, status, solicitante_id)
      values ('Cliente Teste', 'Lab Teste', 'Já aprovada (teste)', 'Aprovada', u_coord1);
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',5,'teste','Coordenador cria campanha já aprovada','esperado','bloqueado','obtido',obtido);

    begin
      insert into campanhas (cliente, laboratorio, campanha, status, solicitante_id, aprovador_nome, data_decisao)
      values ('Cliente Teste', 'Lab Teste', 'Carimbo falso (teste)', 'Pendente', u_coord1, 'Gerente', current_date);
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',6,'teste','Coordenador grava nome do aprovador/data da decisão','esperado','bloqueado','obtido',obtido);

    begin
      update campanhas set status = 'Aprovada' where id = c_swile;
      select status into txt from campanhas where id = c_swile;
      obtido := case when txt = 'Pendente' then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'bloqueado (' || sqlerrm || ')'; end;
    res := res || jsonb_build_object('n',7,'teste','Coordenador aprova a própria campanha','esperado','bloqueado','obtido',obtido);

    begin
      delete from campanhas where id = c_comum;
      get diagnostics qtd = row_count;
      obtido := case when qtd = 0 then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',8,'teste','Coordenador apaga campanha','esperado','bloqueado','obtido',obtido);

    begin
      update perfis set papel = 'aprovador' where id = u_coord1;
      get diagnostics qtd = row_count;
      obtido := case when qtd = 0 then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'bloqueado (' || sqlerrm || ')'; end;
    res := res || jsonb_build_object('n',9,'teste','Coordenador se promove a aprovador','esperado','bloqueado','obtido',obtido);

    begin
      update perfis set nome = 'Outro nome' where id = u_coord1;
      get diagnostics qtd = row_count;
      obtido := case when qtd = 0 then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',10,'teste','Coordenador edita o próprio perfil pela API','esperado','bloqueado','obtido',obtido);

    -- ===== OUTRO COORDENADOR (coord2, não é dono da campanha Swile) =====
    perform set_config('request.jwt.claim.sub', u_coord2::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u_coord2, 'role', 'authenticated')::text, true);

    begin
      execute 'select swile_cpf from campanhas where id = $1' into txt using c_swile;
      obtido := 'leu: ' || coalesce(txt, 'vazio');
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',11,'teste','Outro coordenador lê CPF Swile direto na tabela','esperado','bloqueado','obtido',obtido);

    if tem_b then
      begin
        execute 'select coalesce(swile_cpf, ''vazio'') || '' / visivel='' || swile_visivel || '' / campanha visível='' || (campanha is not null) from campanhas_app where id = $1' into txt using c_swile;
        obtido := txt;
      exception when others then obtido := 'erro: ' || sqlerrm; end;
    else obtido := 'pulado'; end if;
    res := res || jsonb_build_object('n',12,'teste','Outro coordenador na view do app: vê a campanha, CPF vazio','esperado', case when tem_b then 'vazio / visivel=false / campanha visível=true' else 'pulado' end,'obtido',obtido);

    if tem_b then
      begin
        execute 'select count(*) from public.swile_da_campanha($1)' into qtd using c_swile;
        obtido := qtd || ' linhas';
      exception when others then obtido := 'erro: ' || sqlerrm; end;
    else obtido := 'pulado'; end if;
    res := res || jsonb_build_object('n',13,'teste','Outro coordenador chama a função Swile direto (RPC)','esperado', case when tem_b then '0 linhas' else 'pulado' end,'obtido',obtido);

    -- ===== APROVADOR =====
    perform set_config('request.jwt.claim.sub', u_aprov::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u_aprov, 'role', 'authenticated')::text, true);

    if tem_b then
      begin
        execute 'select swile_cpf from campanhas_app where id = $1' into txt using c_swile;
        obtido := coalesce(txt, 'vazio');
      exception when others then obtido := 'erro: ' || sqlerrm; end;
    else obtido := 'pulado'; end if;
    res := res || jsonb_build_object('n',14,'teste','Aprovador vê o CPF Swile','esperado', case when tem_b then '52998224725' else 'pulado' end,'obtido',obtido);

    begin
      update campanhas set investimento_lynkz = 999999 where id = c_comum;
      get diagnostics qtd = row_count;
      obtido := case when qtd = 0 then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',15,'teste','Aprovador altera valor da campanha','esperado','bloqueado','obtido',obtido);

    begin
      update campanhas set status = 'Aprovada' where id = c_comum and status = 'Pendente';
      select status || ' por ' || aprovador_nome || ' em ' || (data_decisao = current_date) into txt from campanhas where id = c_comum;
      obtido := txt;
    exception when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',16,'teste','Aprovador aprova; banco carimba nome e data','esperado','Aprovada por Aprovador (teste) em true','obtido',obtido);

    begin
      update campanhas set status = 'Reprovada', motivo = 'mudei de ideia' where id = c_comum;
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'bloqueado'; end;
    res := res || jsonb_build_object('n',17,'teste','Aprovador muda decisão já tomada','esperado','bloqueado','obtido',obtido);

    begin
      update campanhas set motivo = 'texto reescrito' where id = c_comum;
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'bloqueado'; end;
    res := res || jsonb_build_object('n',18,'teste','Aprovador reescreve motivo de campanha já decidida','esperado','bloqueado','obtido',obtido);

    begin
      update campanhas set aprovador_nome = 'Outra pessoa' where id = c_comum;
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',19,'teste','Aprovador falsifica nome do aprovador no histórico','esperado','bloqueado','obtido',obtido);

    begin
      update campanhas set status = 'Reprovada', motivo = null where id = c_swile and status = 'Pendente';
      obtido := 'permitido';
    exception when others then obtido := 'bloqueado'; end;
    res := res || jsonb_build_object('n',20,'teste','Reprovar sem motivo','esperado','bloqueado','obtido',obtido);

    -- ===== USUÁRIO DESATIVADO =====
    perform set_config('request.jwt.claim.sub', u_inativo::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', u_inativo, 'role', 'authenticated')::text, true);

    begin
      select count(*) into qtd from campanhas where id in (c_swile, c_comum);
      obtido := qtd || ' campanhas';
    exception when insufficient_privilege then obtido := '0 campanhas'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',21,'teste','Desativado consulta campanhas pela API','esperado','0 campanhas','obtido',obtido);

    begin
      insert into campanhas (cliente, laboratorio, campanha, status, solicitante_id)
      values ('Cliente Teste', 'Lab Teste', 'Do inativo (teste)', 'Pendente', u_inativo);
      obtido := 'permitido';
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',22,'teste','Desativado cria campanha','esperado','bloqueado','obtido',obtido);

    begin
      update perfis set ativo = true where id = u_inativo;
      get diagnostics qtd = row_count;
      obtido := case when qtd = 0 then 'bloqueado' else 'permitido' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',23,'teste','Desativado se reativa sozinho','esperado','bloqueado','obtido',obtido);

    begin
      select count(*) filter (where id = u_inativo) || ' próprio / ' || count(*) filter (where id <> u_inativo) || ' outros'
        into obtido from perfis;
    exception when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',24,'teste','Desativado lê perfis (precisa do próprio para ver o aviso)','esperado','1 próprio / 0 outros','obtido',obtido);

    -- ===== SEM LOGIN (chave pública) =====
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    begin
      select count(*) into qtd from campanhas;
      obtido := case when qtd = 0 then 'bloqueado' else qtd || ' campanhas' end;
    exception when insufficient_privilege then obtido := 'bloqueado'; when others then obtido := 'erro: ' || sqlerrm; end;
    res := res || jsonb_build_object('n',25,'teste','Visitante sem login lê campanhas','esperado','bloqueado','obtido',obtido);

    perform set_config('role', 'none', true);
    raise exception 'FIM_DOS_TESTES';
  exception when others then
    if sqlerrm <> 'FIM_DOS_TESTES' then raise; end if;
  end;

  -- ===== CHECAGENS FINAIS (fora da parte desfeita) =====
  select md5(coalesce(string_agg(t::text, '|' order by id), '')) into assin_fim from public.campanhas t;
  res := res || jsonb_build_object('n',26,'teste','Campanhas reais intactas (assinatura antes = depois)','esperado','iguais','obtido', case when assin_ini = assin_fim then 'iguais' else 'DIFERENTES' end);

  obtido := case when has_column_privilege('authenticated', 'public.campanhas', 'swile_cpf', 'SELECT') then 'enviado' else 'não enviado' end
         || ' / id ' || case when has_column_privilege('authenticated', 'public.campanhas', 'id', 'SELECT') then 'enviado' else 'não enviado' end;
  res := res || jsonb_build_object('n',27,'teste','Tempo real: CPF Swile nos eventos (mesma checagem do Realtime)','esperado', case when tem_b then 'não enviado / id enviado' else 'pulado' end,'obtido', case when tem_b then obtido else 'pulado' end);

  select count(*) into qtd from auth.users where email like 'validacao-%@invalid.local';
  res := res || jsonb_build_object('n',28,'teste','Usuários fictícios removidos','esperado','0','obtido',qtd::text);

  insert into resultado_validacao (n, teste, esperado, obtido, ok)
  select n, teste, esperado, obtido, esperado = obtido
  from jsonb_to_recordset(res) as x(n int, teste text, esperado text, obtido text);
end $$;

select n, ok, teste, esperado, obtido from resultado_validacao order by n;
