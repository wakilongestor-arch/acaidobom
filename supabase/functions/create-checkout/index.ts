import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const money = (value: unknown) => Number(value || 0).toFixed(2);

function checkoutItems(order: any) {
  const items = (Array.isArray(order.items) ? order.items : []).map((item: any, index: number) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.unitTotal || 0);
    return {
      title: String(item.name || `Produto ${index + 1}`).slice(0, 120),
      quantity,
      unit_price: money(unitPrice),
      unit_measure: 'unit',
      total_amount: money(unitPrice * quantity)
    };
  });
  if (Number(order.delivery_fee || 0) > 0) {
    items.push({
      title: 'Taxa de entrega',
      quantity: 1,
      unit_price: money(order.delivery_fee),
      unit_measure: 'unit',
      total_amount: money(order.delivery_fee)
    });
  }
  return items;
}

function paymentDetails(result: any) {
  const payment = result?.transactions?.payments?.[0] || {};
  const method = payment.payment_method || {};
  return {
    reference: String(result?.id || payment.id || ''),
    checkoutUrl: String(result?.init_point || result?.sandbox_init_point || result?.checkout_url || ''),
    ticketUrl: String(method.ticket_url || payment.ticket_url || ''),
    qrCode: String(method.qr_code || payment.qr_code || ''),
    qrCodeBase64: String(method.qr_code_base64 || payment.qr_code_base64 || '')
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const accessToken = Deno.env.get('MERCADO_PAGO_ACCESS_TOKEN') || '';
  const { orderId, paymentMode = 'card' } = await req.json().catch(() => ({}));
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase incompleto.' }, 503);
  if (!accessToken) return json({ error: 'Mercado Pago ainda não configurado.' }, 503);
  if (!orderId) return json({ error: 'orderId obrigatório.' }, 400);
  if (!['card', 'pix'].includes(paymentMode)) return json({ error: 'Forma de pagamento inválida.' }, 400);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (order.payment_status === 'pago') return json({ error: 'Este pedido já foi pago.' }, 409);

  const customer = order.customer || {};
  const email = String(customer.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Informe um e-mail válido para pagar on-line.' }, 400);
  }

  const items = checkoutItems(order);
  const calculatedTotal = items.reduce((sum: number, item: any) => sum + Number(item.total_amount), 0);
  if (!items.length || Math.abs(calculatedTotal - Number(order.total || 0)) > 0.01 || calculatedTotal <= 0) {
    return json({ error: 'Os valores do pedido não conferem. Volte ao cardápio e tente novamente.' }, 409);
  }

  const notificationUrl = `${supabaseUrl}/functions/v1/mercadopago-webhook?source_news=webhooks`;
  const returnUrl = 'https://acaidobom.com.br/?pagamento=';
  const idempotencyKey = paymentMode === 'card'
    ? order.id
    : `${String(order.id).slice(0, -1)}${String(order.id).endsWith('0') ? '1' : '0'}`;
  const commonHeaders = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': idempotencyKey
  };

  const preferenceItems = items.map((item: any, index: number) => ({
    id: String(index + 1),
    title: item.title,
    quantity: item.quantity,
    unit_price: Number(item.unit_price),
    currency_id: 'BRL'
  }));
  const payload = {
        external_reference: order.id,
        notification_url: notificationUrl,
        statement_descriptor: 'ACAI DO BOM',
        payer: { email, name: String(customer.name || '').trim() },
        items: preferenceItems,
        back_urls: {
          success: `${returnUrl}aprovado`,
          pending: `${returnUrl}pendente`,
          failure: `${returnUrl}falhou`
        },
        auto_return: 'approved',
        payment_methods: paymentMode === 'pix'
          ? {
              excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'atm' }],
              installments: 1
            }
          : {
              excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }],
              installments: 10
            }
      };

  const endpoint = 'https://api.mercadopago.com/checkout/preferences';
  let response = await fetch(endpoint, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify(payload)
  });
  let result = await response.json().catch(() => ({}));
  if (!response.ok) {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify({
        items: preferenceItems,
        payer: { email },
        external_reference: order.id,
        notification_url: notificationUrl,
        back_urls: {
          success: `${returnUrl}aprovado`,
          pending: `${returnUrl}pendente`,
          failure: `${returnUrl}falhou`
        },
        auto_return: 'approved',
        payment_methods: paymentMode === 'pix'
          ? { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }, { id: 'atm' }], installments: 1 }
          : undefined
      })
    });
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const message = result?.message || result?.error || result?.cause?.[0]?.description || result?.errors?.[0]?.message || 'O Mercado Pago recusou a criação do pagamento.';
    return json({ error: message }, response.status);
  }

  const details = paymentDetails(result);
  if (!/^https:\/\//.test(details.checkoutUrl)) {
    return json({ error: 'O Mercado Pago não retornou a página segura de pagamento.' }, 502);
  }

  const checkoutUrl = details.checkoutUrl;
  await db.from('orders').update({
    payment_method: paymentMode === 'pix' ? 'mercadopago_pix' : 'mercadopago_card',
    payment_provider: 'mercadopago',
    payment_reference: details.reference,
    checkout_url: checkoutUrl,
    updated_at: new Date().toISOString()
  }).eq('id', order.id);

  return json({
    paymentMode,
    reference: details.reference,
    checkoutUrl: details.checkoutUrl,
    ticketUrl: details.ticketUrl,
    qrCode: details.qrCode,
    qrCodeBase64: details.qrCodeBase64
  });
});
