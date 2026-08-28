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
      const settings = catalog.settings;
      if (!settings.logoUrl) settings.logoUrl = 'assets/images/logo/logo-acai-do-bom.webp';
      if (!settings.primaryColor || settings.primaryColor.toLowerCase() === '#5b1779') settings.primaryColor = '#620853';
      if (!settings.accentColor || settings.accentColor.toLowerCase() === '#f4c430') settings.accentColor = '#fcd307';
      settings.brandBrightColor = settings.brandBrightColor || '#be13af';
      if (typeof settings.autoOpenWhatsApp !== 'boolean') settings.autoOpenWhatsApp = true;
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
    $('#store-open').checked = Boolean(settings.open);
    $('#primary-color').value = settings.primaryColor || '#620853';
    $('#primary-text').value = settings.primaryColor || '#620853';
    $('#accent-color').value = settings.accentColor || '#fcd307';
    $('#accent-text').value = settings.accentColor || '#fcd307';
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
    settings.open = $('#store-open').checked;
    settings.primaryColor = $('#primary-text').value;
    settings.accentColor = $('#accent-text').value;
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
    $('#operation-summary').innerHTML = `<p><span>Pedido mínimo</span><b>${money(settings.minOrder)}</b></p><p><span>Taxa de entrega</span><b>${money(settings.deliveryFee)}</b></p><p><span>Tempo estimado</span><b>${esc(settings.estimatedTime)}</b></p><p><span>WhatsApp</span><b>${esc(settings.whatsapp)}</b></p>`;
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
      const itemsHtml = items.map(item => {
        const additions = (item.selections || []).map(selection => `${esc(selection.groupName)}: ${(selection.options || []).map(option => esc(option.name)).join(', ')}`).join('<br>');
        return `<div class="order-item"><b>${Number(item.quantity || 1)}x ${esc(item.name)} — ${money(Number(item.unitTotal || 0) * Number(item.quantity || 1))}</b>${additions ? `<small>${additions}</small>` : ''}${item.notes ? `<small>Observação: ${esc(item.notes)}</small>` : ''}</div>`;
      }).join('');
      const addressHtml = order.fulfillment === 'delivery'
        ? `<div class="order-address"><b>📍 Endereço de entrega</b><br>${esc(address.street)}, ${esc(address.number)}${address.complement ? ` — ${esc(address.complement)}` : ''}<br>${esc(address.neighborhood)} — ${esc(address.city)}${address.zip ? ` — CEP ${esc(address.zip)}` : ''}${address.reference ? `<br>Referência: ${esc(address.reference)}` : ''}</div>`
        : '<div class="order-address"><b>🏪 Retirada no local</b></div>';
      return `<article><header><div><b>${esc(order.order_number)}</b><small>${new Date(order.created_at).toLocaleString('pt-BR')}</small></div><strong>${money(order.total)}</strong></header>` +
        `<div class="customer"><span><small>CLIENTE</small>${esc(customer.name)}</span><span><small>WHATSAPP</small>${phone ? `<a href="https://wa.me/55${phone.replace(/^55/,'')}" target="_blank" rel="noopener">${esc(customer.phone)}</a>` : '-'}</span><span><small>RECEBIMENTO</small>${order.fulfillment === 'delivery' ? 'Entrega' : 'Retirada'}</span></div>` +
        `<div class="order-items">${itemsHtml}</div>${addressHtml}` +
        `<div class="order-meta"><span>Pagamento: ${esc(order.payment_method)}</span><span>Subtotal: ${money(order.subtotal)}</span><span>Entrega: ${money(order.delivery_fee)}</span></div>` +
        (order.notes ? `<div class="order-notes"><b>Observações gerais:</b> ${esc(order.notes)}</div>` : '') +
        `<footer><select data-order-status="${esc(order.id)}">${['novo', 'confirmado', 'preparando', 'saiu_entrega', 'concluido', 'cancelado'].map(value => `<option ${order.status === value ? 'selected' : ''} value="${value}">${value.replace('_', ' ')}</option>`).join('')}</select>` +
        `<select data-payment-status="${esc(order.id)}"><option ${order.payment_status === 'pendente' ? 'selected' : ''} value="pendente">Pagamento pendente</option><option ${order.payment_status === 'pago' ? 'selected' : ''} value="pago">Pago</option><option ${order.payment_status === 'estornado' ? 'selected' : ''} value="estornado">Estornado</option></select></footer></article>`;
    }).join('');
    box.querySelectorAll('select').forEach(select => {
      select.addEventListener('change', () => updateOrder(select.dataset.orderStatus || select.dataset.paymentStatus));
    });
  }

  async function updateOrder(id) {
    const status = $(`[data-order-status="${CSS.escape(id)}"]`).value;
    const paymentStatus = $(`[data-payment-status="${CSS.escape(id)}"]`).value;
    try {
      await SupabaseStore.updateOrder(id, status, paymentStatus);
      const order = orders.find(item => String(item.id) === String(id));
      order.status = status;
      order.payment_status = paymentStatus;
      renderDashboard();
      notice('Pedido atualizado.');
    } catch (error) {
      notice(error.message, true);
    }
  }

  function renderProducts() {
    $('#product-count').textContent = `${catalog.products.length} produtos cadastrados`;
    $('#admin-products').innerHTML = catalog.products.map(product => {
      const category = catalog.categories.find(item => item.id === product.categoryId);
      return `<article><div class="product-thumb">${product.imageUrl ? `<img src="${esc(preview(product.imageUrl))}" alt="">` : '⬡'}${!product.active ? '<b>INATIVO</b>' : ''}</div>` +
        `<div><small>${esc(category?.name || '')}</small><h3>${esc(product.name)}</h3><strong>${money(product.price)}</strong><p>${(product.addonGroups || []).length} grupos de adicionais</p></div>` +
        `<footer><button data-edit="${esc(product.id)}">Editar</button><button data-delete="${esc(product.id)}">🗑</button></footer></article>`;
    }).join('');
    $('#admin-products').querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => openEditor(button.dataset.edit); });
    $('#admin-products').querySelectorAll('[data-delete]').forEach(button => {
      button.onclick = () => { deleting = button.dataset.delete; $('#confirm-delete').hidden = false; };
    });
  }

  function renderCategories() {
    $('#category-editor').innerHTML = catalog.categories.map(category => `<div><input class="emoji" value="${esc(category.emoji)}" data-cat-emoji="${esc(category.id)}"><input value="${esc(category.name)}" data-cat-name="${esc(category.id)}"><input type="checkbox" ${category.active ? 'checked' : ''} data-cat-active="${esc(category.id)}"></div>`).join('');
    $('#category-editor').querySelectorAll('input').forEach(input => {
      input.oninput = () => {
        const id = input.dataset.catEmoji || input.dataset.catName || input.dataset.catActive;
        const category = catalog.categories.find(item => item.id === id);
        if (input.dataset.catEmoji) category.emoji = input.value;
        if (input.dataset.catName) category.name = input.value;
        if (input.dataset.catActive) category.active = input.checked;
      };
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
  }

  function renderProductPhoto() {
    $('#product-photo').innerHTML = editing?.imageUrl ? `<img src="${esc(preview(editing.imageUrl))}">` : '⬡';
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

  async function upload(input, target) {
    const file = input.files[0];
    if (!file) return;
    try {
      notice('Enviando imagem...');
      const url = await SupabaseStore.uploadImage(file);
      if (target === 'logo') { catalog.settings.logoUrl = url; $('#logo-url').value = url; }
      if (target === 'banner') { catalog.settings.bannerUrl = url; $('#banner-url').value = url; }
      if (target === 'product' && editing) { editing.imageUrl = url; $('#edit-image').value = url; renderProductPhoto(); }
      renderPreviews();
      if (target === 'logo' || target === 'banner') {
        await SupabaseStore.saveCatalog(catalog);
        notice('Imagem enviada e publicada no cardápio.');
      } else {
        notice('Imagem enviada. Salve o produto e publique as alterações.');
      }
    } catch (error) {
      notice(error.message, true);
    } finally {
      input.value = '';
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
    $$('[data-close-product]').forEach(button => { button.onclick = () => { $('#product-dialog').hidden = true; }; });
    $('#product-form').onsubmit = event => {
      event.preventDefault();
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
      $('#product-dialog').hidden = true;
      renderProducts();
    };
    $('#add-group').onclick = () => { editing.addonGroups.push({ id: crypto.randomUUID(), name: 'Novo grupo', required: false, min: 0, max: 1, options: [] }); renderGroups(); };
    $('#cancel-delete').onclick = () => { $('#confirm-delete').hidden = true; };
    $('#do-delete').onclick = () => { catalog.products = catalog.products.filter(product => product.id !== deleting); $('#confirm-delete').hidden = true; renderProducts(); };
    $('#add-category').onclick = () => { catalog.categories.push({ id: crypto.randomUUID(), name: 'Nova categoria', emoji: '🥣', active: true }); renderCategories(); };
    $$('[data-upload]').forEach(input => { input.onchange = () => upload(input, input.dataset.upload); });
    $('#logo-url').oninput = event => { catalog.settings.logoUrl = event.target.value; renderPreviews(); };
    $('#banner-url').oninput = event => { catalog.settings.bannerUrl = event.target.value; renderPreviews(); };
    $('#edit-image').oninput = event => { if (editing) { editing.imageUrl = event.target.value; renderProductPhoto(); } };
    [['#primary-color', '#primary-text'], ['#accent-color', '#accent-text']].forEach(([color, text]) => {
      $(color).oninput = event => { $(text).value = event.target.value; };
      $(text).oninput = event => { $(color).value = event.target.value; };
    });
  }

  bind();
  boot();
})();
