-- ============================================================
--  13 — ROLLBACK: volta enviar_campanha à versão da migração 11 e remove
--  compras_devolucoes e compras_devolvidas (o que estava nelas se perde;
--  as campanhas e as notas marcadas ficam). Volte antes o site para a v2.8.1.
-- ============================================================
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
    observacoes, compras_periodo, compras_consultado_em, compras_marca,
    status, solicitante_id
  ) values (
    c.cliente, c.empresa_id, v_bal, c.laboratorio, c.campanha, c.tipo, c.mecanica,
    coalesce(c.investimento_lynkz, 0), coalesce(c.investimento_industria, 0), c.forma_pagamento, c.data_inicio, c.data_fim,
    c.tipo_meta, coalesce(c.meta, 0), coalesce(c.rebate_pct, 0), coalesce(c.rebate_teto, 0), c.rebate_base, c.rebate_gatilho,
    c.swile_nome_completo, c.swile_cpf, c.swile_data_nascimento, c.swile_email, c.swile_telefone,
    c.observacoes, c.compras_periodo, c.compras_consultado_em, c.compras_marca,
    'Pendente', auth.uid()
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

-- A view campanhas_app depende das colunas: sai antes e volta com reaplicar (como no rollback da 09).
begin;
set local lock_timeout = '5s';
drop view if exists public.campanhas_app;
alter table public.campanhas drop constraint if exists campanhas_devolucoes_faixa;
alter table public.campanhas drop column if exists compras_devolvidas;
alter table public.campanhas drop column if exists compras_devolucoes;
select public.reaplicar_permissoes_campanhas();
commit;
