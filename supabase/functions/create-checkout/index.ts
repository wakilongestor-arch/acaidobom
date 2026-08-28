import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiUrl = Deno.env.get('CHECKOUT_API_URL');
  const apiToken = Deno.env.get('CHECKOUT_API_TOKEN');
  if (!supabaseUrl || !serviceKey || !apiUrl || !apiToken) return json({ error: 'Gateway ainda não configurado.' }, 503);
  const { orderId, provider = 'custom' } = await req.json().catch(() => ({}));
  if (!orderId) return json({ error: 'orderId obrigatório.' }, 400);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  const customer = order.customer || {};
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': order.id },
    body: JSON.stringify({ reference: order.order_number, amount: Number(order.total), currency: 'BRL', customer, items: order.items, metadata: { orderId: order.id, provider } })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) return json({ error: result?.message || 'O gateway recusou a criação do checkout.' }, response.status);
  const checkoutUrl = result.checkoutUrl || result.checkout_url || result.url || '';
  const reference = String(result.id || result.reference || '');
  if (!/^https:\/\//.test(checkoutUrl)) return json({ error: 'O gateway não retornou uma URL segura de checkout.' }, 502);
  await db.from('orders').update({ payment_provider: provider, payment_reference: reference, checkout_url: checkoutUrl }).eq('id', orderId);
  return json({ checkoutUrl, reference });
});

