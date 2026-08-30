(function () {
  const json = response => {
    if (!response.ok) throw new Error('Falha na comunicação');
    return response.json();
  };

  async function loadStaticCatalog() {
    const [settings, categories, products] = await Promise.all([
      fetch('data/config/store.json', { cache: 'no-store' }).then(json),
      fetch('data/categories/catalog.json', { cache: 'no-store' }).then(json),
      fetch('data/products/catalog.json', { cache: 'no-store' }).then(json)
    ]);
    return { settings, categories, products };
  }

  async function loadCatalog() {
    if (window.SupabaseStore?.configured) {
      try {
        const remote = await window.SupabaseStore.loadCatalog();
        if (remote) return remote;
      } catch (error) {
        console.warn('Supabase indisponível; usando catálogo publicado no GitHub.', error);
      }
    }
    return loadStaticCatalog();
  }

  function orderResult(orderNumber, payload, stored, extra = {}) {
    const note = buildNote(orderNumber, payload);
    const settings = window.ACAI_CATALOG?.settings || {};
    const phone = String(settings.whatsapp || '').replace(/\D/g, '');
    return {
      orderNumber,
      note,
      stored,
      whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(note)}` : '',
      customerEmail: payload.customer.email || '',
      pixKey: settings.pixKey || '',
      paymentUrl: extra.paymentUrl || (payload.paymentMethod === 'payment_link' ? (settings.paymentLink || '') : ''),
      notificationSent: Boolean(extra.notificationSent),
      notificationError: extra.notificationError || '',
      storeEmailSent: Boolean(extra.storeEmailSent),
      emailAutomationConfigured: Boolean(extra.emailAutomationConfigured),
      emailNotificationError: extra.emailNotificationError || ''
    };
  }

  async function createOrder(payload) {
    const orderNumber = `ADB-${Date.now().toString().slice(-7)}${Math.floor(10 + Math.random() * 90)}`;
    if (window.SupabaseStore?.configured) {
      try {
        const saved = await window.SupabaseStore.createOrder(payload, orderNumber);
        trackOrder(payload, orderNumber);
        const settings = window.ACAI_CATALOG?.settings || {};
        let notificationSent = false;
        let notificationError = '';
        let storeEmailSent = false;
        let emailAutomationConfigured = false;
        let emailNotificationError = '';
        let paymentUrl = '';
        if (saved?.id) {
          try {
            const emailNotification = await window.SupabaseStore.notifyOrderEmail(saved.id, 'created');
            storeEmailSent = emailNotification.sent === true;
            emailAutomationConfigured = emailNotification.configured !== false;
          } catch (error) {
            emailNotificationError = error.message;
            console.error('Pedido salvo; falha na automação de e-mail.', error);
          }
        }
        if (settings.whatsappCloudEnabled && saved?.id) {
          try {
            const notification = await window.SupabaseStore.notifyOrder(saved.id);
            notificationSent = notification.sent === true;
          } catch (error) {
            notificationError = error.message;
            console.error('Pedido salvo; falha no WhatsApp Cloud API.', error);
          }
        }
        if (payload.paymentMethod === 'payment_link' && settings.gatewayEnabled && settings.gatewayProvider !== 'none' && saved?.id) {
          try {
            const checkout = await window.SupabaseStore.createCheckout(saved.id, settings.gatewayProvider);
            paymentUrl = checkout.checkoutUrl || '';
          } catch (error) {
            console.error('Pedido salvo; falha ao criar checkout.', error);
          }
        }
        return orderResult(orderNumber, payload, true, {
          notificationSent,
          notificationError,
          storeEmailSent,
          emailAutomationConfigured,
          emailNotificationError,
          paymentUrl
        });
      } catch (error) {
        console.error('Pedido não salvo no Supabase.', error);
      }
    }

    const orders = JSON.parse(localStorage.getItem('acai_orders') || '[]');
    orders.unshift({
      id: crypto.randomUUID(),
      number: orderNumber,
      status: 'novo',
      createdAt: new Date().toISOString(),
      ...payload
    });
    localStorage.setItem('acai_orders', JSON.stringify(orders.slice(0, 30)));
    return orderResult(orderNumber, payload, false);
  }

  function trackOrder(payload, orderNumber) {
    const settings = window.ACAI_CATALOG?.settings || {};
    const value = Math.round((Number(payload.total) || 0) * 100) / 100;
    const items = (Array.isArray(payload.items) ? payload.items : []).map((item, index) => ({
      item_id: String(item.productId || index + 1),
      item_name: String(item.name || 'Produto'),
      price: Math.round((Number(item.unitTotal ?? item.basePrice) || 0) * 100) / 100,
      quantity: Math.max(1, Number(item.quantity) || 1)
    }));
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: 'purchase',
      transaction_id: orderNumber,
      value,
      currency: 'BRL',
      items,
      ecommerce: { transaction_id: orderNumber, value, currency: 'BRL', items }
    });
    if (!settings.gtmId && typeof window.fbq === 'function') {
      window.fbq('track', 'Purchase', { value, currency: 'BRL' });
    }
    if (!settings.gtmId && typeof window.gtag === 'function') {
      window.gtag('event', 'purchase', { transaction_id: orderNumber, value, currency: 'BRL', items });
    }
  }

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(Number(value) || 0);
  }

  function buildNote(number, payload) {
    const paymentNames = {
      pix: 'PIX',
      card_delivery: 'Cartão na entrega',
      cash: 'Dinheiro',
      payment_link: 'Pagamento on-line'
    };
    const lines = [
      '━━━━━━━━━━━━━━━━━━━━',
      `🟣 *AÇAÍ DO BOM*`,
      `*PEDIDO ${number}*`,
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '👤 *CLIENTE*',
      `Nome: ${payload.customer.name}`,
      `WhatsApp: ${payload.customer.phone}`
    ];
    if (payload.customer.email) lines.push(`E-mail: ${payload.customer.email}`);
    lines.push('', '🧾 *ITENS DO PEDIDO*');
    payload.items.forEach((item, index) => {
      lines.push('', `${index + 1}. *${item.quantity}x ${item.name}*`, `   Valor: ${money(item.unitTotal * item.quantity)}`);
      (item.selections || []).forEach(selection => {
        lines.push(`   ${selection.groupName}: ${selection.options.map(option => option.name).join(', ')}`);
      });
      if (item.notes) lines.push(`   Observação: ${item.notes}`);
    });
    lines.push(
      '',
      '💰 *VALORES*',
      `Subtotal: ${money(payload.subtotal)}`,
      `Entrega: ${money(payload.deliveryFee)}`,
      `*TOTAL: ${money(payload.total)}*`,
      '',
      `💳 Pagamento: ${paymentNames[payload.paymentMethod] || payload.paymentMethod}`
    );
    if (payload.changeFor) lines.push(`Troco para: ${payload.changeFor}`);
    if (payload.fulfillment === 'delivery') {
      const address = payload.address;
      lines.push(
        '',
        '📍 *ENDEREÇO DE ENTREGA*',
        `${address.street}, ${address.number}${address.complement ? ` — ${address.complement}` : ''}`,
        `${address.neighborhood} — ${address.city}${address.zip ? ` — CEP ${address.zip}` : ''}`
      );
      if (address.reference) lines.push(`Referência: ${address.reference}`);
      if (address.mapUrl) lines.push(`Mapa: ${address.mapUrl}`);
    } else {
      lines.push('', '🏪 Retirada no local');
    }
    if (payload.notes) lines.push('', `📝 *OBSERVAÇÕES GERAIS*`, payload.notes);
    lines.push('', '━━━━━━━━━━━━━━━━━━━━');
    return lines.join('\n');
  }

  function injectTracking(settings) {
    if (settings.gtmId) {
      const id = settings.gtmId.replace(/[^A-Z0-9-]/gi, '');
      const script = document.createElement('script');
      script.text = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','${id}');`;
      document.head.appendChild(script);
    }
    if (settings.ga4Id) {
      const id = settings.ga4Id.replace(/[^A-Z0-9-]/gi, '');
      const loader = document.createElement('script');
      loader.async = true;
      loader.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
      document.head.appendChild(loader);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', id);
    }
    if (settings.metaPixelId) {
      const id = settings.metaPixelId.replace(/\D/g, '');
      const script = document.createElement('script');
      script.text = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`;
      document.head.appendChild(script);
    }
  }

  window.MenuAPI = { loadCatalog, createOrder, money, buildNote, injectTracking };
})();
