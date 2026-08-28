(async function () {
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const categoryDefaults = {
    acai: 'assets/images/categories/acai.jpg',
    lanches: 'assets/images/categories/lanches.jpg',
    pasteis: 'assets/images/categories/pasteis.jpg'
  };
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const weekLabels = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  let catalog;
  let active = 'destaques';
  let query = '';
  let selected = null;
  let selections = {};
  let quantity = 1;
  let productTrigger = null;
  let statusTimer = null;

  try {
    catalog = await MenuAPI.loadCatalog();
    normalizeCatalog();
    window.ACAI_CATALOG = catalog;
    boot();
  } catch (error) {
    $('#products').innerHTML = '<div class="empty"><h3>Cardápio indisponível</h3><p>Tente novamente em alguns minutos.</p></div>';
  }

  function normalizeCatalog() {
    const settings = catalog.settings || (catalog.settings = {});
    if (!settings.logoUrl) settings.logoUrl = 'assets/images/logo/logo-acai-do-bom.webp';
    settings.primaryColor = '#620853';
    settings.accentColor = '#fcd307';
    settings.brandBrightColor = '#620853';
    settings.timezone = settings.timezone || 'America/Porto_Velho';
    if (!['auto', 'open', 'closed'].includes(settings.statusMode)) {
      settings.statusMode = settings.open === false ? 'closed' : 'open';
    }
    catalog.categories = (catalog.categories || []).map(category => ({
      ...category,
      imageUrl: category.imageUrl || categoryDefaults[category.id] || ''
    }));
    catalog.products = catalog.products || [];
  }

  function boot() {
    const settings = catalog.settings;
    document.documentElement.style.setProperty('--brand', '#620853');
    document.documentElement.style.setProperty('--accent', '#fcd307');
    document.documentElement.style.setProperty('--brand-bright', '#620853');
    renderLogo(settings.logoUrl, settings.storeName);
    $$('[data-store-name]').forEach(element => { element.textContent = settings.storeName; });
    $('#store-tagline').textContent = settings.tagline;
    $('#store-city').textContent = settings.city;
    $('#store-time').textContent = settings.estimatedTime;
    $('#store-fee').textContent = MenuAPI.money(settings.deliveryFee);
    $('#store-address').textContent = settings.address;
    $('#hero-image').src = settings.bannerUrl;
    const whatsapp = 'https://wa.me/' + String(settings.whatsapp).replace(/\D/g, '');
    $('#nav-whatsapp').href = whatsapp;
    $('#callout-whatsapp').href = whatsapp;
    MenuAPI.injectTracking(settings);
    renderCategories();
    renderProducts();
    bind();
    CartStore.subscribe(renderCart);
    refreshStoreStatus();
    statusTimer = window.setInterval(refreshStoreStatus, 60000);
  }

  function renderLogo(url, name) {
    $$('.brand-mark').forEach(mark => {
      const image = document.createElement('img');
      image.src = url;
      image.alt = name || 'Açaí do Bom';
      image.addEventListener('error', () => {
        mark.classList.remove('has-logo');
        mark.textContent = 'A';
        mark.closest('.brand')?.classList.remove('has-image');
      }, { once: true });
      mark.replaceChildren(image);
      mark.classList.add('has-logo');
      mark.closest('.brand')?.classList.add('has-image');
    });
  }

  function imageMarkup(url, alt, fallback, lazy = true) {
    if (!url) return '<em>' + escape(fallback) + '</em>';
    return '<img src="' + escape(url) + '" alt="' + escape(alt) + '"' + (lazy ? ' loading="lazy"' : '') + '><em hidden>' + escape(fallback) + '</em>';
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll('img').forEach(image => {
      image.addEventListener('error', () => {
        image.hidden = true;
        if (image.nextElementSibling) image.nextElementSibling.hidden = false;
      }, { once: true });
    });
  }

  function renderCategories() {
    const container = $('#categories');
    container.innerHTML = catalog.categories.filter(category => category.active).map(category =>
      '<button type="button" data-category="' + escape(category.id) + '" class="' + (category.id === active ? 'active' : '') + '" role="tab" aria-selected="' + (category.id === active) + '">' +
        '<span class="category-media">' + imageMarkup(category.imageUrl, category.name, category.emoji || '🥣') + '</span>' +
        '<b>' + escape(category.name) + '</b>' +
      '</button>'
    ).join('');
    bindImageFallbacks(container);
    container.querySelectorAll('button').forEach(button => {
      button.addEventListener('click', () => {
        active = button.dataset.category;
        query = '';
        $('#search').value = '';
        renderCategories();
        renderProducts();
      });
    });
  }

  function list() {
    return catalog.products
      .filter(product => product.active)
      .filter(product => query
        ? (product.name + ' ' + product.description).toLowerCase().includes(query.toLowerCase())
        : (active === 'destaques' ? product.featured : product.categoryId === active));
  }

  function renderProducts() {
    const products = list();
    const container = $('#products');
    if (!products.length) {
      container.innerHTML = '<div class="empty"><span>⌕</span><h3>Nenhum produto encontrado</h3><p>Tente outro nome ou categoria.</p></div>';
      return;
    }
    container.innerHTML = products.map(product => {
      const category = catalog.categories.find(item => item.id === product.categoryId) || {};
      const imageUrl = product.imageUrl || category.imageUrl || '';
      return '<article class="product-card"><button type="button" data-product="' + escape(product.id) + '">' +
        '<div class="product-media">' + imageMarkup(imageUrl, product.name, category.emoji || '🥣') + (product.badge ? '<b>' + escape(product.badge) + '</b>' : '') + '</div>' +
        '<div class="product-copy"><small>' + escape(category.name || 'Açaí do Bom') + '</small><h3>' + escape(product.name) + '</h3><p>' + escape(product.description) + '</p>' +
        '<footer><b>' + MenuAPI.money(product.price) + '</b><span>＋</span></footer></div></button></article>';
    }).join('');
    bindImageFallbacks(container);
    container.querySelectorAll('[data-product]').forEach(button => {
      button.addEventListener('click', () => openProduct(button.dataset.product, button));
    });
  }

  function openProduct(id, trigger) {
    selected = catalog.products.find(product => product.id === id);
    if (!selected) return;
    productTrigger = trigger || document.activeElement;
    selections = {};
    quantity = 1;
    const category = catalog.categories.find(item => item.id === selected.categoryId) || {};
    $('#product-image').src = selected.imageUrl || category.imageUrl || catalog.settings.bannerUrl;
    $('#product-image').alt = selected.name;
    $('#product-name').textContent = selected.name;
    $('#product-description').textContent = selected.description;
    $('#product-base-price').textContent = 'A partir de ' + MenuAPI.money(selected.price);
    $('#item-notes').value = '';
    $('#product-error').hidden = true;
    $('#addon-list').innerHTML = (selected.addonGroups || []).map(group =>
      '<fieldset data-group="' + escape(group.id) + '"><legend><span><b>' + escape(group.name) + '</b><small>' +
      (group.required ? 'Obrigatório' : 'Opcional') + ' · escolha até ' + Number(group.max || 1) +
      '</small></span>' + (group.required ? '<em>OBRIGATÓRIO</em>' : '') + '</legend>' +
      (group.options || []).filter(option => option.available !== false).map(option =>
        '<label><input type="' + (Number(group.max || 1) === 1 ? 'radio' : 'checkbox') + '" name="group-' + escape(group.id) +
        '" value="' + escape(option.id) + '"><span>' + escape(option.name) + '</span><b>' +
        (option.price ? '+ ' + MenuAPI.money(option.price) : 'Incluso') + '</b></label>'
      ).join('') + '</fieldset>'
    ).join('');
    $('#addon-list').querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => changeSelection(input));
    });
    $('#addon-list').scrollTop = 0;
    updateProductTotal();
    $('#product-overlay').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => $('#product-overlay .modal-close')?.focus());
  }

  function changeSelection(input) {
    if (!selected) return;
    const field = input.closest('fieldset');
    const group = selected.addonGroups.find(item => item.id === field.dataset.group);
    const option = group.options.find(item => item.id === input.value);
    const current = selections[group.id] || [];
    if (Number(group.max || 1) === 1) {
      selections[group.id] = input.checked ? [option] : [];
      field.querySelectorAll('label').forEach(label => label.classList.toggle('selected', label.contains(input)));
    } else if (input.checked) {
      if (current.length >= Number(group.max || 1)) {
        input.checked = false;
        const error = $('#product-error');
        error.textContent = 'Você pode escolher até ' + Number(group.max || 1) + ' opções em “' + group.name + '”.';
        error.hidden = false;
        return;
      }
      selections[group.id] = [...current, option];
      input.closest('label').classList.add('selected');
    } else {
      selections[group.id] = current.filter(item => item.id !== option.id);
      input.closest('label').classList.remove('selected');
    }
    $('#product-error').hidden = true;
    updateProductTotal();
  }

  function unitTotal() {
    return Number(selected?.price || 0) + Object.values(selections).flat().reduce((sum, option) => sum + Number(option.price), 0);
  }

  function updateProductTotal() {
    $('#item-quantity').textContent = quantity;
    $('#add-to-cart').textContent = 'Confirmar produto · ' + MenuAPI.money(unitTotal() * quantity);
  }

  function addProduct() {
    if (!selected) return;
    for (const group of selected.addonGroups || []) {
      if ((selections[group.id] || []).length < Number(group.min || 0)) {
        const error = $('#product-error');
        error.textContent = 'Escolha ' + Number(group.min || 1) + ' opção em “' + group.name + '”.';
        error.hidden = false;
        const field = $('#addon-list').querySelector('[data-group="' + CSS.escape(group.id) + '"]');
        field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    CartStore.add({
      productId: selected.id,
      name: selected.name,
      imageUrl: selected.imageUrl,
      basePrice: selected.price,
      quantity,
      selections: (selected.addonGroups || [])
        .filter(group => (selections[group.id] || []).length)
        .map(group => ({ groupId: group.id, groupName: group.name, options: selections[group.id] })),
      notes: $('#item-notes').value.trim(),
      unitTotal: unitTotal()
    });
    closeProduct(false);
    openCart();
  }

  function closeProduct(restoreFocus = true) {
    const overlay = $('#product-overlay');
    if (overlay.hidden) return;
    overlay.hidden = true;
    selected = null;
    selections = {};
    syncBodyLock();
    if (restoreFocus) productTrigger?.focus?.();
  }

  function renderCart() {
    const items = CartStore.get();
    const count = CartStore.count();
    const subtotal = CartStore.subtotal();
    $$('[data-cart-count]').forEach(element => { element.textContent = count; });
    $('#cart-subtotal').textContent = MenuAPI.money(subtotal);
    $('#mobile-total').textContent = MenuAPI.money(subtotal);
    $$('.mobile-cart').forEach(element => { element.hidden = !count; });
    $('#cart-footer').hidden = !count;
    $('#cart-items').innerHTML = items.length ? items.map(item =>
      '<article><header><div><b>' + item.quantity + 'x ' + escape(item.name) + '</b><strong>' + MenuAPI.money(item.unitTotal * item.quantity) +
      '</strong></div><button type="button" data-remove="' + escape(item.cartId) + '" aria-label="Remover produto">🗑</button></header>' +
      (item.selections || []).map(selection => '<p>' + escape(selection.groupName) + ': ' + selection.options.map(option => escape(option.name)).join(', ') + '</p>').join('') +
      (item.notes ? '<p>Obs: ' + escape(item.notes) + '</p>' : '') +
      '<div class="quantity small"><button type="button" data-minus="' + escape(item.cartId) + '">−</button><b>' + item.quantity +
      '</b><button type="button" data-plus="' + escape(item.cartId) + '">+</button></div></article>'
    ).join('') : '<div class="empty"><span>🛍</span><h3>Seu carrinho está vazio</h3><p>Escolha seus favoritos no cardápio.</p></div>';
    $('#cart-items').querySelectorAll('[data-remove]').forEach(button => {
      button.onclick = () => CartStore.remove(button.dataset.remove);
    });
    $('#cart-items').querySelectorAll('[data-minus]').forEach(button => {
      button.onclick = () => {
        const item = items.find(current => current.cartId === button.dataset.minus);
        if (item) CartStore.quantity(item.cartId, item.quantity - 1);
      };
    });
    $('#cart-items').querySelectorAll('[data-plus]').forEach(button => {
      button.onclick = () => {
        const item = items.find(current => current.cartId === button.dataset.plus);
        if (item) CartStore.quantity(item.cartId, item.quantity + 1);
      };
    });
    applyStoreStateToCheckout();
  }

  function minutes(value) {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    return (hour * 60) + minute;
  }

  function zonedNow(settings) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.timezone || 'America/Porto_Velho',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      const parts = Object.fromEntries(formatter.formatToParts(new Date()).map(part => [part.type, part.value]));
      return {
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        minute: (Number(parts.hour) * 60) + Number(parts.minute)
      };
    } catch (error) {
      const now = new Date();
      return { day: now.getDay(), minute: (now.getHours() * 60) + now.getMinutes() };
    }
  }

  function calculateStoreState(settings = catalog.settings) {
    const mode = settings.statusMode || (settings.open === false ? 'closed' : 'open');
    if (mode === 'open') return { open: true, text: '● Aberto agora', mode };
    if (mode === 'closed') return { open: false, text: '● Fechado no momento', mode };
    const hours = settings.hours || {};
    const now = zonedNow(settings);
    const current = hours[dayKeys[now.day]];
    const previous = hours[dayKeys[(now.day + 6) % 7]];
    let closing = '';

    if (current?.enabled) {
      const start = minutes(current.open);
      const end = minutes(current.close);
      if ((end > start && now.minute >= start && now.minute < end) || (end <= start && now.minute >= start)) {
        closing = current.close;
      }
    }
    if (!closing && previous?.enabled && minutes(previous.close) <= minutes(previous.open) && now.minute < minutes(previous.close)) {
      closing = previous.close;
    }
    if (closing) return { open: true, text: '● Aberto agora · até ' + closing, mode };

    let nextText = '';
    for (let offset = 0; offset < 7; offset += 1) {
      const index = (now.day + offset) % 7;
      const schedule = hours[dayKeys[index]];
      if (!schedule?.enabled) continue;
      if (offset === 0 && now.minute < minutes(schedule.open)) nextText = ' · abre às ' + schedule.open;
      else if (offset === 1) nextText = ' · abre amanhã às ' + schedule.open;
      else if (offset > 1) nextText = ' · abre ' + weekLabels[index] + ' às ' + schedule.open;
      if (nextText) break;
    }
    return { open: false, text: '● Fechado agora' + nextText, mode };
  }

  function applyStoreStateToCheckout() {
    if (!catalog) return;
    const state = calculateStoreState();
    window.ACAI_STORE_STATE = state;
    const button = $('#start-checkout');
    button.disabled = !state.open;
    button.textContent = state.open ? 'Finalizar pedido →' : 'Loja fechada';
    $('#minimum-order').textContent = state.open
      ? 'Pedido mínimo para entrega: ' + MenuAPI.money(catalog.settings.minOrder)
      : state.text.replace('● ', '');
  }

  function refreshStoreStatus() {
    const state = calculateStoreState();
    window.ACAI_STORE_STATE = state;
    const status = $('#store-status');
    status.textContent = state.text;
    status.classList.toggle('closed', !state.open);
    applyStoreStateToCheckout();
  }

  function syncBodyLock() {
    const locked = !$('#product-overlay').hidden || $('#cart').classList.contains('open') || !$('#checkout-overlay').hidden;
    document.body.classList.toggle('no-scroll', locked);
  }

  function openCart() {
    $('#cart').classList.add('open');
    $('#cart').setAttribute('aria-hidden', 'false');
    $('#cart-backdrop').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => $('[data-close-cart]')?.focus());
  }

  function closeCart() {
    $('#cart').classList.remove('open');
    $('#cart').setAttribute('aria-hidden', 'true');
    $('#cart-backdrop').hidden = true;
    syncBodyLock();
  }

  function bind() {
    $('#search').addEventListener('input', event => {
      query = event.target.value;
      renderProducts();
    });
    $$('[data-open-cart]').forEach(button => button.addEventListener('click', openCart));
    $('[data-close-cart]').addEventListener('click', closeCart);
    $('#cart-backdrop').addEventListener('click', closeCart);
    $$('[data-close-product]').forEach(button => button.addEventListener('click', () => closeProduct()));
    $('#product-overlay').addEventListener('click', event => {
      if (event.target.id === 'product-overlay') closeProduct();
    });
    $('[data-qty-minus]').addEventListener('click', () => {
      quantity = Math.max(1, quantity - 1);
      updateProductTotal();
    });
    $('[data-qty-plus]').addEventListener('click', () => {
      quantity += 1;
      updateProductTotal();
    });
    $('#add-to-cart').addEventListener('click', addProduct);
    $('#start-checkout').addEventListener('click', () => {
      const state = calculateStoreState();
      if (!state.open) {
        refreshStoreStatus();
        return;
      }
      closeCart();
      Checkout.open(catalog);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('#checkout-overlay').hidden) Checkout.close();
      else if (!$('#product-overlay').hidden) closeProduct();
      else if ($('#cart').classList.contains('open')) closeCart();
    });
  }

  window.addEventListener('beforeunload', () => clearInterval(statusTimer));
  window.syncMenuScroll = syncBodyLock;
  window.MenuStoreStatus = { get: () => calculateStoreState(), refresh: refreshStoreStatus };
})();

