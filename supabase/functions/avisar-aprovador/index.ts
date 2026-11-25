// Edge Function "avisar-aprovador" (pronta, não publicada). Disparada por um Database Webhook em INSERT
// na tabela campanhas, manda e-mail aos administradores ativos com código, empresa, fornecedores, custo e link.
// Publicar: npx supabase functions deploy avisar-aprovador --no-verify-jwt e criar o webhook com x-webhook-secret.
//
//  Segredos (npx supabase secrets set …):
//    WEBHOOK_SECRET   mesmo valor do cabeçalho x-webhook-secret configurado no webhook
//    RESEND_API_KEY   chave do Resend (resend.com)
//    AVISO_REMETENTE  ex.: "LYNKZ Campanhas <campanhas@lynkz.com.br>" (domínio verificado no Resend)
//    APP_URL          ex.: https://campanhas-lynkz.lucas-melonio.workers.dev
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem em toda Edge Function.
// ============================================================
import { montarAviso } from './mensagem.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

// Comparação em tempo constante (o segredo do webhook não vaza por tempo de resposta).
function iguais(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta(405, { erro: 'Só POST.' });
  const segredo = env('WEBHOOK_SECRET');
  if (!segredo || !iguais(req.headers.get('x-webhook-secret') ?? '', segredo)) return resposta(401, { erro: 'Não autorizado.' });

  let evento: { type?: string; table?: string; record?: Record<string, unknown> };
  try { evento = await req.json(); } catch { return resposta(400, { erro: 'JSON inválido.' }); }
  const c = evento.record;
  // Só campanha nova e pendente; carga de planilha antiga (importada) não avisa.
  if (evento.type !== 'INSERT' || evento.table !== 'campanhas' || !c || c.status !== 'Pendente' || c.importada) {
    return resposta(200, { ignorado: true });
  }

  // Administradores ativos (menos quem enviou, se for um deles).
  const url = env('SUPABASE_URL'), chave = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${url}/rest/v1/perfis?select=id,email&papel=eq.aprovador&ativo=eq.true`, {
    headers: { apikey: chave, Authorization: `Bearer ${chave}` },
  });
  if (!r.ok) return resposta(502, { erro: 'Não consegui ler os administradores.' });
  const para = (await r.json() as { id: string; email: string }[])
    .filter(p => p.id !== c.solicitante_id).map(p => p.email).filter(Boolean);
  if (!para.length) return resposta(200, { ignorado: true, motivo: 'sem administrador ativo' });

  const m = montarAviso(c, env('APP_URL'));
  const envio = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('AVISO_REMETENTE'), to: para, subject: m.assunto, text: m.texto, html: m.html }),
  });
  if (!envio.ok) {
    console.error('Resend recusou', envio.status, await envio.text());
    return resposta(502, { erro: 'O envio do e-mail falhou.' });
  }
  return resposta(200, { enviado: para.length });
});
