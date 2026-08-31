import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function validSignature(req: Request, dataId: string, secret: string) {
  const header = req.headers.get('x-signature') || '';
  const requestId = req.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=')));
  if (!parts.ts || !parts.v1 || !requestId || !dataId) return false;
  const timestamp = Number(parts.ts);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  return timingSafeEqual(await hmacHex(secret, manifest), String(parts.v1));
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  const webhookSecret = Deno.env.get('MERCADO_PAGO_WEBHOOK_SECRET') || '';
  if (!supabaseUrl || !serviceKey || !accessToken || !webhookSecret) {
    return json({ error: 'Integração Mercado Pago incompleta.' }, 503);
  }

  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const type = String(url.searchParams.get('type') || body.type || body.action || '');
  const dataId = String(url.searchParams.get('data.id') || url.searchParams.get('data_id') || body?.data?.id || '');
  if (!dataId || (!type.includes('payment') && body.type !== 'payment')) return json({ received: true, ignored: true });

  if (!(await validSignature(req, dataId, webhookSecret))) return json({ error: 'Assinatura inválida.' }, 401);

  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payment = await paymentResponse.json().catch(() => ({}));
  if (!paymentResponse.ok) return json({ error: 'Não foi possível confirmar o pagamento no Mercado Pago.' }, 502);

  const orderId = String(payment.external_reference || payment.metadata?.order_id || '');
  if (!orderId) return json({ received: true, ignored: true, reason: 'order_missing' });

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders').select('id,total,payment_status').eq('id', orderId).maybeSingle();
  if (error || !order) return json({ received: true, ignored: true, reason: 'order_not_found' });

  const paidAmount = Number(payment.transaction_amount || 0);
  if (Math.abs(paidAmount - Number(order.total || 0)) > 0.01) {
    return json({ error: 'Valor do pagamento não confere com o pedido.' }, 409);
  }

  const status = String(payment.status || '');
  const nextPaymentStatus = status === 'approved'
    ? 'pago'
    : ['refunded', 'charged_back'].includes(status)
      ? 'estornado'
      : 'pendente';

  await db.from('orders').update({
    payment_status: nextPaymentStatus,
    payment_provider: 'mercadopago',
    payment_reference: String(payment.id || dataId),
    updated_at: new Date().toISOString()
  }).eq('id', order.id);

  return json({ received: true, orderId: order.id, paymentStatus: nextPaymentStatus });
});
