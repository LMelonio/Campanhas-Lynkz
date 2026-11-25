-- ============================================================
--  14 — FORNECEDORES: META E INVESTIMENTO DA INDÚSTRIA POR FORNECEDOR (v2.13.0)
--
--  Na tela, "laboratório" virou "fornecedor" (a coluna continua "laboratorio",
--  com os nomes separados por vírgula: "Ouro Fino, Avert"). Agora:
--    - no máximo 5 fornecedores por campanha (campanhas_fornecedores_max);
--    - com 2 ou mais, a campanha pode dividir a meta e o investimento da indústria:
--      campanhas.fornecedores = [{"nome","meta","investimento_industria"}]
--      e meta / investimento_industria guardam a SOMA (o resto do app não muda).
--      O rebate continua com um % e um teto; a parte de cada fornecedor é
--      proporcional à meta dele (calculada na tela, não gravada).
--  enviar_campanha (migração 13) passa a gravar "fornecedores".
--
--  Só acrescenta coluna, função e regras (NOT VALID: o que já está gravado não é
--  conferido). Pode rodar duas vezes. Pré-requisito: a 13.
--  Desfazer: 14-rollback.sql. Depois: 14-validacao.sql.
--  Com a 14 no banco e o site ainda na 2.12, enviar campanha continua funcionando
--  (a coluna fica vazia).
-- ============================================================
alter table public.campanhas add column if not exists fornecedores jsonb;

-- Confere a divisão gravada: nula (campanha sem divisão) ou 2 a 5 itens
-- { nome, meta, investimento_industria }, um por fornecedor da campanha (os mesmos de
-- "laboratorio", sem repetir), valores dentro dos limites e somas iguais às colunas
-- meta e investimento_industria. plpgsql para conferir o tipo antes de converter.
create or replace function public.fornecedores_validos(f jsonb, lab text, meta numeric, ind numeric)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  e       jsonb;
  nomes   text[] := '{}';
  labs    text[];
  s_meta  numeric := 0;
  s_ind   numeric := 0;
  v_meta  numeric;
  v_ind   numeric;
  v_nome  text;
begin
  if f is null then return true; end if;
  if jsonb_typeof(f) <> 'array' or jsonb_array_length(f) < 2 or jsonb_array_length(f) > 5 then return false; end if;
  select coalesce(array_agg(distinct lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into labs from unnest(string_to_array(coalesce(lab, ''), ',')) x;
  if cardinality(labs) <> jsonb_array_length(f) then return false; end if;
  for e in select * from jsonb_array_elements(f) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'nome') <> 'string'
       or jsonb_typeof(e->'meta') <> 'number' or jsonb_typeof(e->'investimento_industria') <> 'number' then
      return false;
    end if;
    v_nome := lower(btrim(e->>'nome'));
    v_meta := (e->>'meta')::numeric;
    v_ind  := (e->>'investimento_industria')::numeric;
    if v_nome = '' or length(v_nome) > 120 or v_nome = any(nomes) or not (v_nome = any(labs)) then return false; end if;
    if v_meta < 0 or v_meta > 1000000000 or v_ind < 0 or v_ind > 10000000 then return false; end if;
    nomes := nomes || v_nome;
    s_meta := s_meta + v_meta;
    s_ind  := s_ind + v_ind;
  end loop;
  return round(s_meta, 2) = round(coalesce(meta, 0), 2) and round(s_ind, 2) = round(coalesce(ind, 0), 2);
end $$;

alter table public.campanhas drop constraint if exists campanhas_fornecedores_valido;
alter table public.campanhas add constraint campanhas_fornecedores_valido
  check (public.fornecedores_validos(fornecedores, laboratorio, meta, investimento_industria)) not valid;
-- No máximo 5 fornecedores em "laboratorio" ("Ouro Fino, Avert, …"). NOT VALID: só vale para o que entrar daqui em diante.
alter table public.campanhas drop constraint if exists campanhas_fornecedores_max;
alter table public.campanhas add constraint campanhas_fornecedores_max
  check (cardinality(array_remove(string_to_array(regexp_replace(coalesce(laboratorio, ''), '\s*,\s*', ',', 'g'), ','), '')) <= 5) not valid;

-- A coluna nova entra no select da view e nos grants do app (inserir sim, alterar não).
select public.reaplicar_permissoes_campanhas();

-- enviar_campanha: igual à da migração 13, gravando também "fornecedores".
create or replace function public.enviar_campanha(
  p_campanha   jsonb,
  p_balconista jsonb default null,
  p_notas      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  c        public.campanhas;
  v_bal    public.balconistas.id%type;
  v_id     public.campanhas.id%type;
  v_codigo public.campanhas.codigo%type;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para enviar a campanha.';
  end if;
  if p_campanha is null or jsonb_typeof(p_campanha) <> 'object' then
    raise exception 'Campanha inválida.';
  end if;

  c := jsonb_populate_record(null::public.campanhas, p_campanha);
  v_bal := c.balconista_id;

  if p_balconista is not null and jsonb_typeof(p_balconista) = 'object' then
    if nullif(p_balconista->>'id', '') is not null then
      update public.balconistas set
        nome_completo   = p_balconista->>'nome_completo',
        cpf             = p_balconista->>'cpf',
        data_nascimento = nullif(p_balconista->>'data_nascimento', '')::date,
        email           = p_balconista->>'email',
        telefone        = p_balconista->>'telefone'
      where id = (p_balconista->>'id')::bigint
      returning id into v_bal;
      if v_bal is null then
        raise exception 'O balconista escolhido não foi encontrado.';
      end if;
    else
      insert into public.balconistas (empresa_id, nome_completo, cpf, data_nascimento, email, telefone)
      values ((p_balconista->>'empresa_id')::bigint, p_balconista->>'nome_completo', p_balconista->>'cpf',
              nullif(p_balconista->>'data_nascimento', '')::date, p_balconista->>'email', p_balconista->>'telefone')
      returning id into v_bal;
    end if;
  end if;

  insert into public.campanhas (
    cliente, empresa_id, balconista_id, laboratorio, campanha, tipo, mecanica,
    investimento_lynkz, investimento_industria, forma_pagamento, data_inicio, data_fim,
    tipo_meta, meta, rebate_pct, rebate_teto, rebate_base, rebate_gatilho,
    swile_nome_completo, swile_cpf, swile_data_nascimento, swile_email, swile_telefone,
    observacoes, compras_periodo, compras_consultado_em, compras_marca, compras_devolucoes, compras_devolvidas,
    fornecedores, status, solicitante_id
  ) values (
    c.cliente, c.empresa_id, v_bal, c.laboratorio, c.campanha, c.tipo, c.mecanica,
    coalesce(c.investimento_lynkz, 0), coalesce(c.investimento_industria, 0), c.forma_pagamento, c.data_inicio, c.data_fim,
    c.tipo_meta, coalesce(c.meta, 0), coalesce(c.rebate_pct, 0), coalesce(c.rebate_teto, 0), c.rebate_base, c.rebate_gatilho,
    c.swile_nome_completo, c.swile_cpf, c.swile_data_nascimento, c.swile_email, c.swile_telefone,
    c.observacoes, c.compras_periodo, c.compras_consultado_em, c.compras_marca, c.compras_devolucoes, c.compras_devolvidas,
    c.fornecedores, 'Pendente', auth.uid()
  ) returning id, codigo into v_id, v_codigo;

  if p_notas is not null and jsonb_typeof(p_notas) = 'array' and jsonb_array_length(p_notas) > 0 then
    insert into public.campanha_notas (campanha_id, numero, serie, data_emissao, valor)
    select v_id, n->>'numero', coalesce(n->>'serie', ''), nullif(n->>'data', '')::date, (n->>'valor')::numeric
    from jsonb_array_elements(p_notas) n;
  end if;

  return jsonb_build_object('id', v_id, 'codigo', v_codigo, 'balconista_id', v_bal);
end $$;

revoke execute on function public.enviar_campanha(jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.enviar_campanha(jsonb, jsonb, jsonb) to authenticated;
