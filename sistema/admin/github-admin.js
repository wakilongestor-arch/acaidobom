(function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const money = value => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  let catalog = { settings: {}, categories: [], products: [] };
  let orders = [];
  let editing = null;
  let deleting = null;
  let orderRefreshTimer = null;
  let knownOrderIds = new Set();
  const weekDays = [
    ['sun', 'Domingo'], ['mon', 'Segunda'], ['tue', 'Terça'], ['wed', 'Quarta'],
    ['thu', 'Quinta'], ['fri', 'Sexta'], ['sat', 'Sábado']
  ];
  const categoryDefaults = {
    acai: 'assets/images/categories/acai.jpg',
    lanches: 'assets/images/categories/lanches.jpg',
    pasteis: 'assets/images/categories/pasteis.jpg'
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
    set('primaryColor', '#620853');
    set('accentColor', '#fcd307');
    set('brandBrightColor', '#620853');
    if (typeof settings.autoOpenWhatsApp !== 'boolean') set('autoOpenWhatsApp', true);
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
      '#delivery-fee': 'deliveryFee', '#min-order': 'minOrder'
    };
    Object.entries(fields).forEach(([selector, key]) => { $(selector).value = settings[key] ?? ''; });
    $('#store-status-mode').value = settings.statusMode || 'open';
    renderHoursEditor();
    renderPreviews();
  }

  function collect() {
    const settings = catalog.settings;
    const fields = {
      '#logo-url': 'logoUrl', '#banner-url': 'bannerUrl', '#store-name': 'storeName',
      '#store-tagline': 'tagline', '#store-city': 'city', '#store-address': 'address',
      '#estimated-time': 'estimatedTime', '#store-whatsapp': 'whatsapp',
      '#order-email': 'orderEmail', '#pix-key': 'pixKey', '#payment-link': 'paymentLink',
      '#meta-pixel': 'metaPixelId', '#gtm-id': 'gtmId', '#ga4-id': 'ga4Id'
    };
    Object.entries(fields).forEach(([selector, key]) => { settings[key] = $(selector).value.trim(); });
    settings.deliveryFee = Number($('#delivery-fee').value);
    settings.minOrder = Number($('#min-order').value);
    settings.statusMode = $('#store-status-mode').value;
    settings.open = settings.statusMode !== 'closed';
    settings.primaryColor = '#620853';
    settings.accentColor = '#fcd307';
    settings.brandBrightColor = '#620853';
    collectHours();
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

  function renderAll() {
    renderDashboard();
    renderOrders();
    renderProducts();
    renderCategories();
    renderPreviews();
  }

  function renderDashboard() {
    const today = new Date().toLocaleDateString('en-CA');
    const todays = orders.filter(order => {
      const date = new Date(order.created_at || order.createdAt);
      return !Number.isNaN(date.valueOf()) && date.toLocaleDateString('en-CA') === today;
    });
    const pending = orders.filter(order => ['novo', 'confirmado', 'preparando', 'saiu_entrega'].includes(order.status));
    $('#stat-orders').textContent = todays.length;
    $('#stat-revenue').textContent = money(todays.reduce((sum, order) => sum + Number(order.total), 0));
    $('#stat-pending').textContent = pending.length;
    $('#pending-badge').textContent = pending.length;
    $('#stat-products').textContent = catalog.products.filter(product => product.active).length;
    $('#recent-orders').innerHTML = orders.length
      ? orders.slice(0, 6).map(order => `<div class="recent"><span><b>${esc(order.order_number || order.number)}</b><small>${esc(order.customer?.name || '')}</small></span><strong>${money(order.total)}</strong><em data-status="${esc(order.status)}">${esc(order.status)}</em></div>`).join('')
      : '<div class="empty-admin">Nenhum pedido ainda.</div>';
    const settings = catalog.settings;
    const modeLabels = { auto: 'Automático por horário', open: 'Aberta manualmente', closed: 'Fechada manualmente' };
    $('#operation-summary').innerHTML = `<p><span>Funcionamento</span><b>${esc(modeLabels[settings.statusMode] || modeLabels.open)}</b></p><p><span>Pedido mínimo</span><b>${money(settings.minOrder)}</b></p><p><span>Taxa de entrega</span><b>${money(settings.deliveryFee)}</b></p><p><span>Tempo estimado</span><b>${esc(settings.estimatedTime)}</b></p><p><span>WhatsApp</span><b>${esc(settings.whatsapp)}</b></p>`;
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
    } else {
      lines.push('', 'RETIRADA NO LOCAL');
    }
    if (order.notes) lines.push('', `OBSERVAÇÕES: ${order.notes}`);
    return lines.join('\n');
  }

  function renderOrders() {
    const box = $('#orders-list');
    if (!orders.length) {
      box.innerHTML = '<div class="card empty-admin">Nenhum pedido recebido.</div>';
      return;
    }
    box.innerHTML = orders.map(order => {
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
      const addressHtml = order.fulfillment === 'delivery'
        ? `<div class="order-address"><b>📍 Endereço de entrega</b><br>${esc(address.street)}, ${esc(address.number)}${address.complement ? ` — ${esc(address.complement)}` : ''}<br>${esc(address.neighborhood)} — ${esc(address.city)}${address.zip ? ` — CEP ${esc(address.zip)}` : ''}${address.reference ? `<br><b>Referência:</b> ${esc(address.reference)}` : ''}</div>`
        : '<div class="order-address"><b>🏪 Retirada no local</b><br>Cliente buscará o pedido na loja.</div>';
      return `<article class="order-ticket status-${esc(order.status)}"><header class="ticket-head"><div><div class="ticket-title"><b>${esc(order.order_number)}</b><span class="status-badge" data-status="${esc(order.status)}">${esc(statusLabel(order.status))}</span></div><small>${new Date(order.created_at).toLocaleString('pt-BR')}</small></div><strong>${money(order.total)}</strong></header>` +
        `<div class="customer"><span><small>CLIENTE</small><b>${esc(customer.name)}</b></span><span><small>WHATSAPP</small>${phone ? `<a href="https://wa.me/${whatsappPhone}" target="_blank" rel="noopener">${esc(customer.phone)}</a>` : '-'}</span><span><small>RECEBIMENTO</small>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</span>${customer.email ? `<span><small>E-MAIL</small>${esc(customer.email)}</span>` : ''}</div>` +
        `<h4 class="order-section-title">ITENS DO PEDIDO</h4><div class="order-items">${itemsHtml}</div>${addressHtml}` +
        `<div class="order-meta"><span>Pagamento: ${esc(paymentLabel(order.payment_method))}</span><span>${order.payment_status === 'pago' ? 'Pagamento confirmado' : 'Pagamento pendente'}</span></div>` +
        (order.notes ? `<div class="order-notes"><b>Observações gerais:</b> ${esc(order.notes)}</div>` : '') +
        `<div class="order-totals"><div><span>Subtotal</span><b>${money(order.subtotal)}</b></div><div><span>Taxa de entrega</span><b>${money(order.delivery_fee)}</b></div><div class="grand-total"><span>TOTAL</span><b>${money(order.total)}</b></div></div>` +
        `<footer class="order-footer"><div class="order-actions"><button type="button" data-copy-order="${esc(order.id)}">▣ Copiar nota</button>${phone ? `<a href="https://wa.me/${whatsappPhone}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button type="button" class="confirm-order" data-fast-status="confirmado" data-order-id="${esc(order.id)}">✓ Confirmar pedido</button><button type="button" class="cancel-order" data-fast-status="cancelado" data-order-id="${esc(order.id)}">Cancelar pedido</button></div>` +
        `<div class="order-selects"><select aria-label="Status do pedido" data-order-status="${esc(order.id)}">${['novo', 'confirmado', 'preparando', 'saiu_entrega', 'concluido', 'cancelado'].map(value => `<option ${order.status === value ? 'selected' : ''} value="${value}">${statusLabel(value)}</option>`).join('')}</select>` +
        `<select aria-label="Status do pagamento" data-payment-status="${esc(order.id)}"><option ${order.payment_status === 'pendente' ? 'selected' : ''} value="pendente">Pagamento pendente</option><option ${order.payment_status === 'pago' ? 'selected' : ''} value="pago">Pagamento pago</option><option ${order.payment_status === 'estornado' ? 'selected' : ''} value="estornado">Pagamento estornado</option></select></div></footer></article>`;
    }).join('');
    box.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => updateOrder(select.dataset.orderStatus || select.dataset.paymentStatus));
    });
    box.querySelectorAll('[data-fast-status]').forEach(button => {
      button.addEventListener('click', () => updateOrder(button.dataset.orderId, button.dataset.fastStatus));
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
  }

  async function updateOrder(id, forcedStatus = '') {
    const statusSelect = $(`[data-order-status="${CSS.escape(id)}"]`);
    const status = forcedStatus || statusSelect.value;
    const paymentStatus = $(`[data-payment-status="${CSS.escape(id)}"]`).value;
    try {
      await SupabaseStore.updateOrder(id, status, paymentStatus);
      const order = orders.find(item => String(item.id) === String(id));
      order.status = status;
      order.payment_status = paymentStatus;
      renderDashboard();
      renderOrders();
      notice('Pedido atualizado.');
    } catch (error) {
      notice(error.message, true);
    }
  }

  function renderProducts() {
    $('#product-count').textContent = `${catalog.products.length} produtos cadastrados`;
    $('#admin-products').innerHTML = catalog.products.map(product => {
      const category = catalog.categories.find(item => item.id === product.categoryId);
      const imageUrl = product.imageUrl || category?.imageUrl || '';
      return `<article><div class="product-thumb">${imageUrl ? `<img src="${esc(preview(imageUrl))}" alt="">` : '⬡'}${!product.active ? '<b>INATIVO</b>' : ''}</div>` +
        `<div><small>${esc(category?.name || '')}</small><h3>${esc(product.name)}</h3><strong>${money(product.price)}</strong><p>${(product.addonGroups || []).length} grupos de adicionais</p></div>` +
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

  function renderPreviews() {
    const settings = catalog.settings;
    $('#logo-preview').innerHTML = settings.logoUrl ? `<img src="${esc(preview(settings.logoUrl))}">` : 'A';
    $('#banner-preview').innerHTML = settings.bannerUrl ? `<img src="${esc(preview(settings.bannerUrl))}">` : '◈';
    $$('.admin-logo img').forEach(image => { image.src = preview(settings.logoUrl || 'assets/images/logo/logo-acai-do-bom.webp'); });
  }

  function openEditor(id) {
    editing = id
      ? structuredClone(catalog.products.find(product => product.id === id))
      : { id: crypto.randomUUID(), name: '', description: '', categoryId: catalog.categories[0]?.id || 'destaques', price: 0, imageUrl: '', featured: false, active: true, badge: '', addonGroups: [] };
    editing.addonGroups = editing.addonGroups || [];
    $('#editor-title').textContent = editing.name || 'Novo produto';
    $('#edit-name').value = editing.name;
    $('#edit-description').value = editing.description;
    $('#edit-price').value = editing.price;
    $('#edit-badge').value = editing.badge || '';
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
        `<div class="options">${group.options.map(option => `<div data-option="${esc(option.id)}"><input value="${esc(option.name)}" data-option-name placeholder="Nome do adicional"><input type="number" step=".01" value="${Number(option.price || 0)}" data-option-price><button type="button" data-remove-option>🗑</button></div>`).join('')}<button type="button" data-add-option>+ Adicionar opção</button></div></article>`;
    }).join('');
    $('#addon-groups').querySelectorAll('[data-group]').forEach(card => {
      const group = editing.addonGroups.find(item => item.id === card.dataset.group);
      card.querySelector('[data-group-name]').oninput = event => { group.name = event.target.value; };
      card.querySelector('[data-group-required]').onchange = event => { group.required = event.target.checked; group.min = event.target.checked ? 1 : 0; };
      card.querySelector('[data-group-max]').oninput = event => { group.max = Math.max(1, Number(event.target.value)); };
      card.querySelector('[data-remove-group]').onclick = () => { editing.addonGroups = editing.addonGroups.filter(item => item.id !== group.id); renderGroups(); };
      card.querySelector('[data-add-option]').onclick = () => { group.options.push({ id: crypto.randomUUID(), name: '', price: 0, available: true }); renderGroups(); };
      card.querySelectorAll('[data-option]').forEach(row => {
        const option = group.options.find(item => item.id === row.dataset.option);
        row.querySelector('[data-option-name]').oninput = event => { option.name = event.target.value; };
        row.querySelector('[data-option-price]').oninput = event => { option.price = Number(event.target.value); };
        row.querySelector('[data-remove-option]').onclick = () => { group.options = group.options.filter(item => item.id !== option.id); renderGroups(); };
      });
    });
  }

  async function upload(input, target, categoryId = '') {
    const file = input.files[0];
    if (!file) return;
    const holder = input.closest('label');
    input.disabled = true;
    holder?.classList.add('busy');
    try {
      notice('Otimizando e enviando imagem...');
      const folders = { logo: 'logo', banner: 'banner', product: 'produtos', category: 'categorias' };
      const url = await SupabaseStore.uploadImage(file, folders[target] || 'geral');
      if (target === 'logo') { catalog.settings.logoUrl = url; $('#logo-url').value = url; }
      if (target === 'banner') { catalog.settings.bannerUrl = url; $('#banner-url').value = url; }
      if (target === 'product' && editing) { editing.imageUrl = url; $('#edit-image').value = url; renderProductPhoto(); }
      if (target === 'category') {
        const category = catalog.categories.find(item => item.id === categoryId);
        if (category) category.imageUrl = url;
      }
      renderPreviews();
      if (target === 'logo' || target === 'banner' || target === 'category') {
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
      notice('Alterações publicadas no cardápio.');
      renderAll();
    } catch (error) {
      notice(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '✓ Publicar alterações';
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
      };
    });
    $('#save-all').onclick = saveAll;
    $('#refresh-orders').onclick = () => refreshOrders(true);
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
    $('#edit-image').oninput = event => { if (editing) { editing.imageUrl = event.target.value; renderProductPhoto(); } };
    $('#remove-product-image').onclick = () => {
      if (!editing) return;
      editing.imageUrl = '';
      $('#edit-image').value = '';
      renderProductPhoto();
    };
    $('#store-status-mode').onchange = updateLiveStoreStatus;
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('#confirm-delete').hidden) $('#cancel-delete').click();
      else if (!$('#product-dialog').hidden) closeEditor();
    });
  }

  bind();
  boot();
})();
