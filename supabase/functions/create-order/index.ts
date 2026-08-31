const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' }
});
const round = (value: unknown) => Math.round((Number(value) || 0) * 100) / 100;
const text = (value: unknown, max = 500) => String(value ?? '').trim().slice(0, max);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const normalize = (value: unknown) => text(value, 160).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const postal = (value: unknown) => digits(value).slice(0, 8);
const postalMatches = (zip: string, pattern: unknown) => {
  const rule = postal(pattern);
  return Boolean(zip && rule && (rule.length === 8 ? zip === rule : zip.startsWith(rule)));
};
const fail = (message: string, status = 422) => json({ error: message }, status);

function quoteDelivery(settings: any, payload: any, hasFreeShipping: boolean) {
  if (payload.fulfillment === 'pickup') return { fee: 0, blocked: false, region: '' };
  const address = payload.address || {};
  const zip = postal(address.zip);
  const neighborhood = normalize(address.neighborhood);
  if (settings.blockedPostalCodes?.some((rule: unknown) => postalMatches(zip, rule))) {
    return { fee: 0, blocked: true, region: '' };
  }
  const zone = (Array.isArray(settings.deliveryZones) ? settings.deliveryZones : []).find((rule: any) =>
    (rule.postalPrefixes || []).some((ruleValue: unknown) => postalMatches(zip, ruleValue)) ||
    (neighborhood && (rule.neighborhoods || []).some((name: unknown) => normalize(name) === neighborhood))
  );
  if (zone?.deliver === false) return { fee: 0, blocked: true, region: text(zone.name, 100) };
  return { fee: hasFreeShipping ? 0 : round(zone ? zone.fee : settings.deliveryFee), blocked: false, region: text(zone?.name, 100) };
}

function validateItems(rawItems: unknown, products: any[]) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) throw new Error('O carrinho está vazio ou excede o limite permitido.');
  const productMap = new Map(products.filter(product => product?.active !== false).map(product => [String(product.id), product]));
  let subtotal = 0;
  let hasFreeShipping = false;
  const items = rawItems.map((raw: any) => {
    const product = productMap.get(String(raw?.productId || ''));
    if (!product) throw new Error('Um produto não está mais disponível. Atualize o cardápio.');
    const quantity = Math.min(99, Math.max(1, Math.floor(Number(raw.quantity) || 0)));
    const groups = Array.isArray(product.addonGroups) ? product.addonGroups.filter((group: any) => group?.options?.length) : [];
    const selections = Array.isArray(raw.selections) ? raw.selections : [];
    const cleanSelections = groups.map((group: any) => {
      const selected = selections.find((item: any) => String(item?.groupId) === String(group.id));
      const options = Array.isArray(selected?.options) ? selected.options : [];
      const unique = [...new Set(options.map((option: any) => String(option?.id || '')))];
      const available = new Map((group.options || []).filter((option: any) => option?.available !== false).map((option: any) => [String(option.id), option]));
      const chosen = unique.map(id => available.get(id)).filter(Boolean) as any[];
      const min = Math.max(0, Number(group.min) || 0);
      const max = Math.max(1, Number(group.max) || 1);
      if (chosen.length < min || chosen.length > max) throw new Error(`Seleção inválida no grupo ${text(group.name, 80)}.`);
      return { groupId: String(group.id), groupName: text(group.name, 100), priceMode: group.priceMode === 'final' ? 'final' : 'additive', options: chosen.map(option => ({ id: String(option.id), name: text(option.name, 120), price: round(option.price) })) };
    }).filter(selection => selection.options.length);
    const finalSelection = cleanSelections.find(selection => selection.priceMode === 'final');
    const base = finalSelection ? round(finalSelection.options[0]?.price) : round(product.price);
    const additions = cleanSelections.filter(selection => selection.priceMode !== 'final').reduce((sum, selection) => sum + selection.options.reduce((inner, option) => inner + round(option.price), 0), 0);
    const unitTotal = round(base + additions);
    subtotal += unitTotal * quantity;
    hasFreeShipping ||= product.freeShippingEnabled === true;
    return {
      productId: String(product.id), name: text(product.name, 160), imageUrl: text(product.imageUrl, 1000), basePrice: round(product.price), quantity,
      selections: cleanSelections, notes: text(raw.notes, 500), unitTotal, freeShippingEnabled: product.freeShippingEnabled === true
    };
  });
  return { items, subtotal: round(subtotal), hasFreeShipping };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Método não permitido.', 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return fail('Ambiente do Supabase incompleto.', 503);
  const body = await req.json().catch(() => ({}));
  const payload = body?.payload || body;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [{ data: settingsRow }, { data: productsRow }] = await Promise.all([
    db.from('catalogs').select('data').eq('id', 'settings').maybeSingle(),
    db.from('catalogs').select('data').eq('id', 'products').maybeSingle()
  ]);
  const settings = settingsRow?.data || {};
  const products = Array.isArray(productsRow?.data) ? productsRow.data : [];
  try {
    const customer = payload.customer || {};
    const phone = digits(customer.phone);
    if (text(customer.name, 160).length < 2 || phone.length < 10) return fail('Informe nome e telefone válidos.');
    if (!['delivery', 'pickup'].includes(payload.fulfillment)) return fail('Forma de recebimento inválida.');
    if (!['pix', 'card_delivery', 'cash', 'payment_link'].includes(payload.paymentMethod)) return fail('Forma de pagamento inválida.');
    if (payload.fulfillment === 'delivery' && (postal(payload.address?.zip).length !== 8 || !text(payload.address?.neighborhood, 100))) return fail('Informe CEP e bairro válidos.');
    const validated = validateItems(payload.items, products);
    const quote = quoteDelivery(settings, payload, validated.hasFreeShipping);
    if (quote.blocked) return fail('A região informada não está disponível para entrega.');
    if (payload.fulfillment === 'delivery' && validated.subtotal < round(settings.minOrder)) return fail(`O pedido mínimo é R$ ${round(settings.minOrder).toFixed(2).replace('.', ',')}.`);
    const total = round(validated.subtotal + quote.fee);
    const orderNumber = `ADB-${Date.now().toString().slice(-7)}${Math.floor(10 + Math.random() * 90)}`;
    const order = {
      id: crypto.randomUUID(), order_number: orderNumber,
      customer: { name: text(customer.name, 160), phone: text(customer.phone, 40), email: text(customer.email, 190), marketingConsent: customer.marketingConsent === true, marketingConsentAt: text(customer.marketingConsentAt, 60), trackingConsent: customer.trackingConsent || {}, attribution: customer.attribution || null },
      fulfillment: payload.fulfillment,
      address: payload.fulfillment === 'delivery' ? { zip: postal(payload.address?.zip), street: text(payload.address?.street, 180), number: text(payload.address?.number, 30), complement: text(payload.address?.complement, 120), neighborhood: text(payload.address?.neighborhood, 120), reference: text(payload.address?.reference, 240), city: text(payload.address?.city || settings.city, 100), deliveryRegion: quote.region, latitude: '', longitude: '', mapUrl: '' } : {},
      payment_method: payload.paymentMethod, change_for: text(payload.changeFor, 40), notes: text(payload.notes, 1000), items: validated.items, subtotal: validated.subtotal, delivery_fee: quote.fee, total, status: 'novo', payment_status: 'pendente'
    };
    const { error } = await db.from('orders').insert(order);
    if (error) return json({ error: 'Não foi possível registrar o pedido.' }, 500);
    return json({ id: order.id, order_number: order.order_number, subtotal: order.subtotal, delivery_fee: order.delivery_fee, total: order.total });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Pedido inválido.');
  }
});
