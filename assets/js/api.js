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

  function orderResult(orderNumber, payload, stored) {
    const note = buildNote(orderNumber, payload);
    const settings = window.ACAI_CATALOG?.settings || {};
    const phone = String(settings.whatsapp || '').replace(/\D/g, '');
    const email = settings.orderEmail || '';
    return {
      orderNumber,
      note,
      stored,
      whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(note)}` : '',
      emailUrl: email ? `mailto:${email}?subject=${encodeURIComponent(`Pedido ${orderNumber}`)}&body=${encodeURIComponent(note)}` : '',
      pixKey: settings.pixKey || '',
      paymentUrl: payload.paymentMethod === 'payment_link' ? (settings.paymentLink || '') : ''
    };
  }

  async function createOrder(payload) {
    const orderNumber = `ADB-${Date.now().toString().slice(-8)}`;
    if (window.SupabaseStore?.configured) {
      try {
        await window.SupabaseStore.createOrder(payload, orderNumber);
        return orderResult(orderNumber, payload, true);
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

  function money(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
      .format(Number(value) || 0);
  }

  function buildNote(number, payload) {
    const lines = [
      `🟣 *AÇAÍ DO BOM — PEDIDO ${number}*`,
      '',
      `👤 Cliente: ${payload.customer.name}`,
      `📱 Telefone: ${payload.customer.phone}`
    ];
    if (payload.customer.email) lines.push(`✉️ E-mail: ${payload.customer.email}`);
    lines.push('', '🧾 *ITENS*');
    payload.items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.quantity}x ${item.name} — ${money(item.unitTotal * item.quantity)}`);
      (item.selections || []).forEach(selection => {
        lines.push(`   ${selection.groupName}: ${selection.options.map(option => option.name).join(', ')}`);
      });
      if (item.notes) lines.push(`   Obs: ${item.notes}`);
    });
    lines.push(
      '',
      `Subtotal: ${money(payload.subtotal)}`,
      `Entrega: ${money(payload.deliveryFee)}`,
      `*TOTAL: ${money(payload.total)}*`,
      '',
      `Pagamento: ${payload.paymentMethod}`
    );
    if (payload.changeFor) lines.push(`Troco para: ${payload.changeFor}`);
    if (payload.fulfillment === 'delivery') {
      const address = payload.address;
      lines.push(
        '',
        `📍 ${address.street}, ${address.number}${address.complement ? ` — ${address.complement}` : ''}`,
        `${address.neighborhood} — ${address.city}${address.zip ? ` — CEP ${address.zip}` : ''}`
      );
      if (address.reference) lines.push(`Referência: ${address.reference}`);
    } else {
      lines.push('', '🏪 Retirada no local');
    }
    if (payload.notes) lines.push('', `Observações gerais: ${payload.notes}`);
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
