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
  let productStep = 0;
  let productTrigger = null;
  let statusTimer = null;
  let lockedScrollY = 0;

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
    settings.establishmentName = settings.establishmentName || settings.storeName || 'Açaí do Bom';
    settings.locationName = settings.locationName || settings.city || 'Ji-Paraná - RO';
    settings.contactPhone = settings.contactPhone || '(69) 9381-7951';
    settings.publicEmail = settings.publicEmail || 'contato@acaidobom.com.br';
    settings.heroEyebrow = settings.heroEyebrow || '✦ DO SEU JEITO';
    settings.heroTitle = settings.heroTitle || 'O açaí que';
    settings.heroHighlight = settings.heroHighlight || 'dá vontade.';
    settings.menuEyebrow = settings.menuEyebrow || 'ESCOLHA O SEU';
    settings.menuTitle = settings.menuTitle || 'Cardápio';
    settings.searchPlaceholder = settings.searchPlaceholder || 'Buscar produto ou acompanhamento';
    settings.whatsappEyebrow = settings.whatsappEyebrow || 'PREFERE PEDIR DIRETO?';
    settings.whatsappTitle = settings.whatsappTitle || 'Fale com a gente no WhatsApp';
    settings.whatsappButtonText = settings.whatsappButtonText || 'CHAMAR AGORA →';
    settings.cnpj = settings.cnpj || '';
    settings.instagramUrl = settings.instagramUrl || '';
    settings.facebookUrl = settings.facebookUrl || '';
    settings.tiktokUrl = settings.tiktokUrl || '';
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
    $('#hero-eyebrow').textContent = settings.heroEyebrow;
    $('#hero-title').textContent = settings.heroTitle;
    $('#hero-highlight').textContent = settings.heroHighlight;
    $('#menu-eyebrow').textContent = settings.menuEyebrow;
    $('#menu-title').textContent = settings.menuTitle;
    $('#search').placeholder = settings.searchPlaceholder;
    $('#whatsapp-eyebrow').textContent = settings.whatsappEyebrow;
    $('#whatsapp-title').textContent = settings.whatsappTitle;
    $('#whatsapp-button-text').textContent = settings.whatsappButtonText;
    $('#store-city').textContent = settings.city;
    $('#store-time').textContent = settings.estimatedTime;
    $('#store-fee').textContent = MenuAPI.money(settings.deliveryFee);
    const addressNode = $('#store-address');
    if (addressNode) addressNode.textContent = settings.address;
    $('#hero-image').src = settings.bannerUrl;
    const whatsapp = 'https://wa.me/' + String(settings.whatsapp).replace(/\D/g, '');
    $('#nav-whatsapp').href = whatsapp;
    $('#callout-whatsapp').href = whatsapp;
    renderFooter(settings);
    MenuAPI.injectTracking(settings);
    renderCategories();
    renderProducts();
    bind();
    CartStore.subscribe(renderCart);
    refreshStoreStatus();
    statusTimer = window.setInterval(refreshStoreStatus, 60000);
  }

  function safeLink(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function renderFooter(settings) {
    $('#footer-establishment').textContent = settings.establishmentName;
    $('#footer-location').textContent = settings.locationName;
    const cnpj = $('#footer-cnpj');
    cnpj.textContent = settings.cnpj ? 'CNPJ: ' + settings.cnpj : '';
    cnpj.hidden = !settings.cnpj;
    const phone = $('#footer-phone');
    phone.textContent = settings.contactPhone;
    const phoneDigits = String(settings.contactPhone).replace(/\D/g, '');
    phone.href = 'tel:+' + (phoneDigits.startsWith('55') ? phoneDigits : '55' + phoneDigits);
    const email = $('#footer-email');
    email.textContent = settings.publicEmail;
    email.href = 'mailto:' + settings.publicEmail;
    const social = [
      ['instagramUrl', 'Instagram', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" class="fill"/></svg>'],
      ['facebookUrl', 'Facebook', '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M14 8h3V4h-3c-3.3 0-5 2-5 5v2H6v4h3v7h4v-7h3.3l.7-4h-4V9c0-.7.3-1 1-1Z"/></svg>'],
      ['tiktokUrl', 'TikTok', '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M14 3h3c.3 2 1.5 3.5 4 4v3c-1.5 0-2.8-.4-4-1.1V16a6 6 0 1 1-6-6h1v3a3 3 0 1 0 2 3V3Z"/></svg>']
    ];
    $('#footer-social').innerHTML = social.map(([key, name, icon]) => {
      const url = safeLink(settings[key]);
      return url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + name + '" title="' + name + '">' + icon + '</a>' : '';
    }).join('');
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
  }

  function list() {
    const normalizedQuery = normalizeSearch(query);
    return catalog.products
      .filter(product => product.active)
      .filter(product => normalizedQuery
        ? normalizeSearch([
          product.name, product.description, product.badge, product.freeShippingText,
          catalog.categories.find(category => category.id === product.categoryId)?.name,
          ...(product.addonGroups || []).flatMap(group => [group.name, ...(group.options || []).map(option => option.name)])
        ].filter(Boolean).join(' ')).includes(normalizedQuery)
        : (active === 'destaques' ? product.featured : product.categoryId === active));
  }

  function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
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
      const freeShipping = String(product.freeShippingText || '').trim();
      return '<article class="product-card"><button type="button" data-product="' + escape(product.id) + '">' +
        '<div class="product-copy"><small>' + escape(category.name || 'Açaí do Bom') + '</small><h3>' + escape(product.name) + '</h3><p>' + escape(product.description) + '</p>' +
        (freeShipping ? '<em class="free-shipping">● ' + escape(freeShipping) + '</em>' : '') +
        '<footer><b>' + MenuAPI.money(product.price) + '</b><span aria-hidden="true">＋</span></footer></div>' +
        '<div class="product-media">' + imageMarkup(imageUrl, product.name, category.emoji || '🥣') + (product.badge ? '<b>' + escape(product.badge) + '</b>' : '') + '</div>' +
      '</button></article>';
    }).join('');
    bindImageFallbacks(container);
  }

  function productGroups() {
    return (selected?.addonGroups || [])
      .map(group => ({ ...group, options: (group.options || []).filter(option => option.available !== false) }))
      .filter(group => group.options.length);
  }

  function normalizeOptionName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function optionEmoji(option, group) {
    const value = normalizeOptionName(`${option.name} ${group.name}`);
    const visuals = [
      [/banana/, '🍌'], [/morango/, '🍓'], [/kiwi/, '🥝'], [/manga/, '🥭'], [/uva/, '🍇'],
      [/granola/, '🥣'], [/leite em po/, '🥛'], [/pacoca/, '🥜'], [/avela/, '🍫'], [/condensado/, '🥛'],
      [/bacon/, '🥓'], [/queijo/, '🧀'], [/ovo/, '🥚'], [/refrigerante|coca|fanta/, '🥤'],
      [/300|500|700|tamanho|media|grande/, '🥤']
    ];
    return visuals.find(([pattern]) => pattern.test(value))?.[1] || '✨';
  }

  function optionMedia(option, group) {
    if (option.imageUrl) return imageMarkup(option.imageUrl, option.name, optionEmoji(option, group), false);
    return '<em aria-hidden="true">' + optionEmoji(option, group) + '</em>';
  }

  function validateGroup(group) {
    const minimum = Number(group?.min || 0);
    const chosen = (selections[group?.id] || []).length;
    if (chosen >= minimum) return true;
    const error = $('#product-error');
    error.textContent = 'Escolha ' + minimum + (minimum === 1 ? ' opção' : ' opções') + ' em “' + group.name + '” para continuar.';
    error.hidden = false;
    $('#addon-list input')?.focus({ preventScroll: true });
    return false;
  }

  function renderProductStep() {
    if (!selected) return;
    const groups = productGroups();
    const total = groups.length + 1;
    productStep = Math.max(0, Math.min(productStep, total - 1));
    const group = groups[productStep];
    const isReview = !group;
    const addonList = $('#addon-list');
    $('#product-step-label').textContent = 'Etapa ' + (productStep + 1) + ' de ' + total;
    $('#product-step-title').textContent = isReview ? 'Revise e confirme' : group.name;
    $('#product-step-back').textContent = productStep ? '← Voltar' : 'Cancelar';
    $('#product-notes').hidden = !isReview;
    $('#product-quantity').hidden = !isReview;
    $('#product-overlay .modal-footer').classList.toggle('review-mode', isReview);
    $('#product-error').hidden = true;

    if (isReview) {
      const summary = groups.filter(item => (selections[item.id] || []).length).map(item =>
        '<div><b>' + escape(item.name) + '</b><span>' + selections[item.id].map(option => escape(option.name)).join(', ') + '</span></div>'
      ).join('');
      addonList.innerHTML = '<section class="product-review"><h3>Seu produto</h3>' +
        (summary || '<p>Este produto não precisa de opções adicionais.</p>') + '</section>';
    } else {
      const maximum = Number(group.max || 1);
      const minimum = Number(group.min || 0);
      addonList.innerHTML = '<fieldset data-group="' + escape(group.id) + '"><legend><span><b>' + escape(group.name) + '</b><small>' +
        (minimum ? 'Escolha pelo menos ' + minimum : 'Opcional') + ' · até ' + maximum +
        '</small></span>' + (minimum ? '<em>OBRIGATÓRIO</em>' : '') + '</legend><div class="addon-options">' +
        group.options.map(option => {
          const checked = (selections[group.id] || []).some(item => item.id === option.id);
          return '<label class="addon-option' + (checked ? ' selected' : '') + '"><input type="' + (maximum === 1 ? 'radio' : 'checkbox') +
            '" name="group-' + escape(group.id) + '" value="' + escape(option.id) + '"' + (checked ? ' checked' : '') +
            '><span class="addon-option-media">' + optionMedia(option, group) + '</span><span class="addon-option-copy"><b>' +
            escape(option.name) + '</b><small>' + (option.price ? '+ ' + MenuAPI.money(option.price) : 'Incluso') +
            '</small></span><i aria-hidden="true">✓</i></label>';
        }).join('') + '</div></fieldset>';
      bindImageFallbacks(addonList);
    }
    addonList.scrollTop = 0;
    updateProductTotal();
  }

  function openProduct(id, trigger) {
    selected = catalog.products.find(product => product.id === id);
    if (!selected) return;
    productTrigger = trigger || document.activeElement;
    selections = {};
    quantity = 1;
    productStep = 0;
    const category = catalog.categories.find(item => item.id === selected.categoryId) || {};
    $('#product-image').src = selected.imageUrl || category.imageUrl || catalog.settings.bannerUrl;
    $('#product-image').alt = selected.name;
    $('#product-name').textContent = selected.name;
    $('#product-description').textContent = selected.description;
    $('#product-base-price').textContent = 'A partir de ' + MenuAPI.money(selected.price);
    $('#item-notes').value = '';
    renderProductStep();
    $('#product-overlay').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => $('#product-overlay .modal-close')?.focus());
  }

  function changeSelection(input) {
    if (!selected) return;
    const field = input.closest('fieldset');
    const group = productGroups().find(item => item.id === field.dataset.group);
    if (!group) return;
    const option = group.options.find(item => item.id === input.value);
    if (!option) return;
    const current = selections[group.id] || [];
    if (Number(group.max || 1) === 1) {
      selections[group.id] = input.checked ? [option] : [];
      field.querySelectorAll('.addon-option').forEach(label => label.classList.toggle('selected', label.contains(input)));
    } else if (input.checked) {
      if (current.length >= Number(group.max || 1)) {
        input.checked = false;
        const error = $('#product-error');
        error.textContent = 'Você pode escolher até ' + Number(group.max || 1) + ' opções em “' + group.name + '”.';
        error.hidden = false;
        return;
      }
      selections[group.id] = [...current, option];
      input.closest('.addon-option').classList.add('selected');
    } else {
      selections[group.id] = current.filter(item => item.id !== option.id);
      input.closest('.addon-option').classList.remove('selected');
    }
    $('#product-error').hidden = true;
    updateProductTotal();
  }

  function unitTotal() {
    return Number(selected?.price || 0) + Object.values(selections).flat().reduce((sum, option) => sum + Number(option.price || 0), 0);
  }

  function updateProductTotal() {
    $('#item-quantity').textContent = quantity;
    const isReview = productStep >= productGroups().length;
    $('#add-to-cart').textContent = isReview
      ? 'Adicionar · ' + MenuAPI.money(unitTotal() * quantity)
      : 'Continuar →';
  }

  function advanceProduct() {
    if (!selected) return;
    const groups = productGroups();
    if (productStep < groups.length) {
      if (!validateGroup(groups[productStep])) return;
      productStep += 1;
      renderProductStep();
      return;
    }
    addProduct();
  }

  function previousProductStep() {
    if (!selected) return;
    if (productStep === 0) {
      closeProduct();
      return;
    }
    productStep -= 1;
    renderProductStep();
  }

  function addProduct() {
    if (!selected) return;
    for (const group of productGroups()) {
      if ((selections[group.id] || []).length < Number(group.min || 0)) {
        const error = $('#product-error');
        error.textContent = 'Escolha ' + Number(group.min || 1) + ' opção em “' + group.name + '”.';
        error.hidden = false;
        productStep = productGroups().findIndex(item => item.id === group.id);
        renderProductStep();
        $('#product-error').textContent = 'Escolha ' + Number(group.min || 1) + ' opção em “' + group.name + '”.';
        $('#product-error').hidden = false;
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
    closeProduct(false, true);
    openCart();
  }

  function closeProduct(restoreFocus = true, keepLocked = false) {
    const overlay = $('#product-overlay');
    if (overlay.hidden) return;
    overlay.hidden = true;
    selected = null;
    selections = {};
    productStep = 0;
    if (!keepLocked) syncBodyLock();
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
    const suggestions = getCartSuggestions(items);
    $('#cart-items').innerHTML = items.length ?
      '<div class="cart-lines">' + items.map(item => {
        const product = catalog.products.find(current => current.id === item.productId) || {};
        const category = catalog.categories.find(current => current.id === product.categoryId) || {};
        const imageUrl = item.imageUrl || product.imageUrl || category.imageUrl || '';
        return '<article class="cart-line"><div class="cart-product-image">' + imageMarkup(imageUrl, item.name, category.emoji || '🥣') + '</div><div class="cart-product-info">' +
          '<header><div><b>' + escape(item.name) + '</b><strong>' + MenuAPI.money(item.unitTotal * item.quantity) +
          '</strong></div><button type="button" data-remove="' + escape(item.cartId) + '" aria-label="Remover produto">🗑</button></header>' +
          (item.selections || []).map(selection => '<p>' + escape(selection.groupName) + ': ' + selection.options.map(option => escape(option.name)).join(', ') + '</p>').join('') +
          (item.notes ? '<p>Obs: ' + escape(item.notes) + '</p>' : '') +
          '<div class="quantity small"><button type="button" data-minus="' + escape(item.cartId) + '" aria-label="Diminuir quantidade">−</button><b>' + item.quantity +
          '</b><button type="button" data-plus="' + escape(item.cartId) + '" aria-label="Aumentar quantidade">+</button></div></div></article>';
      }).join('') + '</div>' + renderCartSuggestions(suggestions) :
      '<div class="empty"><span>🛍</span><h3>Seu carrinho está vazio</h3><p>Escolha seus favoritos no cardápio.</p></div>';
    bindImageFallbacks($('#cart-items'));
    applyStoreStateToCheckout();
  }

  function handleCartClick(event) {
    const button = event.target.closest('button');
    if (!button || !$('#cart-items').contains(button)) return;
    const items = CartStore.get();
    if (button.dataset.remove) {
      CartStore.remove(button.dataset.remove);
      return;
    }
    if (button.dataset.minus || button.dataset.plus) {
      const cartId = button.dataset.minus || button.dataset.plus;
      const item = items.find(current => current.cartId === cartId);
      if (item) CartStore.quantity(cartId, item.quantity + (button.dataset.plus ? 1 : -1));
      return;
    }
    if (button.dataset.suggestion) {
      const productId = button.dataset.suggestion;
      closeCart();
      openProduct(productId, button);
    }
  }

  function getCartSuggestions(items) {
    const inCart = new Set(items.map(item => item.productId));
    const complementary = /bebida|refrigerante|coca|fanta|suco|pastel|porç|batata|acompanhamento/i;
    return catalog.products
      .filter(product => product.active && !inCart.has(product.id))
      .map((product, index) => {
        const category = catalog.categories.find(item => item.id === product.categoryId) || {};
        const text = `${product.name} ${category.name || ''}`;
        const score = (complementary.test(text) ? 100 : 0) + (product.featured ? 10 : 0) - index;
        return { product, category, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }

  function renderCartSuggestions(suggestions) {
    if (!suggestions.length) return '';
    return '<section class="cart-suggestions"><header><small>COMBINA COM SEU PEDIDO</small><h3>Peça também</h3></header><div class="suggestion-track">' + suggestions.map(({ product, category }) => {
      const imageUrl = product.imageUrl || category.imageUrl || '';
      return '<button type="button" class="suggestion-card" data-suggestion="' + escape(product.id) + '">' +
        '<span class="suggestion-image">' + imageMarkup(imageUrl, product.name, category.emoji || '🥣') + '<i>＋</i></span>' +
        '<b>' + MenuAPI.money(product.price) + '</b><strong>' + escape(product.name) + '</strong>' +
      '</button>';
    }).join('') + '</div></section>';
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
    if (mode === 'open') return { open: true, text: 'Aberto e recebendo pedidos', mode };
    if (mode === 'closed') return { open: false, text: 'Fechado no momento', mode };
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
    if (closing) return { open: true, text: 'Aberto agora · até ' + closing, mode };

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
    return { open: false, text: 'Fechado agora' + nextText, mode };
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
      : state.text;
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
    const active = document.body.classList.contains('no-scroll');
    if (locked && !active) {
      lockedScrollY = window.scrollY;
      document.body.style.top = `-${lockedScrollY}px`;
      document.body.classList.add('no-scroll');
    } else if (!locked && active) {
      document.body.classList.remove('no-scroll');
      document.body.style.top = '';
      window.scrollTo(0, lockedScrollY);
    }
  }

  function openCart() {
    $('#cart').classList.add('open');
    $('#cart').setAttribute('aria-hidden', 'false');
    $('#cart-backdrop').hidden = false;
    syncBodyLock();
    requestAnimationFrame(() => {
      $('#cart-items').scrollTop = 0;
      $('[data-close-cart]')?.focus();
    });
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
      $('#clear-search').hidden = !query;
      renderProducts();
    });
    $('#focus-search').addEventListener('click', () => $('#search').focus());
    $('#clear-search').addEventListener('click', () => {
      query = '';
      $('#search').value = '';
      $('#clear-search').hidden = true;
      renderProducts();
      $('#search').focus();
    });
    $('#categories').addEventListener('click', event => {
      const button = event.target.closest('[data-category]');
      if (!button || !$('#categories').contains(button)) return;
      active = button.dataset.category;
      query = '';
      $('#search').value = '';
      $('#clear-search').hidden = true;
      renderCategories();
      renderProducts();
    });
    $('#products').addEventListener('click', event => {
      const button = event.target.closest('[data-product]');
      if (!button || !$('#products').contains(button)) return;
      openProduct(button.dataset.product, button);
    });
    $('#addon-list').addEventListener('change', event => {
      if (event.target.matches('input')) changeSelection(event.target);
    });
    $$('[data-open-cart]').forEach(button => button.addEventListener('click', openCart));
    $('#cart-items').addEventListener('click', handleCartClick);
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
    $('#product-step-back').addEventListener('click', previousProductStep);
    $('#add-to-cart').addEventListener('click', advanceProduct);
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
