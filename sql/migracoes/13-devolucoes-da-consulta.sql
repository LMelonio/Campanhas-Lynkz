-- ============================================================
--  13 — DEVOLUÇÕES NA CONSULTA DO QLIK (v2.9.0)
--
--  O total que o Qlik devolve já desconta as devoluções, mas a nota devolvida
--  vem com o valor cheio: a soma das notas passava do total. Na v2.9 a tela
--  mostra "Devoluções no período: −R$ X" e as notas de provável devolução
--  riscadas, fora da soma. A campanha guarda isso para o aprovador ver:
--    compras_devolucoes  valor devolvido no período (soma das notas − total)
--    compras_devolvidas  [{numero, serie, data, valor}] notas de provável devolução
--  enviar_campanha (migração 11) passa a gravar as duas colunas.
--
--  Só acrescenta colunas e troca a função. Pode rodar duas vezes.
--  Pré-requisito: a 11. Desfazer: 13-rollback.sql. Depois: 13-validacao.sql.
-- ============================================================
alter table public.campanhas add column if not exists compras_devolucoes numeric(14,2);
alter table public.campanhas add column if not exists compras_devolvidas jsonb;
-- Os dois campos vêm do aparelho de quem pede (como compras_periodo): limites no banco.
-- Nulos = consulta não feita ou site anterior à v2.9 (que não manda as chaves novas).
alter table public.campanhas drop constraint if exists campanhas_devolucoes_faixa;
alter table public.campanhas add constraint campanhas_devolucoes_faixa check (
  (compras_devolucoes is null or (compras_devolucoes >= 0 and compras_devolucoes <= 10000000))
  and (case when compras_devolvidas is null then true
            when jsonb_typeof(compras_devolvidas) <> 'array' then false
            else jsonb_array_length(compras_devolvidas) <= 50 end)
) not valid;

-- As colunas novas entram no select da view e nos grants do app.
select public.reaplicar_permissoes_campanhas();

-- enviar_campanha: igual à da migração 11, com compras_devolucoes e compras_devolvidas.
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
    status, solicitante_id
  ) values (
    c.cliente, c.empresa_id, v_bal, c.laboratorio, c.campanha, c.tipo, c.mecanica,
    coalesce(c.investimento_lynkz, 0), coalesce(c.investimento_industria, 0), c.forma_pagamento, c.data_inicio, c.data_fim,
    c.tipo_meta, coalesce(c.meta, 0), coalesce(c.rebate_pct, 0), coalesce(c.rebate_teto, 0), c.rebate_base, c.rebate_gatilho,
    c.swile_nome_completo, c.swile_cpf, c.swile_data_nascimento, c.swile_email, c.swile_telefone,
    c.observacoes, c.compras_periodo, c.compras_consultado_em, c.compras_marca, c.compras_devolucoes, c.compras_devolvidas,
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
