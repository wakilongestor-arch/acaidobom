(function () {
  let catalog = null;
  let step = 1;
  let bound = false;
  let lastRestoredPhone = '';
  let phoneTimer = null;
  let redirectTimer = null;
  const profileStorageKey = 'acai_customer_profiles_v1';
  const $ = selector => document.querySelector(selector);

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '').slice(-11);
  }

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizePostalCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
  }

  function postalMatches(zip, pattern) {
    const rule = normalizePostalCode(pattern);
    return Boolean(zip && rule && (rule.length === 8 ? zip === rule : zip.startsWith(rule)));
  }

  function deliveryQuote(data = formData()) {
    if (data.fulfillment === 'pickup') return { fee: 0, blocked: false, zone: null, message: 'Retirada no local: sem taxa de entrega.' };
    const settings = catalog?.settings || {};
    const zip = normalizePostalCode(data.zip);
    const neighborhood = normalizeText(data.neighborhood);
    const blockedPostal = (settings.blockedPostalCodes || []).find(pattern => postalMatches(zip, pattern));
    if (blockedPostal) return { fee: 0, blocked: true, zone: null, message: 'Este CEP está fora da área de entrega. Escolha retirada ou fale com a loja.' };
    const zone = (settings.deliveryZones || []).find(rule => {
      const postal = (rule.postalPrefixes || []).some(pattern => postalMatches(zip, pattern));
      const area = (rule.neighborhoods || []).some(name => normalizeText(name) === neighborhood);
      return postal || (neighborhood && area);
    }) || null;
    if (zone?.deliver === false) return { fee: 0, blocked: true, zone, message: `${zone.name || 'Esta região'} está fora da área de entrega. Escolha retirada ou fale com a loja.` };
    const fee = zone ? Math.max(0, Number(zone.fee) || 0) : Math.max(0, Number(settings.deliveryFee) || 0);
    return { fee, blocked: false, zone, message: zone ? `Entrega para ${zone.name}: ${MenuAPI.money(fee)}.` : `Taxa padrão de entrega: ${MenuAPI.money(fee)}.` };
  }

  function renderDeliveryQuote() {
    const element = $('#delivery-quote');
    if (!element || !catalog) return deliveryQuote();
    const data = formData();
    const quote = deliveryQuote(data);
    const incomplete = data.fulfillment === 'delivery' && (!normalizePostalCode(data.zip) || !normalizeText(data.neighborhood));
    element.textContent = incomplete ? 'Informe o CEP e o bairro para confirmar a taxa e a área de entrega.' : quote.message;
    element.classList.toggle('blocked', !incomplete && quote.blocked);
    element.classList.toggle('matched', !incomplete && !quote.blocked);
    return quote;
  }

  function readProfiles() {
    try { return JSON.parse(localStorage.getItem(profileStorageKey) || '{}'); }
    catch (error) { return {}; }
  }

  function clearRestoredFields() {
    if (!lastRestoredPhone) return;
    ['name', 'email', 'zip', 'street', 'number', 'complement', 'neighborhood', 'reference', 'latitude', 'longitude'].forEach(name => {
      const field = $('#checkout-form').elements.namedItem(name);
      if (field) field.value = '';
    });
    lastRestoredPhone = '';
    resetLocationStatus();
  }

  function restoreProfile() {
    const form = $('#checkout-form');
    const phone = normalizePhone(form.elements.namedItem('phone').value);
    const found = $('#returning-customer');
    if (phone.length < 10) { found.hidden = true; return; }
    if (lastRestoredPhone && lastRestoredPhone !== phone) clearRestoredFields();
    const profile = readProfiles()[phone];
    if (!profile) { found.hidden = true; return; }
    const values = { ...profile.customer, ...profile.address };
    ['name', 'email', 'zip', 'street', 'number', 'complement', 'neighborhood', 'reference', 'latitude', 'longitude'].forEach(name => {
      const value = values[name];
      const field = form.elements.namedItem(name);
      if (field && name !== 'phone') field.value = value || '';
    });
    const fulfillment = form.querySelector(`input[name="fulfillment"][value="${profile.fulfillment || 'delivery'}"]`);
    if (fulfillment) fulfillment.checked = true;
    $('#address-fields').hidden = profile.fulfillment === 'pickup';
    form.elements.namedItem('rememberProfile').checked = true;
    lastRestoredPhone = phone;
    found.hidden = false;
    if (profile.address?.latitude && profile.address?.longitude) {
      showLocationStatus('Localização salva recuperada para esta entrega.', true);
    }
    renderDeliveryQuote();
  }

  function saveProfile(payload) {
    const phone = normalizePhone(payload.customer.phone);
    if (phone.length < 10) return;
    const profiles = readProfiles();
    profiles[phone] = {
      customer: {
        name: payload.customer.name,
        phone: payload.customer.phone,
        email: payload.customer.email
      },
      address: payload.address,
      fulfillment: payload.fulfillment,
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(profileStorageKey, JSON.stringify(profiles)); }
    catch (error) { console.warn('Não foi possível lembrar os dados neste aparelho.', error); }
  }

  function removeProfile(phoneValue) {
    const phone = normalizePhone(phoneValue);
    if (phone.length < 10) return;
    const profiles = readProfiles();
    if (!profiles[phone]) return;
    delete profiles[phone];
    try { localStorage.setItem(profileStorageKey, JSON.stringify(profiles)); }
    catch (error) { console.warn('Não foi possível remover os dados lembrados neste aparelho.', error); }
  }

  function open(nextCatalog) {
    if (window.MenuStoreStatus && !window.MenuStoreStatus.get().open) return false;
    catalog = nextCatalog;
    clearTimeout(redirectTimer);
    step = 1;
    lastRestoredPhone = '';
    $('#returning-customer').hidden = true;
    $('#checkout-form').elements.namedItem('rememberProfile').checked = true;
    resetLocationStatus();
    render();
    $('#checkout-overlay').hidden = false;
    window.syncMenuScroll?.();
    requestAnimationFrame(() => $('#checkout-form').elements.namedItem('phone')?.focus());
    return true;
  }

  function close() {
    clearTimeout(redirectTimer);
    $('#checkout-overlay').hidden = true;
    window.syncMenuScroll?.();
    $('#order-success').hidden = true;
    $('#checkout-form').hidden = false;
    $('#checkout-form').reset();
    step = 1;
    resetLocationStatus();
    render();
  }

  function safeRedirectUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function showLocationStatus(message, success = false) {
    const box = document.querySelector('.location-assist');
    const status = $('#location-status');
    if (status) status.textContent = message;
    box?.classList.toggle('success', success);
  }

  function resetLocationStatus() {
    showLocationStatus('Opcional: facilita encontrar o endereço na entrega.', false);
    const button = $('#use-location');
    if (button) {
      button.disabled = false;
      button.textContent = '⌖ Marcar minha localização atual';
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      showLocationStatus('Este navegador não permite marcar localização.');
      return;
    }
    const button = $('#use-location');
    button.disabled = true;
    button.textContent = 'Localizando...';
    navigator.geolocation.getCurrentPosition(position => {
      const form = $('#checkout-form');
      form.elements.namedItem('latitude').value = position.coords.latitude.toFixed(6);
      form.elements.namedItem('longitude').value = position.coords.longitude.toFixed(6);
      showLocationStatus('Localização marcada. Complete rua, número e bairro.', true);
      button.disabled = false;
      button.textContent = '✓ Localização marcada';
    }, () => {
      showLocationStatus('Não foi possível acessar a localização. Você pode preencher o endereço normalmente.');
      button.disabled = false;
      button.textContent = '⌖ Marcar minha localização atual';
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 });
  }

  function render() {
    document.querySelectorAll('.checkout-step').forEach(element => {
      element.hidden = Number(element.dataset.step) !== step;
    });
    $('#checkout-step-label').textContent = `Etapa ${step} de 3`;
    $('#checkout-progress').style.width = `${(step / 3) * 100}%`;
    $('#checkout-back').disabled = step === 1;
    $('#checkout-next').hidden = step === 3;
    $('#checkout-submit').hidden = step !== 3;
    $('#checkout-error').hidden = true;
    renderDeliveryQuote();
    if (step === 3) {
      renderPayments();
      renderSummary();
    }
  }

  function formData() {
    return Object.fromEntries(new FormData($('#checkout-form')).entries());
  }

  function validate() {
    const data = formData();
    const error = $('#checkout-error');
    let message = '';
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email || '').trim());
    if (step === 1 && (!String(data.name || '').trim() || String(data.phone || '').replace(/\D/g, '').length < 10 || !emailValid)) {
      message = 'Informe seu nome, um WhatsApp válido e o e-mail que receberá a confirmação.';
    }
    if (step === 2 && data.fulfillment === 'delivery' && (!data.street || !data.number || !data.neighborhood || !data.city || normalizePostalCode(data.zip).length !== 8)) {
      message = 'Preencha CEP, rua, número, bairro e cidade.';
    }
    if (step === 2 && data.fulfillment === 'delivery' && !message) {
      const quote = deliveryQuote(data);
      if (quote.blocked) message = quote.message;
    }
    if (message) {
      error.textContent = message;
      error.hidden = false;
      return false;
    }
    return true;
  }

  function renderPayments() {
    const methods = [
      ['pix', 'PIX', catalog.settings.pixKey ? 'Chave após confirmar' : 'Confirme com a loja'],
      ['card_delivery', 'Cartão na entrega', 'Crédito ou débito'],
      ['cash', 'Dinheiro', 'Informe se precisa de troco']
    ];
    if (catalog.settings.paymentLink || (catalog.settings.gatewayEnabled && catalog.settings.gatewayProvider !== 'none')) {
      methods.push(['payment_link', 'Pagamento on-line', 'Link seguro']);
    }
    const current = document.querySelector('input[name=paymentMethod]:checked')?.value || 'pix';
    $('#payment-options').innerHTML = methods.map(([value, label, description]) =>
      `<label><input type="radio" name="paymentMethod" value="${value}" ${value === current ? 'checked' : ''}><span><b>${label}</b><small>${description}</small></span></label>`
    ).join('');
    $('#payment-options').querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => { $('#change-field').hidden = input.value !== 'cash'; });
    });
  }

  function renderSummary() {
    const quote = deliveryQuote();
    const delivery = quote.fee;
    const total = CartStore.subtotal() + delivery;
    $('#order-summary').innerHTML = '<h3>Resumo</h3>' +
      CartStore.get().map(item => `<div><span>${item.quantity}x ${item.name}</span><b>${MenuAPI.money(item.unitTotal * item.quantity)}</b></div>`).join('') +
      `<hr><div><span>Subtotal</span><b>${MenuAPI.money(CartStore.subtotal())}</b></div>` +
      `<div><span>${quote.zone?.name ? `Entrega · ${quote.zone.name}` : 'Entrega'}</span><b>${MenuAPI.money(delivery)}</b></div>` +
      `<div class="total"><span>Total</span><b>${MenuAPI.money(total)}</b></div>`;
    $('#checkout-submit').textContent = `Confirmar · ${MenuAPI.money(total)}`;
  }

  async function submit(event) {
    event.preventDefault();
    if (window.MenuStoreStatus && !window.MenuStoreStatus.get().open) {
      const error = $('#checkout-error');
      error.textContent = 'A loja está fechada neste momento. Seu carrinho continuará salvo para você pedir quando abrir.';
      error.hidden = false;
      window.MenuStoreStatus.refresh();
      return;
    }
    const data = formData();
    const quote = deliveryQuote(data);
    const delivery = quote.fee;
    if (data.fulfillment === 'delivery' && (normalizePostalCode(data.zip).length !== 8 || !String(data.neighborhood || '').trim())) {
      const error = $('#checkout-error');
      error.textContent = 'Informe um CEP válido e o bairro para confirmar a entrega.';
      error.hidden = false;
      return;
    }
    if (quote.blocked) {
      const error = $('#checkout-error');
      error.textContent = quote.message;
      error.hidden = false;
      return;
    }
    if (CartStore.subtotal() < Number(catalog.settings.minOrder) && data.fulfillment === 'delivery') {
      const error = $('#checkout-error');
      error.textContent = `O pedido mínimo é ${MenuAPI.money(catalog.settings.minOrder)}.`;
      error.hidden = false;
      return;
    }
    const button = $('#checkout-submit');
    button.disabled = true;
    button.textContent = 'Registrando pedido...';
    const payload = {
      customer: {
        name: data.name,
        phone: data.phone,
        email: data.email || '',
        marketingConsent: data.marketingConsent === '1',
        marketingConsentAt: data.marketingConsent === '1' ? new Date().toISOString() : '',
        trackingConsent: window.MenuConsent?.get?.() || {
          necessary: true,
          analytics: false,
          marketing: false,
          decided: false
        },
        attribution: window.MenuAttribution?.forOrder?.() || null
      },
      fulfillment: data.fulfillment,
      address: {
        zip: data.zip || '', street: data.street || '', number: data.number || '',
        complement: data.complement || '', neighborhood: data.neighborhood || '',
        reference: data.reference || '', city: data.city || '', deliveryRegion: quote.zone?.name || '',
        latitude: data.latitude || '', longitude: data.longitude || '',
        mapUrl: data.latitude && data.longitude ? `https://www.google.com/maps?q=${encodeURIComponent(data.latitude)},${encodeURIComponent(data.longitude)}` : ''
      },
      paymentMethod: data.paymentMethod || 'pix',
      changeFor: data.changeFor || '',
      notes: data.notes || '',
      items: CartStore.get(),
      subtotal: CartStore.subtotal(),
      deliveryFee: delivery,
      total: CartStore.subtotal() + delivery
    };
    let whatsappWindow = null;
    if (catalog.settings.autoOpenWhatsApp !== false && !catalog.settings.whatsappCloudEnabled) {
      whatsappWindow = window.open('', 'acai-pedido-whatsapp');
      if (whatsappWindow) whatsappWindow.document.title = 'Preparando pedido no WhatsApp';
    }
    try {
      const result = await MenuAPI.createOrder(payload);
      if (data.rememberProfile === '1') saveProfile(payload);
      else removeProfile(payload.customer.phone);
      CartStore.clear();
      showSuccess(result, data.name);
      if (whatsappWindow) {
        if (result.whatsappUrl) whatsappWindow.location.replace(result.whatsappUrl);
        else whatsappWindow.close();
      }
    } catch (error) {
      whatsappWindow?.close();
      const box = $('#checkout-error');
      box.textContent = error.message || 'Não foi possível concluir o pedido.';
      box.hidden = false;
    } finally {
      button.disabled = false;
    }
  }

  function showSuccess(result, name) {
    $('#checkout-form').hidden = true;
    const box = $('#order-success');
    box.hidden = false;
    const title = result.stored ? 'PEDIDO REGISTRADO' : 'PEDIDO PRONTO';
    const message = result.stored
      ? 'Sua solicitação de pedido foi recebida. Fique de olho no seu e-mail e aguarde a confirmação da loja antes de considerar o pedido aprovado.'
      : 'Não foi possível registrar sua solicitação. Volte ao cardápio e tente novamente.';
    const emailNotice = result.stored && result.customerEmail
      ? (result.emailAutomationConfigured
        ? `<div class="email-confirmation">✉ A confirmação será enviada automaticamente para <b>${String(result.customerEmail).replace(/[&<>"']/g, '')}</b> quando a loja confirmar o pedido.</div>`
        : `<div class="email-confirmation pending">✉ Seu e-mail foi salvo. A loja ainda precisa ativar a automação de confirmação.</div>`)
      : '';
    const redirectUrl = catalog.settings.orderRedirectEnabled ? safeRedirectUrl(catalog.settings.orderRedirectUrl) : '';
    const redirectNotice = redirectUrl ? '<div class="redirect-confirmation">Você será direcionado para a próxima página em alguns segundos.</div>' : '';
    box.innerHTML = `<span class="success-icon">✓</span><small>${title}</small>` +
      `<h2>Obrigado ${String(name).split(' ')[0]}!</h2><p>${message}</p>` +
      `<div class="order-number"><small>NÚMERO DO PEDIDO</small><b>${result.orderNumber}</b></div>` +
      emailNotice +
      redirectNotice +
      (result.pixKey ? `<div class="pix"><span><small>CHAVE PIX</small><b>${result.pixKey}</b></span><button type="button" data-copy-pix>Copiar</button></div>` : '') +
      '<div class="success-links">' +
      (result.paymentUrl ? `<a href="${result.paymentUrl}" target="_blank" rel="noopener">Pagar on-line</a>` : '') +
      (catalog.settings.autoOpenWhatsApp === true && result.whatsappUrl ? `<a class="wa" href="${result.whatsappUrl}" target="_blank" rel="noopener">Enviar pedido pelo WhatsApp</a>` : '') +
      (redirectUrl ? `<a class="redirect-link" href="${redirectUrl}">Continuar →</a>` : '') +
      '</div><button type="button" class="link-button" data-finish>Voltar ao cardápio</button>';
    box.querySelector('[data-copy-pix]')?.addEventListener('click', () => navigator.clipboard.writeText(result.pixKey));
    box.querySelector('[data-finish]').addEventListener('click', close);
    if (redirectUrl) {
      clearTimeout(redirectTimer);
      redirectTimer = setTimeout(() => window.location.assign(redirectUrl), 3000);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    $('#checkout-next').addEventListener('click', () => {
      if (validate()) { step = Math.min(3, step + 1); render(); }
    });
    $('#checkout-back').addEventListener('click', () => { step = Math.max(1, step - 1); render(); });
    $('#close-checkout').addEventListener('click', close);
    $('#checkout-overlay').addEventListener('click', event => {
      if (event.target.id === 'checkout-overlay') close();
    });
    $('#checkout-form').addEventListener('submit', submit);
    $('#use-location').addEventListener('click', useCurrentLocation);
    const phone = $('#checkout-form').elements.namedItem('phone');
    phone.addEventListener('input', () => {
      clearTimeout(phoneTimer);
      phoneTimer = setTimeout(restoreProfile, 350);
    });
    phone.addEventListener('blur', restoreProfile);
    const checkoutForm = $('#checkout-form');
    const zip = checkoutForm.elements.namedItem('zip');
    const neighborhood = checkoutForm.elements.namedItem('neighborhood');
    zip.addEventListener('input', () => {
      const digits = normalizePostalCode(zip.value);
      zip.value = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
      renderDeliveryQuote();
      if (step === 3) renderSummary();
    });
    neighborhood.addEventListener('input', () => { renderDeliveryQuote(); if (step === 3) renderSummary(); });
    document.querySelectorAll('input[name=fulfillment]').forEach(input => {
      input.addEventListener('change', () => { $('#address-fields').hidden = input.value === 'pickup'; renderDeliveryQuote(); if (step === 3) renderSummary(); });
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
  window.Checkout = { open, close };
})();
