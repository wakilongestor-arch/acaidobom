import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const money = (value: unknown) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL'
}).format(Number(value) || 0);
const entities: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
};
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => entities[character] || character);

const eventNames: Record<string, string> = {
  created: 'order.created',
  confirmed: 'order.confirmed',
  preparing: 'order.preparing',
  out_for_delivery: 'order.out_for_delivery',
  completed: 'order.completed',
  cancelled: 'order.cancelled',
  payment_paid: 'order.payment_paid',
  payment_refunded: 'order.payment_refunded'
};

function validateMakeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    const allowedHost = url.hostname === 'hook.make.com' || url.hostname.endsWith('.make.com');
    return url.protocol === 'https:' && allowedHost && !url.username && !url.password ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

function orderNote(order: any, store: any) {
  const customer = order.customer || {};
  const address = order.address || {};
  const lines = [
    String(store.establishmentName || store.storeName || 'Açaí do Bom').toUpperCase(),
    `PEDIDO ${order.order_number}`,
    `Data: ${new Date(order.created_at).toLocaleString('pt-BR', { timeZone: store.timezone || 'America/Porto_Velho' })}`,
    '',
    `CLIENTE: ${customer.name || '-'}`,
    `WhatsApp: ${customer.phone || '-'}`,
    `E-mail: ${customer.email || '-'}`,
    '',
    'ITENS DO PEDIDO'
  ];
  (order.items || []).forEach((item: any, index: number) => {
    const quantity = Number(item.quantity || 1);
    lines.push(`${index + 1}. ${quantity}x ${item.name || 'Item'} — ${money(Number(item.unitTotal || 0) * quantity)}`);
    (item.selections || []).forEach((selection: any) => {
      const options = (selection.options || []).map((option: any) => {
        const price = Number(option.price || 0);
        return `${option.name}${price ? ` (+${money(price)})` : ''}`;
      }).join(', ');
      lines.push(`   ${selection.groupName || 'Adicionais'}: ${options}`);
    });
    if (item.notes) lines.push(`   Observação: ${item.notes}`);
  });
  lines.push(
    '',
    `Subtotal: ${money(order.subtotal)}`,
    `Entrega: ${money(order.delivery_fee)}`,
    `TOTAL: ${money(order.total)}`,
    '',
    `Pagamento: ${order.payment_method || '-'}`,
    `Status do pagamento: ${order.payment_status || 'pendente'}`
  );
  if (order.fulfillment === 'delivery') {
    lines.push(
      '',
      'ENDEREÇO DE ENTREGA',
      `${address.street || ''}, ${address.number || ''}${address.complement ? ` — ${address.complement}` : ''}`,
      `${address.neighborhood || ''} — ${address.city || ''}${address.zip ? ` — CEP ${address.zip}` : ''}`
    );
    if (address.reference) lines.push(`Referência: ${address.reference}`);
    if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
  } else {
    lines.push('', 'RETIRADA NO LOCAL');
  }
  if (order.notes) lines.push('', `OBSERVAÇÕES: ${order.notes}`);
  return lines.join('\n');
}

function itemRows(order: any) {
  return (order.items || []).map((item: any) => {
    const quantity = Number(item.quantity || 1);
    const additions = (item.selections || []).map((selection: any) => {
      const options = (selection.options || []).map((option: any) => html(option.name)).join(', ');
      return `<div style="color:#666;font-size:13px;margin-top:4px"><b>${html(selection.groupName || 'Adicionais')}:</b> ${options}</div>`;
    }).join('');
    const observation = item.notes
      ? `<div style="color:#666;font-size:13px;margin-top:4px"><b>Observação:</b> ${html(item.notes)}</div>`
      : '';
    return `<tr><td style="padding:12px 0;border-bottom:1px solid #eee;vertical-align:top"><b>${quantity}x ${html(item.name || 'Item')}</b>${additions}${observation}</td><td style="padding:12px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:top"><b>${html(money(Number(item.unitTotal || 0) * quantity))}</b></td></tr>`;
  }).join('');
}

function emailFrame(title: string, intro: string, content: string, store: any) {
  const name = html(store.establishmentName || store.storeName || 'Açaí do Bom');
  const contact = html(store.publicEmail || store.orderEmail || 'contato@acaidobom.com.br');
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f3f5;font-family:Arial,sans-serif;color:#251222"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;margin:auto;background:#fff;border-radius:18px;overflow:hidden"><tr><td style="background:#620853;color:#fff;padding:24px;border-bottom:6px solid #fcd307"><div style="font-size:12px;letter-spacing:1px;text-transform:uppercase">${name}</div><h1 style="font-size:25px;margin:8px 0 0">${html(title)}</h1></td></tr><tr><td style="padding:26px"><p style="font-size:16px;line-height:1.55;margin-top:0">${html(intro)}</p>${content}</td></tr><tr><td style="background:#fff8c7;padding:18px 26px;font-size:12px;color:#5c4058">Mensagem automática de ${name}. Dúvidas: ${contact}</td></tr></table></td></tr></table></body></html>`;
}

function storeEmail(order: any, store: any, note: string) {
  const customer = order.customer || {};
  const address = order.address || {};
  const delivery = order.fulfillment === 'delivery'
    ? `${html(address.street)}, ${html(address.number)}${address.complement ? ` — ${html(address.complement)}` : ''}<br>${html(address.neighborhood)} — ${html(address.city)}${address.zip ? ` — CEP ${html(address.zip)}` : ''}${address.reference ? `<br><b>Referência:</b> ${html(address.reference)}` : ''}${address.mapUrl ? `<br><a href="${html(address.mapUrl)}">Abrir mapa</a>` : ''}`
    : 'Retirada no estabelecimento';
  const content = `<div style="background:#faf7fa;border:1px solid #eadfea;border-radius:12px;padding:16px;margin:18px 0"><b>Cliente:</b> ${html(customer.name)}<br><b>WhatsApp:</b> ${html(customer.phone)}<br><b>E-mail:</b> ${html(customer.email)}<br><b>Recebimento:</b> ${delivery}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${itemRows(order)}<tr><td style="padding-top:16px"><b>TOTAL</b></td><td style="padding-top:16px;text-align:right;font-size:22px;color:#620853"><b>${html(money(order.total))}</b></td></tr></table>${order.notes ? `<p><b>Observações gerais:</b> ${html(order.notes)}</p>` : ''}`;
  return {
    to: store.orderEmail || store.publicEmail || '',
    replyTo: customer.email || '',
    subject: `Novo pedido ${order.order_number} — ${customer.name || 'cliente'} — ${money(order.total)}`,
    preheader: `${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'} · ${money(order.total)}`,
    text: note,
    html: emailFrame(`Novo pedido ${order.order_number}`, 'Um novo pedido foi registrado automaticamente no cardápio.', content, store)
  };
}

function customerEmail(order: any, store: any, event: string) {
  const customer = order.customer || {};
  const messages: Record<string, { title: string; intro: string; subject: string }> = {
    confirmed: { title: 'Pedido confirmado!', intro: `Olá, ${customer.name || 'cliente'}! Recebemos e confirmamos seu pedido.`, subject: `Pedido ${order.order_number} confirmado` },
    preparing: { title: 'Estamos preparando', intro: `Seu pedido ${order.order_number} já está sendo preparado com carinho.`, subject: `Pedido ${order.order_number} em preparo` },
    out_for_delivery: { title: 'Saiu para entrega', intro: `Seu pedido ${order.order_number} saiu para entrega. Fique de olho!`, subject: `Pedido ${order.order_number} saiu para entrega` },
    completed: { title: 'Pedido concluído', intro: `Seu pedido ${order.order_number} foi concluído. Obrigado por escolher o Açaí do Bom!`, subject: `Pedido ${order.order_number} concluído` },
    cancelled: { title: 'Pedido cancelado', intro: `O pedido ${order.order_number} foi cancelado. Fale conosco se precisar de ajuda.`, subject: `Pedido ${order.order_number} cancelado` },
    payment_paid: { title: 'Pagamento confirmado', intro: `O pagamento do pedido ${order.order_number} foi confirmado.`, subject: `Pagamento do pedido ${order.order_number} confirmado` },
    payment_refunded: { title: 'Pagamento estornado', intro: `O pagamento do pedido ${order.order_number} foi marcado como estornado.`, subject: `Pagamento do pedido ${order.order_number} estornado` }
  };
  const message = messages[event] || messages.confirmed;
  const content = `<div style="background:#fff8c7;border-radius:12px;padding:18px;margin:18px 0"><div style="font-size:13px;color:#5c4058">PEDIDO</div><b style="font-size:20px;color:#620853">${html(order.order_number)}</b><div style="margin-top:8px">Total: <b>${html(money(order.total))}</b></div></div><p style="font-size:14px;color:#5c4058">Você receberá novos avisos conforme o pedido avançar.</p>`;
  return {
    to: customer.email || '',
    replyTo: store.publicEmail || store.orderEmail || '',
    subject: message.subject,
    preheader: message.intro,
    text: `${message.title}\n\n${message.intro}\n\nPedido: ${order.order_number}\nTotal: ${money(order.total)}\n\n${store.establishmentName || store.storeName || 'Açaí do Bom'}`,
    html: emailFrame(message.title, message.intro, content, store)
  };
}

async function authenticated(db: any, req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && Boolean(data?.user);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Ambiente do Supabase incompleto.' }, 503);
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const event = String(body.event || 'created');
  const isAdmin = await authenticated(db, req);

  if (event === 'test') {
    if (!isAdmin) return json({ error: 'Acesso administrativo obrigatório.' }, 401);
    const [{ data: privateRow }, { data: settingsRow }] = await Promise.all([
      db.from('private_settings').select('data').eq('id', 'integrations').maybeSingle(),
      db.from('catalogs').select('data').eq('id', 'settings').maybeSingle()
    ]);
    const integration = privateRow?.data || {};
    const store = settingsRow?.data || {};
    const webhookUrl = validateMakeUrl(integration.makeWebhookUrl);
    if (!integration.makeWebhookEnabled || !webhookUrl) return json({ sent: false, configured: false, error: 'Ative e salve uma URL válida do Make.' });
    const email = {
      to: store.orderEmail || store.publicEmail || '',
      replyTo: store.publicEmail || store.orderEmail || '',
      subject: 'Teste da integração Make + Mailgun — Açaí do Bom',
      preheader: 'O webhook protegido está funcionando.',
      text: 'Teste concluído. O webhook do Açaí do Bom enviou estes dados ao Make.',
      html: emailFrame('Integração funcionando', 'O webhook protegido do Açaí do Bom enviou este teste ao Make.', '<p>Agora confirme se o módulo Mailgun também enviou esta mensagem.</p>', store)
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ schema_version: '1.0', event: 'integration.test', event_id: crypto.randomUUID(), sent_at: new Date().toISOString(), store, email })
      });
      if (!response.ok) return json({ sent: false, configured: true, error: `Make respondeu HTTP ${response.status}.` }, 502);
      return json({ sent: true, configured: true });
    } catch (error) {
      return json({ sent: false, configured: true, error: error instanceof Error ? error.message : 'Falha ao chamar o Make.' }, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!eventNames[event]) return json({ error: 'Evento de e-mail inválido.' }, 400);
  const orderId = String(body.orderId || '');
  if (!orderId) return json({ error: 'orderId obrigatório.' }, 400);
  if (event !== 'created' && !isAdmin) return json({ error: 'Acesso administrativo obrigatório.' }, 401);

  const [{ data: order, error: orderError }, { data: privateRow }, { data: settingsRow }] = await Promise.all([
    db.from('orders').select('*').eq('id', orderId).maybeSingle(),
    db.from('private_settings').select('data').eq('id', 'integrations').maybeSingle(),
    db.from('catalogs').select('data').eq('id', 'settings').maybeSingle()
  ]);
  if (orderError || !order) return json({ error: 'Pedido não encontrado.' }, 404);
  if (event === 'created' && !isAdmin && Date.now() - new Date(order.created_at).valueOf() > 30 * 60 * 1000) {
    return json({ error: 'A notificação inicial deste pedido expirou.' }, 403);
  }

  const integration = privateRow?.data || {};
  const store = settingsRow?.data || {};
  const webhookUrl = validateMakeUrl(integration.makeWebhookUrl);
  if (!integration.makeWebhookEnabled || !webhookUrl) {
    return json({ sent: false, configured: false, reason: 'make_disabled' });
  }
  const note = orderNote(order, store);
  const email = event === 'created' ? storeEmail(order, store, note) : customerEmail(order, store, event);
  if (!email.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.to)) {
    return json({ sent: false, configured: true, reason: 'recipient_missing' });
  }

  const sourceUpdatedAt = order.updated_at || order.created_at;
  let eventId = crypto.randomUUID();
  const { data: inserted, error: insertError } = await db.from('order_webhook_events').insert({
    id: eventId, order_id: order.id, event_type: eventNames[event], source_updated_at: sourceUpdatedAt
  }).select('id').single();
  if (insertError?.code === '23505') {
    const { data: previous } = await db.from('order_webhook_events')
      .select('id,status,updated_at')
      .eq('order_id', order.id)
      .eq('event_type', eventNames[event])
      .eq('source_updated_at', sourceUpdatedAt)
      .maybeSingle();
    if (previous?.status === 'enviado' || (previous?.status === 'processando' && Date.now() - new Date(previous.updated_at).valueOf() < 120000)) {
      return json({ sent: previous.status === 'enviado', configured: true, duplicate: true });
    }
    eventId = previous?.id || eventId;
    await db.from('order_webhook_events').update({ status: 'processando', error_message: '', updated_at: new Date().toISOString() }).eq('id', eventId);
  } else if (insertError || !inserted) {
    return json({ error: insertError?.message || 'Não foi possível registrar o evento.' }, 500);
  }

  const payload = {
    schema_version: '1.0',
    event: eventNames[event],
    event_id: eventId,
    sent_at: new Date().toISOString(),
    store: {
      name: store.establishmentName || store.storeName || 'Açaí do Bom',
      location: store.locationName || store.city || '',
      address: store.address || '',
      phone: store.contactPhone || store.whatsapp || '',
      public_email: store.publicEmail || '',
      cnpj: store.cnpj || ''
    },
    order: {
      id: order.id, number: order.order_number, created_at: order.created_at, updated_at: order.updated_at,
      status: order.status, payment_status: order.payment_status, payment_method: order.payment_method,
      notes: order.notes || ''
    },
    customer: order.customer || {},
    fulfillment: order.fulfillment,
    address: order.address || {},
    items: order.items || [],
    totals: { subtotal: Number(order.subtotal), delivery_fee: Number(order.delivery_fee), total: Number(order.total), currency: 'BRL' },
    note,
    email: { ...email, from: `${store.establishmentName || store.storeName || 'Açaí do Bom'} <${store.orderEmail || store.publicEmail || 'contato@acaidobom.com.br'}>` }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Make respondeu HTTP ${response.status}.`);
    const now = new Date().toISOString();
    await db.from('order_webhook_events').update({ status: 'enviado', response_status: response.status, error_message: '', updated_at: now }).eq('id', eventId);
    const statusField = event === 'created' ? 'store_email_status' : 'customer_email_status';
    await db.from('orders').update({ [statusField]: 'enviado', email_error: '', last_email_at: now }).eq('id', order.id);
    return json({ sent: true, configured: true, event: eventNames[event], eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao chamar o Make.';
    const now = new Date().toISOString();
    await db.from('order_webhook_events').update({ status: 'erro', error_message: message, updated_at: now }).eq('id', eventId);
    const statusField = event === 'created' ? 'store_email_status' : 'customer_email_status';
    await db.from('orders').update({ [statusField]: 'erro', email_error: message, last_email_at: now }).eq('id', order.id);
    return json({ sent: false, configured: true, error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
});
