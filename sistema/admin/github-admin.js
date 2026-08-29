(function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  let catalog = { settings: {}, categories: [], products: [] };
  let privateSettings = { makeWebhookEnabled: false, makeWebhookUrl: '', available: false };
  let orders = [];
  let editing = null;
  let deleting = null;
  let deletingOrderIds = [];
  let orderRefreshTimer = null;
  let knownOrderIds = new Set();
  let orderView = 'board';
  let orderPeriod = 'today';
  let customOrderDate = '';
  let dashboardPeriod = 'today';
  let customDashboardDate = '';
  let customerQuery = '';
  let customerConsentFilter = 'all';
  const weekDays = [
    ['sun', 'Domingo'], ['mon', 'Segunda'], ['tue', 'Terça'], ['wed', 'Quarta'],
    ['thu', 'Quinta'], ['fri', 'Sexta'], ['sat', 'Sábado']
  ];
  const categoryDefaults = {
    acai: 'assets/images/categories/acai.jpg',
    lanches: 'assets/images/categories/lanches.jpg',
    pasteis: 'assets/images/categories/pasteis.jpg'
  };
  const crmNotificationDefaults = {
    confirmed: { label: 'Pedido confirmado', enabled: true, title: 'Pedido confirmado! 🎉', message: 'Olá, {primeiro_nome}! Seu pedido foi confirmado e já está sendo preparado com todo carinho. Assim que sair para entrega, avisaremos você por e-mail.', imageUrl: '' },
    preparing: { label: 'Em preparo', enabled: true, title: 'Preparando seu pedido 💜', message: '{primeiro_nome}, seu pedido já está sendo preparado com muito carinho.', imageUrl: '' },
    out_for_delivery: { label: 'Saiu para entrega', enabled: true, title: 'Seu pedido está a caminho! 🛵', message: '{primeiro_nome}, seu pedido saiu para entrega. Fique de olho!', imageUrl: '' },
    completed: { label: 'Pedido concluído', enabled: true, title: 'Pedido concluído! 💛', message: '{primeiro_nome}, seu pedido foi concluído. Obrigado por escolher o Açaí do Bom!', imageUrl: '' },
    cancelled: { label: 'Pedido cancelado', enabled: true, title: 'Pedido cancelado', message: '{primeiro_nome}, o pedido {pedido} foi cancelado. Fale conosco se precisar de ajuda.', imageUrl: '' }
  };
  const defaultHours = () => Object.fromEntries(weekDays.map(([key]) => [
    key, { enabled: true, open: '00:00', close: '23:59' }
  ]));

  async function loadFallbackCatalog() {
    const get = path => fetch(`../../${path}`, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar o catálogo inicial.');
      return response.json();
    });
    const [settings, categories, products] = await Promise.all([
      get('data/config/store.json'),
      get('data/categories/catalog.json'),
      get('data/products/catalog.json')
    ]);
    return { settings, categories, products };
  }

  async function boot() {
    $('#setup-box').hidden = SupabaseStore.configured;
    if (!SupabaseStore.configured) return;
    try {
      const session = await SupabaseStore.getSession();
      if (session) await openAdmin();
    } catch (error) {
      showLoginError(error.message);
    }
  }

  async function openAdmin() {
    $('#auth-screen').hidden = true;
    $('#admin-app').hidden = false;
    try {
      catalog = await SupabaseStore.loadCatalog() || await loadFallbackCatalog();
      const migrated = ensureCatalogDefaults();
      if (migrated) await SupabaseStore.saveCatalog(catalog);
      privateSettings = await SupabaseStore.loadPrivateSettings();
      orders = await SupabaseStore.listOrders();
      knownOrderIds = new Set(orders.map(order => String(order.id)));
      fill();
      renderAll();
      startOrderPolling();
    } catch (error) {
      notice(error.message, true);
    }
  }

  function showLoginError(text) {
    const error = $('#login-error');
    error.textContent = text;
    error.hidden = false;
  }

  function notice(text, error = false) {
    const element = $('#notice');
    element.textContent = text;
    element.className = `notice ${error ? 'error' : 'ok'}`;
    element.hidden = false;
    setTimeout(() => { element.hidden = true; }, 5000);
  }

  function preview(url) {
    return !url || /^(https?:|data:|blob:)/.test(url) ? url : `../../${url}`;
  }

  function ensureCatalogDefaults() {
    let changed = false;
    const settings = catalog.settings || (catalog.settings = {});
    const set = (key, value) => {
      if (settings[key] !== value) { settings[key] = value; changed = true; }
    };
    if (!settings.logoUrl) set('logoUrl', 'assets/images/logo/logo-acai-do-bom.webp');
    if (!settings.establishmentName) set('establishmentName', settings.storeName || 'Açaí do Bom');
    if (!settings.locationName) set('locationName', settings.city || 'Ji-Paraná - RO');
    if (!settings.contactPhone) set('contactPhone', '(69) 9381-7951');
    if (!settings.publicEmail) set('publicEmail', 'contato@acaidobom.com.br');
    if (!settings.heroEyebrow) set('heroEyebrow', '✦ DO SEU JEITO');
    if (!settings.heroTitle) set('heroTitle', 'O açaí que');
    if (!settings.heroHighlight) set('heroHighlight', 'dá vontade.');
    if (!settings.menuEyebrow) set('menuEyebrow', 'ESCOLHA O SEU');
    if (!settings.menuTitle) set('menuTitle', 'Cardápio');
    if (!settings.searchPlaceholder) set('searchPlaceholder', 'Buscar produto ou acompanhamento');
    if (!settings.whatsappEyebrow) set('whatsappEyebrow', 'PREFERE PEDIR DIRETO?');
    if (!settings.whatsappTitle) set('whatsappTitle', 'Fale com a gente no WhatsApp');
    if (!settings.whatsappButtonText) set('whatsappButtonText', 'CHAMAR AGORA →');
    if (!settings.paymentSummary) set('paymentSummary', 'PIX cartão ou dinheiro');
    if (typeof settings.cnpj !== 'string') set('cnpj', '');
    if (typeof settings.instagramUrl !== 'string') set('instagramUrl', '');
    if (typeof settings.facebookUrl !== 'string') set('facebookUrl', '');
    if (typeof settings.tiktokUrl !== 'string') set('tiktokUrl', '');
    if (!settings.infoStripIcons || typeof settings.infoStripIcons !== 'object') {
      settings.infoStripIcons = { service: '', time: '', delivery: '', payment: '' };
      changed = true;
    } else {
      ['service', 'time', 'delivery', 'payment'].forEach(key => {
        if (typeof settings.infoStripIcons[key] !== 'string') {
          settings.infoStripIcons[key] = '';
          changed = true;
        }
      });
    }
    if (!settings.dailyOffer || typeof settings.dailyOffer !== 'object') {
      settings.dailyOffer = { enabled: false, title: '', description: '', buttonText: 'APROVEITAR →', link: '#cardapio', imageUrl: '' };
      changed = true;
    } else {
      const offerDefaults = { enabled: false, title: '', description: '', buttonText: 'APROVEITAR →', link: '#cardapio', imageUrl: '' };
      Object.entries(offerDefaults).forEach(([key, value]) => {
        if (typeof settings.dailyOffer[key] !== typeof value) {
          settings.dailyOffer[key] = value;
          changed = true;
        }
      });
    }
    if (typeof settings.whatsappCloudEnabled !== 'boolean') set('whatsappCloudEnabled', false);
    if (typeof settings.gatewayEnabled !== 'boolean') set('gatewayEnabled', false);
    if (!settings.gatewayProvider) set('gatewayProvider', 'none');
    set('primaryColor', '#620853');
    set('accentColor', '#fcd307');
    set('brandBrightColor', '#620853');
    if (typeof settings.autoOpenWhatsApp !== 'boolean') set('autoOpenWhatsApp', true);
    if (typeof settings.orderRedirectEnabled !== 'boolean') set('orderRedirectEnabled', false);
    if (typeof settings.orderRedirectUrl !== 'string') set('orderRedirectUrl', '');
    if (!settings.crmNotifications || typeof settings.crmNotifications !== 'object') {
      settings.crmNotifications = {};
      changed = true;
    }
    Object.entries(crmNotificationDefaults).forEach(([event, defaults]) => {
      const current = settings.crmNotifications[event];
      if (!current || typeof current !== 'object') {
        settings.crmNotifications[event] = { enabled: defaults.enabled, title: defaults.title, message: defaults.message, imageUrl: '' };
        changed = true;
        return;
      }
      ['enabled', 'title', 'message', 'imageUrl'].forEach(key => {
        if (typeof current[key] !== typeof defaults[key]) {
          current[key] = defaults[key];
          changed = true;
        }
      });
    });
    if (!['auto', 'open', 'closed'].includes(settings.statusMode)) {
      set('statusMode', settings.open === false ? 'closed' : 'open');
    }
    if (!settings.timezone) set('timezone', 'America/Porto_Velho');
    if (!settings.hours || typeof settings.hours !== 'object') {
      settings.hours = defaultHours();
      changed = true;
    } else {
      const defaults = defaultHours();
      weekDays.forEach(([key]) => {
        if (!settings.hours[key]) { settings.hours[key] = defaults[key]; changed = true; }
      });
    }
    catalog.categories = (catalog.categories || []).map(category => {
      if (!category.imageUrl && categoryDefaults[category.id]) {
        changed = true;
        return { ...category, imageUrl: categoryDefaults[category.id] };
      }
      return category;
    });
    catalog.products = catalog.products || [];
    return changed;
  }

  function fill() {
    const settings = catalog.settings;
    const fields = {
      '#logo-url': 'logoUrl', '#banner-url': 'bannerUrl', '#store-name': 'storeName',
      '#store-tagline': 'tagline', '#store-city': 'city', '#store-address': 'address',
      '#estimated-time': 'estimatedTime', '#store-whatsapp': 'whatsapp',
      '#order-email': 'orderEmail', '#pix-key': 'pixKey', '#payment-link': 'paymentLink',
      '#meta-pixel': 'metaPixelId', '#gtm-id': 'gtmId', '#ga4-id': 'ga4Id',
      '#delivery-fee': 'deliveryFee', '#min-order': 'minOrder',
      '#establishment-name': 'establishmentName', '#location-name': 'locationName',
      '#store-cnpj': 'cnpj', '#contact-phone': 'contactPhone', '#public-email': 'publicEmail',
      '#instagram-url': 'instagramUrl', '#facebook-url': 'facebookUrl', '#tiktok-url': 'tiktokUrl',
      '#gateway-provider': 'gatewayProvider', '#hero-eyebrow': 'heroEyebrow', '#hero-title': 'heroTitle',
      '#hero-highlight': 'heroHighlight', '#menu-eyebrow': 'menuEyebrow', '#menu-title': 'menuTitle',
      '#search-placeholder': 'searchPlaceholder', '#whatsapp-eyebrow': 'whatsappEyebrow',
      '#whatsapp-title': 'whatsappTitle', '#whatsapp-button-text': 'whatsappButtonText', '#payment-summary': 'paymentSummary',
      '#order-redirect-url': 'orderRedirectUrl'
    };
    Object.entries(fields).forEach(([selector, key]) => { $(selector).value = settings[key] ?? ''; });
    $('#whatsapp-cloud-enabled').checked = Boolean(settings.whatsappCloudEnabled);
    $('#gateway-enabled').checked = Boolean(settings.gatewayEnabled);
    $('#order-redirect-enabled').checked = Boolean(settings.orderRedirectEnabled);
    $('#daily-offer-enabled').checked = Boolean(settings.dailyOffer.enabled);
    $('#daily-offer-title').value = settings.dailyOffer.title || '';
    $('#daily-offer-description').value = settings.dailyOffer.description || '';
    $('#daily-offer-button').value = settings.dailyOffer.buttonText || 'APROVEITAR →';
    $('#daily-offer-link').value = settings.dailyOffer.link || '#cardapio';
    $('#daily-offer-image').value = settings.dailyOffer.imageUrl || '';
    $('#store-status-mode').value = settings.statusMode || 'open';
    $('#make-webhook-enabled').checked = Boolean(privateSettings.makeWebhookEnabled);
    $('#make-webhook-url').value = privateSettings.makeWebhookUrl || '';
    updateMakeWebhookStatus(privateSettings.available
      ? 'Webhook protegido pronto para configuração.'
      : 'Execute a migração 003 no Supabase para liberar esta integração.', !privateSettings.available);
    customOrderDate = localDateKey(new Date());
    $('#order-date').value = customOrderDate;
    customDashboardDate = customOrderDate;
    $('#dashboard-date').value = customDashboardDate;
    renderCrmNotifications();
    renderHoursEditor();
    renderInfoIcons();
    renderPreviews();
  }

  function collect() {
    const settings = catalog.settings;
    const fields = {
      '#logo-url': 'logoUrl', '#banner-url': 'bannerUrl', '#store-name': 'storeName',
      '#store-tagline': 'tagline', '#store-city': 'city', '#store-address': 'address',
      '#estimated-time': 'estimatedTime', '#store-whatsapp': 'whatsapp',
      '#order-email': 'orderEmail', '#pix-key': 'pixKey', '#payment-link': 'paymentLink',
      '#meta-pixel': 'metaPixelId', '#gtm-id': 'gtmId', '#ga4-id': 'ga4Id',
      '#establishment-name': 'establishmentName', '#location-name': 'locationName',
      '#store-cnpj': 'cnpj', '#contact-phone': 'contactPhone', '#public-email': 'publicEmail',
      '#instagram-url': 'instagramUrl', '#facebook-url': 'facebookUrl', '#tiktok-url': 'tiktokUrl',
      '#gateway-provider': 'gatewayProvider', '#hero-eyebrow': 'heroEyebrow', '#hero-title': 'heroTitle',
      '#hero-highlight': 'heroHighlight', '#menu-eyebrow': 'menuEyebrow', '#menu-title': 'menuTitle',
      '#search-placeholder': 'searchPlaceholder', '#whatsapp-eyebrow': 'whatsappEyebrow',
      '#whatsapp-title': 'whatsappTitle', '#whatsapp-button-text': 'whatsappButtonText', '#payment-summary': 'paymentSummary',
      '#order-redirect-url': 'orderRedirectUrl'
    };
    Object.entries(fields).forEach(([selector, key]) => { settings[key] = $(selector).value.trim(); });
    settings.deliveryFee = Number($('#delivery-fee').value);
    settings.minOrder = Number($('#min-order').value);
    settings.statusMode = $('#store-status-mode').value;
    settings.open = settings.statusMode !== 'closed';
    settings.primaryColor = '#620853';
    settings.accentColor = '#fcd307';
    settings.brandBrightColor = '#620853';
    settings.whatsappCloudEnabled = $('#whatsapp-cloud-enabled').checked;
    settings.gatewayEnabled = $('#gateway-enabled').checked;
    settings.orderRedirectEnabled = $('#order-redirect-enabled').checked;
    settings.dailyOffer = {
      enabled: $('#daily-offer-enabled').checked,
      title: $('#daily-offer-title').value.trim(),
      description: $('#daily-offer-description').value.trim(),
      buttonText: $('#daily-offer-button').value.trim() || 'APROVEITAR →',
      link: $('#daily-offer-link').value.trim() || '#cardapio',
      imageUrl: $('#daily-offer-image').value.trim()
    };
    collectCrmNotifications();
    privateSettings.makeWebhookEnabled = $('#make-webhook-enabled').checked;
    privateSettings.makeWebhookUrl = $('#make-webhook-url').value.trim();
    collectHours();
  }

  function renderCrmNotifications() {
    const settings = catalog.settings;
    const notifications = settings.crmNotifications || (settings.crmNotifications = {});
    const editor = $('#crm-notifications-editor');
    editor.innerHTML = Object.entries(crmNotificationDefaults).map(([event, defaults]) => {
      const current = { ...defaults, ...(notifications[event] || {}) };
      notifications[event] = { enabled: current.enabled !== false, title: current.title, message: current.message, imageUrl: current.imageUrl || '' };
      return `<article class="notification-editor ${current.enabled === false ? 'disabled' : ''}" data-notification="${event}"><header><div><small>ETAPA DO CRM</small><h4>${esc(defaults.label)}</h4></div><label class="notification-toggle"><input type="checkbox" data-notification-enabled ${current.enabled === false ? '' : 'checked'}> Enviar mensagem</label></header><div class="notification-body"><div class="notification-image">${current.imageUrl ? `<img src="${esc(preview(current.imageUrl))}" alt="">` : '<span>✉</span>'}</div><div class="notification-fields"><label>Título do e-mail<input data-notification-title value="${esc(current.title)}"></label><label>Mensagem<textarea data-notification-message rows="3">${esc(current.message)}</textarea></label><label>URL da imagem opcional<input data-notification-image value="${esc(current.imageUrl)}" placeholder="https://..."></label><div class="notification-image-actions"><label class="option-upload">Enviar imagem<input type="file" accept="image/jpeg,image/png,image/webp" data-notification-upload></label><button type="button" data-remove-notification-image ${current.imageUrl ? '' : 'hidden'}>Remover imagem</button></div></div></div></article>`;
    }).join('');
    editor.querySelectorAll('[data-notification]').forEach(card => {
      const event = card.dataset.notification;
      const entry = notifications[event];
      card.querySelector('[data-notification-enabled]').onchange = change => {
        entry.enabled = change.target.checked;
        card.classList.toggle('disabled', !entry.enabled);
      };
      card.querySelector('[data-notification-title]').oninput = change => { entry.title = change.target.value; };
      card.querySelector('[data-notification-message]').oninput = change => { entry.message = change.target.value; };
      card.querySelector('[data-notification-image]').onchange = change => { entry.imageUrl = change.target.value.trim(); renderCrmNotifications(); };
      card.querySelector('[data-notification-upload]').onchange = change => upload(change.target, 'notification', event);
      card.querySelector('[data-remove-notification-image]').onclick = () => { entry.imageUrl = ''; renderCrmNotifications(); };
    });
  }

  function collectCrmNotifications() {
    const notifications = catalog.settings.crmNotifications || (catalog.settings.crmNotifications = {});
    $('#crm-notifications-editor').querySelectorAll('[data-notification]').forEach(card => {
      notifications[card.dataset.notification] = {
        enabled: card.querySelector('[data-notification-enabled]').checked,
        title: card.querySelector('[data-notification-title]').value.trim(),
        message: card.querySelector('[data-notification-message]').value.trim(),
        imageUrl: card.querySelector('[data-notification-image]').value.trim()
      };
    });
  }

  function updateMakeWebhookStatus(text, error = false) {
    const element = $('#make-webhook-status');
    if (!element) return;
    element.textContent = text;
    element.className = error ? 'error' : 'ok';
  }

  function renderHoursEditor() {
    const hours = catalog.settings.hours || defaultHours();
    $('#hours-editor').innerHTML = weekDays.map(([key, label]) => {
      const day = hours[key] || { enabled: false, open: '18:00', close: '23:00' };
      return `<div class="hours-row ${day.enabled ? '' : 'disabled'}" data-hours-row="${key}">
        <label><input type="checkbox" data-hours-enabled="${key}" ${day.enabled ? 'checked' : ''}> ${label}</label>
        <input type="time" aria-label="Abertura de ${label}" data-hours-open="${key}" value="${esc(day.open || '18:00')}" ${day.enabled ? '' : 'disabled'}>
        <input type="time" aria-label="Fechamento de ${label}" data-hours-close="${key}" value="${esc(day.close || '23:00')}" ${day.enabled ? '' : 'disabled'}>
      </div>`;
    }).join('');
    $('#hours-editor').querySelectorAll('[data-hours-enabled]').forEach(input => {
      input.onchange = () => {
        const row = input.closest('[data-hours-row]');
        row.classList.toggle('disabled', !input.checked);
        row.querySelectorAll('input[type=time]').forEach(field => { field.disabled = !input.checked; });
        updateLiveStoreStatus();
      };
    });
    $('#hours-editor').querySelectorAll('input').forEach(input => {
      input.addEventListener('change', updateLiveStoreStatus);
    });
    updateLiveStoreStatus();
  }

  function collectHours() {
    const hours = {};
    weekDays.forEach(([key]) => {
      hours[key] = {
        enabled: Boolean($(`[data-hours-enabled="${key}"]`)?.checked),
        open: $(`[data-hours-open="${key}"]`)?.value || '18:00',
        close: $(`[data-hours-close="${key}"]`)?.value || '23:00'
      };
    });
    catalog.settings.hours = hours;
  }

  function statusPreview() {
    const mode = $('#store-status-mode')?.value || catalog.settings.statusMode || 'open';
    if (mode === 'open') return '● Loja aberta manualmente e recebendo pedidos';
    if (mode === 'closed') return '● Loja fechada manualmente e sem receber pedidos';
    collectHours();
    const now = new Date();
    const keys = weekDays.map(([key]) => key);
    const key = keys[now.getDay()];
    const current = catalog.settings.hours[key];
    if (!current?.enabled) return '● Fechada hoje pelo horário automático';
    const value = now.getHours() * 60 + now.getMinutes();
    const toMinutes = time => {
      const [hour, minute] = String(time || '00:00').split(':').map(Number);
      return hour * 60 + minute;
    };
    const start = toMinutes(current.open);
    const end = toMinutes(current.close);
    const opened = end > start ? value >= start && value < end : value >= start || value < end;
    return opened
      ? `● Aberta automaticamente até ${current.close}`
      : `● Fechada agora · horário de hoje ${current.open}–${current.close}`;
  }

  function updateLiveStoreStatus() {
    const element = $('#live-store-status');
    if (element) element.textContent = statusPreview();
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: catalog.settings.timezone || 'America/Porto_Velho',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function shiftDateKey(key, days) {
    const date = new Date(`${key}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function ordersForPeriod(period, customDate) {
    if (period === 'all') return orders;
    const today = localDateKey(new Date());
    const target = period === 'yesterday' ? shiftDateKey(today, -1) : period === 'custom' ? customDate : today;
    if (period === 'today' || period === 'yesterday' || period === 'custom') {
      return orders.filter(order => localDateKey(order.created_at || order.createdAt) === target);
    }
    const days = period === '30days' ? 29 : 6;
    const start = shiftDateKey(today, -days);
    return orders.filter(order => {
      const key = localDateKey(order.created_at || order.createdAt);
      return key >= start && key <= today;
    });
  }

  function filteredOrders() {
    return ordersForPeriod(orderPeriod, customOrderDate);
  }

  function periodLabel(period, customDate) {
    return ({ today: 'hoje', yesterday: 'ontem', '7days': 'nos últimos 7 dias', '30days': 'nos últimos 30 dias', all: 'em todo o histórico' })[period]
      || (customDate ? `em ${customDate.split('-').reverse().join('/')}` : 'na data escolhida');
  }

  function orderPeriodLabel() {
    return periodLabel(orderPeriod, customOrderDate);
  }

  function renderAll() {
    renderDashboard();
    renderOrders();
    renderCustomers();
    renderProducts();
    renderCategories();
    renderPreviews();
  }

  function renderDashboard() {
    const periodOrders = ordersForPeriod(dashboardPeriod, customDashboardDate);
    const validOrders = periodOrders.filter(order => order.status !== 'cancelado');
    const pending = orders.filter(order => ['novo', 'confirmado', 'preparando', 'saiu_entrega'].includes(order.status));
    const revenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const average = validOrders.length ? revenue / validOrders.length : 0;
    $('#stat-orders').textContent = validOrders.length;
    $('#stat-revenue').textContent = money(revenue);
    $('#stat-average').textContent = money(average);
    $('#stat-pending').textContent = pending.length;
    $('#pending-badge').textContent = pending.length;
    $('#dashboard-revenue-total').textContent = money(revenue);
    $('#revenue-chart-title').textContent = `Movimento ${periodLabel(dashboardPeriod, customDashboardDate)}`;
    $('#recent-orders').innerHTML = pending.length
      ? pending.slice(0, 8).map(order => `<div class="recent"><span><b>${esc(order.order_number || order.number)}</b><small>${esc(order.customer?.name || '')}</small></span><strong>${money(order.total)}</strong><em data-status="${esc(order.status)}">${esc(statusLabel(order.status))}</em></div>`).join('')
      : '<div class="empty-admin compact">Nenhum pedido em andamento.</div>';

    const revenueByDate = new Map();
    validOrders.forEach(order => {
      const key = localDateKey(order.created_at || order.createdAt);
      if (key) revenueByDate.set(key, (revenueByDate.get(key) || 0) + Number(order.total || 0));
    });
    const series = [...revenueByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-10);
    const highest = Math.max(1, ...series.map(([, value]) => value));
    $('#revenue-chart').innerHTML = series.length
      ? series.map(([date, value]) => `<div class="revenue-bar" title="${esc(date.split('-').reverse().join('/'))}: ${esc(money(value))}"><b>${esc(money(value))}</b><span><i style="height:${Math.max(8, Math.round((value / highest) * 100))}%"></i></span><small>${esc(date.slice(5).split('-').reverse().join('/'))}</small></div>`).join('')
      : '<div class="empty-admin compact">Ainda não há faturamento neste período.</div>';
    const settings = catalog.settings;
    const modeLabels = { auto: 'Automático por horário', open: 'Aberta manualmente', closed: 'Fechada manualmente' };
    $('#operation-summary').innerHTML = `<p><span>Funcionamento</span><b>${esc(modeLabels[settings.statusMode] || modeLabels.open)}</b></p><p><span>Produtos ativos</span><b>${catalog.products.filter(product => product.active).length}</b></p><p><span>Cancelados no período</span><b>${periodOrders.filter(order => order.status === 'cancelado').length}</b></p><p><span>Pedido mínimo</span><b>${money(settings.minOrder)}</b></p><p><span>Taxa de entrega</span><b>${money(settings.deliveryFee)}</b></p><p><span>Tempo estimado</span><b>${esc(settings.estimatedTime)}</b></p>`;
  }

  function normalizedPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.startsWith('55') && digits.length > 11 ? digits.slice(2, 13) : digits.slice(-11);
  }

  function customerAddress(address = {}) {
    return [
      [address.street, address.number].filter(Boolean).join(', '),
      address.complement,
      address.neighborhood,
      address.city,
      address.zip ? `CEP ${address.zip}` : '',
      address.reference ? `Ref. ${address.reference}` : ''
    ].filter(Boolean).join(' · ');
  }

  function customerBase() {
    const base = new Map();
    orders.forEach(order => {
      const customer = order.customer || {};
      const phone = normalizedPhone(customer.phone);
      const email = String(customer.email || '').trim().toLowerCase();
      const key = phone || email || `pedido-${order.id}`;
      const date = new Date(order.created_at || order.createdAt || 0);
      const current = base.get(key);
      if (!current) {
        base.set(key, {
          key,
          name: String(customer.name || '').trim(),
          phone: String(customer.phone || '').trim(),
          phoneDigits: phone,
          email,
          address: customerAddress(order.address),
          marketingConsent: customer.marketingConsent === true,
          marketingConsentAt: customer.marketingConsentAt || '',
          firstOrder: date,
          lastOrder: date,
          orderCount: 1,
          totalSpent: order.status === 'cancelado' ? 0 : Number(order.total || 0)
        });
        return;
      }
      current.orderCount += 1;
      current.totalSpent += order.status === 'cancelado' ? 0 : Number(order.total || 0);
      if (date < current.firstOrder) current.firstOrder = date;
      if (date > current.lastOrder) current.lastOrder = date;
    });
    return [...base.values()].sort((a, b) => b.lastOrder - a.lastOrder);
  }

  function filteredCustomers() {
    const query = customerQuery.toLocaleLowerCase('pt-BR');
    return customerBase().filter(customer => {
      if (customerConsentFilter === 'yes' && !customer.marketingConsent) return false;
      if (customerConsentFilter === 'no' && customer.marketingConsent) return false;
      if (!query) return true;
      return `${customer.name} ${customer.phone} ${customer.email} ${customer.address}`.toLocaleLowerCase('pt-BR').includes(query);
    });
  }

  function formatCustomerDate(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return '-';
    return value.toLocaleDateString('pt-BR');
  }

  function renderCustomers() {
    const all = customerBase();
    const visible = filteredCustomers();
    $('#customers-badge').textContent = all.length;
    $('#stat-customers').textContent = all.length;
    $('#stat-customer-emails').textContent = all.filter(customer => customer.email).length;
    $('#stat-marketing-consent').textContent = all.filter(customer => customer.marketingConsent).length;
    $('#stat-returning-customers').textContent = all.filter(customer => customer.orderCount > 1).length;
    $('#customers-list').innerHTML = visible.length ? '<div class="customer-table-head"><span>Cliente</span><span>Contato</span><span>Endereço</span><span>Relacionamento</span><span>Último pedido</span></div>' + visible.map(customer => {
      const whatsapp = customer.phoneDigits ? `55${customer.phoneDigits}` : '';
      return `<article class="customer-row"><div data-label="Cliente"><b>${esc(customer.name || 'Sem nome')}</b><small>${customer.orderCount} pedido${customer.orderCount === 1 ? '' : 's'} · ${money(customer.totalSpent)}</small></div><div data-label="Contato">${whatsapp ? `<a href="https://wa.me/${esc(whatsapp)}" target="_blank" rel="noopener">${esc(customer.phone)}</a>` : '<span>-</span>'}${customer.email ? `<a href="mailto:${esc(customer.email)}">${esc(customer.email)}</a>` : '<small>Sem e-mail</small>'}</div><div data-label="Endereço"><span>${esc(customer.address || 'Não informado')}</span></div><div data-label="Relacionamento"><em class="consent-badge ${customer.marketingConsent ? 'allowed' : ''}">${customer.marketingConsent ? '✓ Aceitou ofertas' : 'Sem autorização'}</em></div><div data-label="Último pedido"><b>${esc(formatCustomerDate(customer.lastOrder))}</b><small>Cliente desde ${esc(formatCustomerDate(customer.firstOrder))}</small></div></article>`;
    }).join('') : '<div class="empty-admin">Nenhum cliente encontrado com estes filtros.</div>';
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
  }

  function exportCustomers() {
    const customers = filteredCustomers();
    if (!customers.length) {
      notice('Não há clientes para exportar com estes filtros.', true);
      return;
    }
    const header = ['Nome', 'Telefone', 'Email', 'Endereco', 'Aceitou ofertas', 'Data do consentimento', 'Pedidos', 'Total comprado', 'Primeiro pedido', 'Ultimo pedido'];
    const rows = customers.map(customer => [
      customer.name, customer.phone, customer.email, customer.address,
      customer.marketingConsent ? 'SIM' : 'NAO', customer.marketingConsentAt,
      customer.orderCount, customer.totalSpent.toFixed(2).replace('.', ','),
      formatCustomerDate(customer.firstOrder), formatCustomerDate(customer.lastOrder)
    ]);
    const csv = '\ufeff' + [header, ...rows].map(row => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `clientes-acai-do-bom-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice(`${customers.length} cliente${customers.length === 1 ? '' : 's'} exportado${customers.length === 1 ? '' : 's'} para a planilha.`);
  }

  function statusLabel(status) {
    return ({
      novo: 'Novo', confirmado: 'Confirmado', preparando: 'Preparando',
      saiu_entrega: 'Saiu para entrega', concluido: 'Concluído', cancelado: 'Cancelado'
    })[status] || status;
  }

  function paymentLabel(method) {
    return ({
      pix: 'PIX', card_delivery: 'Cartão na entrega', cash: 'Dinheiro',
      payment_link: 'Pagamento on-line'
    })[method] || method || 'Não informado';
  }

  function buildOrderNote(order) {
    const customer = order.customer || {};
    const address = order.address || {};
    const lines = [
      `AÇAÍ DO BOM — ${order.order_number}`,
      `Data: ${new Date(order.created_at).toLocaleString('pt-BR')}`,
      '',
      `CLIENTE: ${customer.name || '-'}`,
      `WhatsApp: ${customer.phone || '-'}`
    ];
    if (customer.email) lines.push(`E-mail: ${customer.email}`);
    lines.push('', 'ITENS DO PEDIDO');
    (order.items || []).forEach((item, index) => {
      lines.push(`${index + 1}. ${Number(item.quantity || 1)}x ${item.name} — ${money(Number(item.unitTotal || 0) * Number(item.quantity || 1))}`);
      (item.selections || []).forEach(selection => {
        lines.push(`   ${selection.groupName}: ${(selection.options || []).map(option => option.name).join(', ')}`);
      });
      if (item.notes) lines.push(`   Observação: ${item.notes}`);
    });
    lines.push('', `Subtotal: ${money(order.subtotal)}`, `Entrega: ${money(order.delivery_fee)}`, `TOTAL: ${money(order.total)}`, '', `Pagamento: ${paymentLabel(order.payment_method)}`);
    if (order.fulfillment === 'delivery') {
      lines.push('', 'ENDEREÇO DE ENTREGA', `${address.street || ''}, ${address.number || ''}${address.complement ? ` — ${address.complement}` : ''}`, `${address.neighborhood || ''} — ${address.city || ''}${address.zip ? ` — CEP ${address.zip}` : ''}`);
      if (address.reference) lines.push(`Referência: ${address.reference}`);
      if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
    } else {
      lines.push('', 'RETIRADA NO LOCAL');
    }
    if (order.notes) lines.push('', `OBSERVAÇÕES: ${order.notes}`);
    return lines.join('\n');
  }

  function nextOrderAction(order) {
    if (order.status === 'novo') return { status: 'confirmado', label: '✓ Confirmar pedido' };
    if (order.status === 'confirmado') return { status: 'preparando', label: '▶ Iniciar preparo' };
    if (order.status === 'preparando') return order.fulfillment === 'pickup'
      ? { status: 'concluido', label: '✓ Finalizar retirada' }
      : { status: 'saiu_entrega', label: '🛵 Saiu para entrega' };
    if (order.status === 'saiu_entrega') return { status: 'concluido', label: '✓ Concluir pedido' };
    return null;
  }

  function renderOrders() {
    const box = $('#orders-list');
    const visibleOrders = filteredOrders();
    const cancelledCount = orders.filter(order => order.status === 'cancelado').length;
    $('#delete-cancelled-orders').hidden = cancelledCount === 0;
    $('#delete-cancelled-orders').textContent = `🗑 Apagar cancelados (${cancelledCount})`;
    $('#order-filter-summary').textContent = `${visibleOrders.length} pedido${visibleOrders.length === 1 ? '' : 's'} ${orderPeriodLabel()}`;
    if (!visibleOrders.length) {
      box.className = 'orders';
      box.innerHTML = `<div class="card empty-admin order-filter-empty">Nenhum pedido encontrado ${esc(orderPeriodLabel())}.</div>`;
      return;
    }
    box.innerHTML = visibleOrders.map(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      const customer = order.customer || {};
      const address = order.address || {};
      const phone = String(customer.phone || '').replace(/\D/g, '');
      const whatsappPhone = phone.startsWith('55') ? phone : `55${phone}`;
      const itemsHtml = items.map(item => {
        const additions = (item.selections || []).map(selection => {
          const options = (selection.options || []).map(option => `${esc(option.name)}${Number(option.price || 0) ? ` (+${money(option.price)})` : ''}`).join(', ');
          return `<small><b>${esc(selection.groupName)}:</b> ${options}</small>`;
        }).join('');
        return `<div class="order-item"><b>${Number(item.quantity || 1)}x ${esc(item.name)}</b><strong>${money(Number(item.unitTotal || 0) * Number(item.quantity || 1))}</strong>${additions}${item.notes ? `<small><b>Observação:</b> ${esc(item.notes)}</small>` : ''}</div>`;
      }).join('');
      const mapUrl = /^https:\/\/www\.google\.com\/maps\//.test(address.mapUrl || '') ? address.mapUrl : '';
      const addressHtml = order.fulfillment === 'delivery'
        ? `<div class="order-address"><b>📍 Endereço de entrega</b><br>${esc(address.street)}, ${esc(address.number)}${address.complement ? ` — ${esc(address.complement)}` : ''}<br>${esc(address.neighborhood)} — ${esc(address.city)}${address.zip ? ` — CEP ${esc(address.zip)}` : ''}${address.reference ? `<br><b>Referência:</b> ${esc(address.reference)}` : ''}${mapUrl ? `<br><a class="map-link" href="${esc(mapUrl)}" target="_blank" rel="noopener">Abrir localização no mapa</a>` : ''}</div>`
        : '<div class="order-address"><b>🏪 Retirada no local</b><br>Cliente buscará o pedido na loja.</div>';
      const paymentClass = order.payment_status === 'pago' ? 'paid' : order.payment_status === 'estornado' ? 'refunded' : 'pending';
      const nextAction = nextOrderAction(order);
      const storeEmailStatus = order.store_email_status || 'nao_enviado';
      const customerEmailStatus = order.customer_email_status || 'nao_enviado';
      const emailClass = status => status === 'enviado' ? 'sent' : status === 'erro' ? 'error' : 'pending';
      const storeEmailText = storeEmailStatus === 'enviado' ? 'Loja: nota enviada' : storeEmailStatus === 'erro' ? 'Loja: erro no envio' : 'Loja: nota pendente';
      const customerEmailText = customerEmailStatus === 'enviado' ? 'Cliente: e-mail enviado' : customerEmailStatus === 'erro' ? 'Cliente: erro no envio' : 'Cliente: e-mail pendente';
      const customerEmailEvent = ({ confirmado: 'confirmed', preparando: 'preparing', saiu_entrega: 'out_for_delivery', concluido: 'completed', cancelado: 'cancelled' })[order.status];
      const customerEmailEnabled = !customerEmailEvent || catalog.settings.crmNotifications?.[customerEmailEvent]?.enabled !== false;
      const customerEmailDisplay = customerEmailEvent && !customerEmailEnabled ? 'Cliente: aviso desta etapa desativado' : customerEmailText;
      const retryStoreEmail = storeEmailStatus !== 'enviado'
        ? `<button type="button" class="retry-email" data-email-event="created" data-order-id="${esc(order.id)}">✉ Enviar nota à loja</button>`
        : '';
      const retryCustomerEmail = customer.email && customerEmailEvent && customerEmailEnabled && customerEmailStatus !== 'enviado'
        ? `<button type="button" class="retry-email" data-email-event="${esc(customerEmailEvent)}" data-order-id="${esc(order.id)}">✉ Reenviar ao cliente</button>`
        : '';
      const nextButton = nextAction ? `<button type="button" class="next-order" data-fast-status="${esc(nextAction.status)}" data-order-id="${esc(order.id)}">${esc(nextAction.label)}</button>` : '';
      const cancelButton = !['concluido', 'cancelado'].includes(order.status) ? `<button type="button" class="cancel-order" data-fast-status="cancelado" data-order-id="${esc(order.id)}">Cancelar pedido</button>` : '';
      const paymentButton = order.payment_status === 'pago'
        ? `<button type="button" class="undo-paid" data-fast-payment="pendente" data-order-id="${esc(order.id)}">Desfazer pagamento</button>`
        : `<button type="button" class="mark-paid" data-fast-payment="pago" data-order-id="${esc(order.id)}">R$ Marcar como pago</button>`;
      return `<article class="order-ticket status-${esc(order.status)}" data-order-card="${esc(order.id)}"><header class="ticket-head"><div><div class="ticket-title"><b>${esc(order.order_number)}</b><span class="status-badge" data-status="${esc(order.status)}">${esc(statusLabel(order.status))}</span></div><small>${new Date(order.created_at).toLocaleString('pt-BR')}</small></div><strong>${money(order.total)}</strong></header>` +
        `<div class="customer"><span><small>CLIENTE</small><b>${esc(customer.name)}</b></span><span><small>WHATSAPP</small>${phone ? `<a href="https://wa.me/${whatsappPhone}" target="_blank" rel="noopener">${esc(customer.phone)}</a>` : '-'}</span><span><small>RECEBIMENTO</small>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</span>${customer.email ? `<span><small>E-MAIL</small>${esc(customer.email)}</span>` : ''}</div>` +
        `<h4 class="order-section-title">ITENS DO PEDIDO</h4><div class="order-items">${itemsHtml}</div>${addressHtml}` +
        `<div class="order-meta"><span>Pagamento: ${esc(paymentLabel(order.payment_method))}</span><span class="payment-badge ${paymentClass}">${order.payment_status === 'pago' ? 'Pagamento confirmado' : order.payment_status === 'estornado' ? 'Pagamento estornado' : 'Pagamento pendente'}</span><span class="email-status ${emailClass(storeEmailStatus)}">${esc(storeEmailText)}</span>${customer.email ? `<span class="email-status ${customerEmailEnabled ? emailClass(customerEmailStatus) : 'disabled'}">${esc(customerEmailDisplay)}</span>` : ''}</div>` +
        (order.notes ? `<div class="order-notes"><b>Observações gerais:</b> ${esc(order.notes)}</div>` : '') +
        `<div class="order-totals"><div><span>Subtotal</span><b>${money(order.subtotal)}</b></div><div><span>Taxa de entrega</span><b>${money(order.delivery_fee)}</b></div><div class="grand-total"><span>TOTAL</span><b>${money(order.total)}</b></div></div>` +
        `<footer class="order-footer"><div class="order-actions"><button type="button" data-toggle-order="${esc(order.id)}">Ver nota completa</button><button type="button" data-copy-order="${esc(order.id)}">▣ Copiar nota</button>${phone ? `<a href="https://wa.me/${whatsappPhone}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${nextButton}${paymentButton}${cancelButton}${retryStoreEmail}${retryCustomerEmail}<button type="button" class="delete-order" data-delete-order="${esc(order.id)}">🗑 Excluir pedido</button></div>` +
        `<div class="order-selects"><select aria-label="Status do pedido" data-order-status="${esc(order.id)}">${['novo', 'confirmado', 'preparando', 'saiu_entrega', 'concluido', 'cancelado'].map(value => `<option ${order.status === value ? 'selected' : ''} value="${value}">${statusLabel(value)}</option>`).join('')}</select>` +
        `<select aria-label="Status do pagamento" data-payment-status="${esc(order.id)}"><option ${order.payment_status === 'pendente' ? 'selected' : ''} value="pendente">Pagamento pendente</option><option ${order.payment_status === 'pago' ? 'selected' : ''} value="pago">Pagamento pago</option><option ${order.payment_status === 'estornado' ? 'selected' : ''} value="estornado">Pagamento estornado</option></select></div></footer></article>`;
    }).join('');
    organizeOrdersView(box);
    box.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => updateOrder(select.dataset.orderStatus || select.dataset.paymentStatus));
    });
    box.querySelectorAll('[data-fast-status]').forEach(button => {
      button.addEventListener('click', () => updateOrder(button.dataset.orderId, { status: button.dataset.fastStatus }));
    });
    box.querySelectorAll('[data-fast-payment]').forEach(button => {
      button.addEventListener('click', () => updateOrder(button.dataset.orderId, { paymentStatus: button.dataset.fastPayment }));
    });
    box.querySelectorAll('[data-delete-order]').forEach(button => {
      button.addEventListener('click', () => openOrderDelete(button.dataset.deleteOrder));
    });
    box.querySelectorAll('[data-email-event]').forEach(button => {
      button.addEventListener('click', () => resendOrderEmail(button.dataset.orderId, button.dataset.emailEvent));
    });
    box.querySelectorAll('[data-copy-order]').forEach(button => {
      button.addEventListener('click', async () => {
        const order = orders.find(item => String(item.id) === String(button.dataset.copyOrder));
        if (!order) return;
        try {
          await navigator.clipboard.writeText(buildOrderNote(order));
          notice('Nota do pedido copiada.');
        } catch (error) {
          notice('Não foi possível copiar a nota.', true);
        }
      });
    });
    box.querySelectorAll('[data-toggle-order]').forEach(button => {
      button.addEventListener('click', () => {
        const card = button.closest('[data-order-card]');
        const expanded = card.classList.toggle('expanded');
        button.textContent = expanded ? 'Recolher nota' : 'Ver nota completa';
      });
    });
  }

  function organizeOrdersView(box) {
    const cards = [...box.querySelectorAll('[data-order-card]')];
    if (orderView === 'list') {
      box.className = 'orders orders-list-view';
      return;
    }
    box.className = 'orders orders-board';
    const stages = [
      ['novo', 'Novos'], ['confirmado', 'Confirmados'], ['preparando', 'Em preparo'],
      ['saiu_entrega', 'Em entrega'], ['concluido', 'Concluídos'], ['cancelado', 'Cancelados']
    ];
    const fragment = document.createDocumentFragment();
    stages.forEach(([status, label]) => {
      const stageCards = cards.filter(card => card.classList.contains(`status-${status}`));
      const column = document.createElement('section');
      column.className = `order-column column-${status}`;
      column.innerHTML = `<header><b>${label}</b><span>${stageCards.length}</span></header><div class="order-column-body"></div>`;
      stageCards.forEach(card => column.querySelector('.order-column-body').appendChild(card));
      fragment.appendChild(column);
    });
    box.replaceChildren(fragment);
  }

  async function updateOrder(id, changes = {}) {
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return;
    const statusSelect = $(`[data-order-status="${CSS.escape(id)}"]`);
    const paymentSelect = $(`[data-payment-status="${CSS.escape(id)}"]`);
    let status = changes.status || statusSelect?.value || order.status;
    const paymentStatus = changes.paymentStatus || paymentSelect?.value || order.payment_status;
    if (changes.paymentStatus === 'pago' && order.status === 'novo' && !changes.status) status = 'confirmado';
    if (status === order.status && paymentStatus === order.payment_status) return;
    const statusEvents = {
      confirmado: 'confirmed', preparando: 'preparing', saiu_entrega: 'out_for_delivery',
      concluido: 'completed', cancelado: 'cancelled'
    };
    const emailEvents = [];
    if (status !== order.status && statusEvents[status] && catalog.settings.crmNotifications?.[statusEvents[status]]?.enabled !== false) emailEvents.push(statusEvents[status]);
    if (paymentStatus !== order.payment_status && paymentStatus === 'pago' && !emailEvents.includes('confirmed')) emailEvents.push('payment_paid');
    if (paymentStatus !== order.payment_status && paymentStatus === 'estornado') emailEvents.push('payment_refunded');
    try {
      const result = await SupabaseStore.updateOrder(id, status, paymentStatus, emailEvents);
      order.status = status;
      order.payment_status = paymentStatus;
      (result.notifications || []).forEach(notification => {
        if (notification.ok && notification.result?.sent) order.customer_email_status = 'enviado';
        else if (!notification.ok) order.customer_email_status = 'erro';
      });
      renderDashboard();
      renderOrders();
      renderCustomers();
      const failedEmail = (result.notifications || []).some(notification => !notification.ok);
      notice(failedEmail ? 'Pedido atualizado. O e-mail ficou pendente para revisão.' : 'Pedido atualizado e movido automaticamente no CRM.', failedEmail);
    } catch (error) {
      notice(error.message, true);
    }
  }

  async function resendOrderEmail(id, event) {
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return;
    try {
      const result = await SupabaseStore.notifyOrderEmail(id, event);
      if (!result.sent) throw new Error(result.error || (result.configured === false ? 'Ative o webhook do Make nas configurações.' : 'O e-mail não foi enviado.'));
      if (event === 'created') order.store_email_status = 'enviado';
      else order.customer_email_status = 'enviado';
      order.email_error = '';
      renderOrders();
      notice(event === 'created' ? 'Nota enviada à loja pelo Make.' : 'E-mail reenviado ao cliente pelo Make.');
    } catch (error) {
      if (event === 'created') order.store_email_status = 'erro';
      else order.customer_email_status = 'erro';
      order.email_error = error.message;
      renderOrders();
      notice(error.message, true);
    }
  }

  function openOrderDelete(id) {
    const order = orders.find(item => String(item.id) === String(id));
    if (!order) return;
    deletingOrderIds = [id];
    $('#order-delete-message').textContent = `Excluir ${order.order_number}? O pedido e o histórico de automações serão removidos definitivamente.`;
    $('#confirm-order-delete').hidden = false;
    document.body.classList.add('dialog-open');
  }

  function openCancelledOrdersDelete() {
    deletingOrderIds = orders.filter(order => order.status === 'cancelado').map(order => order.id);
    if (!deletingOrderIds.length) {
      notice('Não há pedidos cancelados para apagar.');
      return;
    }
    $('#order-delete-message').textContent = `Apagar ${deletingOrderIds.length} pedido${deletingOrderIds.length === 1 ? '' : 's'} cancelado${deletingOrderIds.length === 1 ? '' : 's'}? Esta ação remove definitivamente os pedidos e os históricos de automação relacionados.`;
    $('#confirm-order-delete').hidden = false;
    document.body.classList.add('dialog-open');
  }

  async function deleteSelectedOrder() {
    if (!deletingOrderIds.length) return;
    const button = $('#do-order-delete');
    button.disabled = true;
    button.textContent = 'Excluindo...';
    try {
      await SupabaseStore.deleteOrders(deletingOrderIds);
      const deleted = new Set(deletingOrderIds.map(String));
      orders = orders.filter(order => !deleted.has(String(order.id)));
      deletingOrderIds.forEach(id => knownOrderIds.delete(String(id)));
      renderDashboard();
      renderOrders();
      renderCustomers();
      notice(deleted.size === 1 ? 'Pedido excluído com segurança.' : `${deleted.size} pedidos cancelados foram apagados.`);
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Excluir pedido';
      $('#confirm-order-delete').hidden = true;
      document.body.classList.remove('dialog-open');
      deletingOrderIds = [];
    }
  }

  function renderProducts() {
    $('#product-count').textContent = `${catalog.products.length} produtos cadastrados`;
    $('#admin-products').innerHTML = catalog.products.map(product => {
      const category = catalog.categories.find(item => item.id === product.categoryId);
      const imageUrl = product.imageUrl || category?.imageUrl || '';
      return `<article><div class="product-thumb">${imageUrl ? `<img src="${esc(preview(imageUrl))}" alt="">` : '⬡'}${!product.active ? '<b>INATIVO</b>' : ''}</div>` +
        `<div><small>${esc(category?.name || '')}</small><h3>${esc(product.name)}</h3><strong>${money(product.price)}</strong>${product.freeShippingText ? `<em class="admin-free-shipping">● ${esc(product.freeShippingText)}</em>` : ''}<p>${(product.addonGroups || []).length} grupos de adicionais</p></div>` +
        `<footer><button data-edit="${esc(product.id)}">Editar</button><button data-delete="${esc(product.id)}">🗑</button></footer></article>`;
    }).join('');
    $('#admin-products').querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => openEditor(button.dataset.edit); });
    $('#admin-products').querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = () => {
        deleting = button.dataset.delete;
        $('#confirm-delete').hidden = false;
        document.body.classList.add('dialog-open');
      };
    });
  }

  function renderCategories() {
    $('#category-editor').innerHTML = catalog.categories.map(category => `
      <div class="category-row" data-category-row="${esc(category.id)}">
        <div class="category-thumb">${category.imageUrl ? `<img src="${esc(preview(category.imageUrl))}" alt="">` : esc(category.emoji || '🥣')}</div>
        <div class="category-fields">
          <input class="emoji" aria-label="Emoji da categoria" value="${esc(category.emoji || '🥣')}" data-cat-emoji="${esc(category.id)}">
          <input aria-label="Nome da categoria" value="${esc(category.name)}" data-cat-name="${esc(category.id)}">
        </div>
        <label class="category-upload">Trocar imagem<input type="file" accept="image/jpeg,image/png,image/webp" data-cat-upload="${esc(category.id)}"></label>
        <label class="category-active"><input type="checkbox" ${category.active ? 'checked' : ''} data-cat-active="${esc(category.id)}"> Ativa</label>
      </div>`).join('');
    $('#category-editor').querySelectorAll('[data-cat-emoji],[data-cat-name]').forEach(input => {
      input.oninput = () => {
        const id = input.dataset.catEmoji || input.dataset.catName;
        const category = catalog.categories.find(item => item.id === id);
        if (input.dataset.catEmoji) category.emoji = input.value;
        if (input.dataset.catName) category.name = input.value;
      };
    });
    $('#category-editor').querySelectorAll('[data-cat-active]').forEach(input => {
      input.onchange = () => {
        const category = catalog.categories.find(item => item.id === input.dataset.catActive);
        category.active = input.checked;
      };
    });
    $('#category-editor').querySelectorAll('[data-cat-upload]').forEach(input => {
      input.onchange = () => upload(input, 'category', input.dataset.catUpload);
    });
  }

  function renderInfoIcons() {
    const icons = catalog.settings.infoStripIcons || (catalog.settings.infoStripIcons = {});
    const definitions = [
      ['service', 'Atendimento', '📍'],
      ['time', 'Tempo estimado', '◷'],
      ['delivery', 'Taxa de entrega', '🛵'],
      ['payment', 'Pagamento', '💳']
    ];
    const editor = $('#info-icons-editor');
    editor.innerHTML = definitions.map(([key, label, fallback]) => `<div class="info-icon-row" data-info-icon-row="${key}"><div class="info-icon-preview">${icons[key] ? `<img src="${esc(preview(icons[key]))}" alt="">` : fallback}</div><div><b>${esc(label)}</b><input value="${esc(icons[key] || '')}" placeholder="URL da imagem" data-info-icon-url="${key}"></div><label class="option-upload">Enviar imagem<input type="file" accept="image/jpeg,image/png,image/webp" data-info-icon-upload="${key}"></label><button type="button" data-info-icon-remove="${key}" ${icons[key] ? '' : 'hidden'}>Remover</button></div>`).join('');
    editor.querySelectorAll('[data-info-icon-url]').forEach(input => {
      input.oninput = () => { icons[input.dataset.infoIconUrl] = input.value.trim(); };
      input.onchange = renderInfoIcons;
    });
    editor.querySelectorAll('[data-info-icon-upload]').forEach(input => {
      input.onchange = () => upload(input, 'infoIcon', input.dataset.infoIconUpload);
    });
    editor.querySelectorAll('[data-info-icon-remove]').forEach(button => {
      button.onclick = () => {
        icons[button.dataset.infoIconRemove] = '';
        renderInfoIcons();
      };
    });
  }

  function renderPreviews() {
    const settings = catalog.settings;
    $('#logo-preview').innerHTML = settings.logoUrl ? `<img src="${esc(preview(settings.logoUrl))}">` : 'A';
    $('#banner-preview').innerHTML = settings.bannerUrl ? `<img src="${esc(preview(settings.bannerUrl))}">` : '◈';
    const offerImage = settings.dailyOffer?.imageUrl || $('#daily-offer-image')?.value || '';
    $('#daily-offer-preview').innerHTML = offerImage ? `<img src="${esc(preview(offerImage))}" alt="">` : 'OFERTA';
    $$('.admin-logo img').forEach(image => { image.src = preview(settings.logoUrl || 'assets/images/logo/logo-acai-do-bom.webp'); });
  }

  function openEditor(id) {
    editing = id
      ? structuredClone(catalog.products.find(product => product.id === id))
      : { id: crypto.randomUUID(), name: '', description: '', categoryId: catalog.categories[0]?.id || 'destaques', price: 0, imageUrl: '', featured: false, active: true, badge: '', freeShippingText: '', addonGroups: [] };
    editing.addonGroups = editing.addonGroups || [];
    $('#editor-title').textContent = editing.name || 'Novo produto';
    $('#edit-name').value = editing.name;
    $('#edit-description').value = editing.description;
    $('#edit-price').value = editing.price;
    $('#edit-badge').value = editing.badge || '';
    $('#edit-free-shipping').value = editing.freeShippingText || '';
    $('#edit-image').value = editing.imageUrl || '';
    $('#edit-active').checked = editing.active;
    $('#edit-featured').checked = editing.featured;
    $('#edit-category').innerHTML = catalog.categories.map(category => `<option value="${esc(category.id)}" ${editing.categoryId === category.id ? 'selected' : ''}>${esc(`${category.emoji} ${category.name}`)}</option>`).join('');
    renderProductPhoto();
    renderGroups();
    $('#product-dialog').hidden = false;
    document.body.classList.add('dialog-open');
    requestAnimationFrame(() => $('#edit-name').focus());
  }

  function closeEditor() {
    $('#product-dialog').hidden = true;
    document.body.classList.remove('dialog-open');
    editing = null;
  }

  function renderProductPhoto() {
    $('#product-photo').innerHTML = editing?.imageUrl ? `<img src="${esc(preview(editing.imageUrl))}">` : '⬡';
    $('#remove-product-image').hidden = !editing?.imageUrl;
  }

  function renderGroups() {
    $('#addon-groups').innerHTML = (editing.addonGroups || []).map(group => {
      group.options = group.options || [];
      return `<article data-group="${esc(group.id)}"><header><input value="${esc(group.name)}" data-group-name><label><input type="checkbox" data-group-required ${group.required ? 'checked' : ''}> Obrigatório</label><label>Máx.<input type="number" min="1" value="${group.max || 1}" data-group-max></label><button type="button" data-remove-group>×</button></header>` +
        `<div class="options">${group.options.map(option => `<div class="option-row" data-option="${esc(option.id)}"><div class="option-thumb">${option.imageUrl ? `<img src="${esc(preview(option.imageUrl))}" alt="">` : '🥣'}</div><div class="option-fields"><input value="${esc(option.name)}" data-option-name placeholder="Nome do acompanhamento"><input value="${esc(option.imageUrl || '')}" data-option-image placeholder="URL da imagem"></div><label class="option-upload">Trocar imagem<input type="file" accept="image/jpeg,image/png,image/webp" data-option-upload></label><input class="option-price" aria-label="Preço adicional" type="number" step=".01" value="${Number(option.price || 0)}" data-option-price><button type="button" data-remove-option aria-label="Excluir acompanhamento">🗑</button></div>`).join('')}<button type="button" data-add-option>+ Adicionar opção</button></div></article>`;
    }).join('');
    $('#addon-groups').querySelectorAll('[data-group]').forEach(card => {
      const group = editing.addonGroups.find(item => item.id === card.dataset.group);
      card.querySelector('[data-group-name]').oninput = event => { group.name = event.target.value; };
      card.querySelector('[data-group-required]').onchange = event => { group.required = event.target.checked; group.min = event.target.checked ? 1 : 0; };
      card.querySelector('[data-group-max]').oninput = event => { group.max = Math.max(1, Number(event.target.value)); };
      card.querySelector('[data-remove-group]').onclick = () => { editing.addonGroups = editing.addonGroups.filter(item => item.id !== group.id); renderGroups(); };
      card.querySelector('[data-add-option]').onclick = () => { group.options.push({ id: crypto.randomUUID(), name: '', price: 0, imageUrl: '', available: true }); renderGroups(); };
      card.querySelectorAll('[data-option]').forEach(row => {
        const option = group.options.find(item => item.id === row.dataset.option);
        row.querySelector('[data-option-name]').oninput = event => { option.name = event.target.value; };
        row.querySelector('[data-option-price]').oninput = event => { option.price = Number(event.target.value); };
        row.querySelector('[data-option-image]').onchange = event => { option.imageUrl = event.target.value.trim(); renderGroups(); };
        row.querySelector('[data-option-upload]').onchange = event => upload(event.target, 'option', option.id);
        row.querySelector('[data-remove-option]').onclick = () => { group.options = group.options.filter(item => item.id !== option.id); renderGroups(); };
      });
    });
  }

  async function upload(input, target, referenceId = '') {
    const file = input.files[0];
    if (!file) return;
    const holder = input.closest('label');
    input.disabled = true;
    holder?.classList.add('busy');
    try {
      notice('Otimizando e enviando imagem...');
      const folders = { logo: 'logo', banner: 'banner', product: 'produtos', category: 'categorias', option: 'acompanhamentos', notification: 'mensagens', infoIcon: 'icones', offer: 'ofertas' };
      const url = await SupabaseStore.uploadImage(file, folders[target] || 'geral');
      if (target === 'logo') { catalog.settings.logoUrl = url; $('#logo-url').value = url; }
      if (target === 'banner') { catalog.settings.bannerUrl = url; $('#banner-url').value = url; }
      if (target === 'offer') {
        catalog.settings.dailyOffer.imageUrl = url;
        $('#daily-offer-image').value = url;
      }
      if (target === 'infoIcon') {
        catalog.settings.infoStripIcons[referenceId] = url;
        renderInfoIcons();
      }
      if (target === 'product' && editing) { editing.imageUrl = url; $('#edit-image').value = url; renderProductPhoto(); }
      if (target === 'category') {
        const category = catalog.categories.find(item => item.id === referenceId);
        if (category) category.imageUrl = url;
      }
      if (target === 'option' && editing) {
        const option = editing.addonGroups.flatMap(group => group.options || []).find(item => item.id === referenceId);
        if (option) option.imageUrl = url;
        renderGroups();
      }
      if (target === 'notification') {
        const notification = catalog.settings.crmNotifications?.[referenceId];
        if (notification) notification.imageUrl = url;
        renderCrmNotifications();
      }
      renderPreviews();
      if (target === 'logo' || target === 'banner' || target === 'category' || target === 'infoIcon' || target === 'offer') {
        await SupabaseStore.saveCatalog(catalog);
        if (target === 'category') renderCategories();
        notice('Imagem armazenada e publicada no cardápio.');
      } else {
        notice('Imagem armazenada. Confirme o produto para publicar.');
      }
    } catch (error) {
      notice(error.message, true);
    } finally {
      input.value = '';
      input.disabled = false;
      holder?.classList.remove('busy');
    }
  }

  async function saveAll() {
    collect();
    const button = $('#save-all');
    button.disabled = true;
    button.textContent = 'Publicando...';
    try {
      await SupabaseStore.saveCatalog(catalog);
      if (privateSettings.available || privateSettings.makeWebhookEnabled || privateSettings.makeWebhookUrl) {
        privateSettings = await SupabaseStore.savePrivateSettings(privateSettings);
        updateMakeWebhookStatus(privateSettings.makeWebhookEnabled ? 'Webhook salvo e automação ativada.' : 'Webhook salvo; automação desativada.');
      }
      notice('Alterações publicadas no cardápio.');
      renderAll();
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '✓ Publicar alterações';
    }
  }

  async function testMakeWebhook() {
    collect();
    const button = $('#test-make-webhook');
    button.disabled = true;
    button.textContent = 'Testando...';
    try {
      privateSettings = await SupabaseStore.savePrivateSettings(privateSettings);
      const result = await SupabaseStore.testMakeWebhook();
      if (!result.sent) throw new Error(result.error || 'O Make não confirmou o recebimento do teste.');
      updateMakeWebhookStatus('✓ Teste recebido pelo Make. Confira a execução do cenário e o Mailgun.');
      notice('Webhook do Make testado com sucesso.');
    } catch (error) {
      updateMakeWebhookStatus(error.message, true);
      notice(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Testar webhook';
    }
  }

  function startOrderPolling() {
    clearInterval(orderRefreshTimer);
    orderRefreshTimer = setInterval(() => {
      if (!document.hidden) refreshOrders(false);
    }, 8000);
  }

  async function refreshOrders(showConfirmation = true) {
    try {
      const nextOrders = await SupabaseStore.listOrders();
      const newOrders = nextOrders.filter(order => !knownOrderIds.has(String(order.id)));
      orders = nextOrders;
      knownOrderIds = new Set(orders.map(order => String(order.id)));
      renderDashboard();
      renderOrders();
      renderCustomers();
      if (newOrders.length) {
        notice(newOrders.length === 1 ? 'Novo pedido recebido!' : `${newOrders.length} novos pedidos recebidos!`);
        document.title = `(${newOrders.length}) Novo pedido | Açaí do Bom`;
      } else if (showConfirmation === true) {
        notice('Pedidos atualizados.');
      }
    } catch (error) {
      notice(error.message, true);
    }
  }

  function bind() {
    $('#login-form').addEventListener('submit', async event => {
      event.preventDefault();
      $('#login-error').hidden = true;
      const button = event.currentTarget.querySelector('button');
      button.disabled = true;
      button.textContent = 'Entrando...';
      try {
        await SupabaseStore.signIn($('#login-email').value.trim(), $('#login-password').value);
        await openAdmin();
      } catch (error) {
        showLoginError(error.message);
      } finally {
        button.disabled = false;
        button.textContent = 'Entrar com segurança';
      }
    });
    $('#logout').onclick = async event => { event.preventDefault(); clearInterval(orderRefreshTimer); await SupabaseStore.signOut(); location.reload(); };
    $$('[data-tab]').forEach(button => {
      button.onclick = () => {
        $$('[data-tab]').forEach(item => item.classList.toggle('active', item === button));
        $$('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === button.dataset.tab));
        if (button.dataset.tab === 'orders') { document.title = 'Pedidos | Açaí do Bom'; refreshOrders(false); }
        if (button.dataset.tab === 'customers') { document.title = 'Clientes | Açaí do Bom'; refreshOrders(false); }
      };
    });
    $('#save-all').onclick = saveAll;
    $('#refresh-orders').onclick = () => refreshOrders(true);
    $('#customer-search').oninput = event => { customerQuery = event.target.value.trim(); renderCustomers(); };
    $('#customer-consent-filter').onchange = event => { customerConsentFilter = event.target.value; renderCustomers(); };
    $('#export-customers').onclick = exportCustomers;
    $('#dashboard-period').onchange = event => {
      dashboardPeriod = event.target.value;
      $('#dashboard-date-field').hidden = dashboardPeriod !== 'custom';
      renderDashboard();
    };
    $('#dashboard-date').onchange = event => {
      customDashboardDate = event.target.value || localDateKey(new Date());
      if (dashboardPeriod === 'custom') renderDashboard();
    };
    $('#order-period').onchange = event => {
      orderPeriod = event.target.value;
      $('#order-date-field').hidden = orderPeriod !== 'custom';
      renderOrders();
    };
    $('#order-date').onchange = event => {
      customOrderDate = event.target.value || localDateKey(new Date());
      if (orderPeriod === 'custom') renderOrders();
    };
    $('#delete-cancelled-orders').onclick = openCancelledOrdersDelete;
    $('#order-board-view').onclick = () => {
      orderView = 'board';
      $('#order-board-view').classList.add('active');
      $('#order-list-view').classList.remove('active');
      renderOrders();
    };
    $('#order-list-view').onclick = () => {
      orderView = 'list';
      $('#order-list-view').classList.add('active');
      $('#order-board-view').classList.remove('active');
      renderOrders();
    };
    $('#new-product').onclick = () => openEditor();
    $$('[data-close-product]').forEach(button => { button.onclick = closeEditor; });
    $('#product-form').onsubmit = async event => {
      event.preventDefault();
      if (!editing) return;
      const button = $('#save-product');
      button.disabled = true;
      button.textContent = 'Publicando produto...';
      editing.name = $('#edit-name').value.trim();
      editing.description = $('#edit-description').value.trim();
      editing.price = Number($('#edit-price').value);
      editing.badge = $('#edit-badge').value.trim();
      editing.freeShippingText = $('#edit-free-shipping').value.trim();
      editing.imageUrl = $('#edit-image').value.trim();
      editing.active = $('#edit-active').checked;
      editing.featured = $('#edit-featured').checked;
      editing.categoryId = $('#edit-category').value;
      const index = catalog.products.findIndex(product => product.id === editing.id);
      if (index >= 0) catalog.products[index] = editing;
      else catalog.products.push(editing);
      try {
        await SupabaseStore.saveCatalog(catalog);
        closeEditor();
        renderProducts();
        renderDashboard();
        notice('Produto confirmado e publicado no cardápio.');
      } catch (error) {
        notice(error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Confirmar e publicar produto';
      }
    };
    $('#add-group').onclick = () => { editing.addonGroups.push({ id: crypto.randomUUID(), name: 'Novo grupo', required: false, min: 0, max: 1, options: [] }); renderGroups(); };
    $('#cancel-delete').onclick = () => {
      $('#confirm-delete').hidden = true;
      document.body.classList.remove('dialog-open');
      deleting = null;
    };
    $('#cancel-order-delete').onclick = () => {
      $('#confirm-order-delete').hidden = true;
      document.body.classList.remove('dialog-open');
      deletingOrderIds = [];
    };
    $('#do-order-delete').onclick = deleteSelectedOrder;
    $('#do-delete').onclick = async () => {
      const previous = catalog.products;
      catalog.products = catalog.products.filter(product => product.id !== deleting);
      try {
        await SupabaseStore.saveCatalog(catalog);
        notice('Produto excluído e cardápio atualizado.');
        renderProducts();
        renderDashboard();
      } catch (error) {
        catalog.products = previous;
        notice(error.message, true);
      } finally {
        $('#confirm-delete').hidden = true;
        document.body.classList.remove('dialog-open');
        deleting = null;
      }
    };
    $('#add-category').onclick = () => {
      catalog.categories.push({ id: crypto.randomUUID(), name: 'Nova categoria', emoji: '🥣', imageUrl: '', active: true });
      renderCategories();
    };
    $$('[data-upload]').forEach(input => { input.onchange = () => upload(input, input.dataset.upload); });
    $('#logo-url').oninput = event => { catalog.settings.logoUrl = event.target.value; renderPreviews(); };
    $('#banner-url').oninput = event => { catalog.settings.bannerUrl = event.target.value; renderPreviews(); };
    $('#daily-offer-image').oninput = event => { catalog.settings.dailyOffer.imageUrl = event.target.value.trim(); renderPreviews(); };
    $('#edit-image').oninput = event => { if (editing) { editing.imageUrl = event.target.value; renderProductPhoto(); } };
    $('#remove-product-image').onclick = () => {
      if (!editing) return;
      editing.imageUrl = '';
      $('#edit-image').value = '';
      renderProductPhoto();
    };
    $('#toggle-make-webhook').onclick = () => {
      const input = $('#make-webhook-url');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      $('#toggle-make-webhook').textContent = visible ? 'Mostrar URL' : 'Ocultar URL';
    };
    $('#test-make-webhook').onclick = testMakeWebhook;
    $('#store-status-mode').onchange = updateLiveStoreStatus;
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('#confirm-order-delete').hidden) $('#cancel-order-delete').click();
      else if (!$('#confirm-delete').hidden) $('#cancel-delete').click();
      else if (!$('#product-dialog').hidden) closeEditor();
    });
  }

  bind();
  boot();
})();
