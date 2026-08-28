(function () {
  const config = window.ACAI_SUPABASE_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.url || '') &&
    typeof config.anonKey === 'string' && config.anonKey.length > 40 &&
    !config.anonKey.includes('COLE_AQUI');
  let client = null;

  function getClient() {
    if (!configured) return null;
    if (!window.supabase?.createClient) throw new Error('Biblioteca do Supabase não carregada.');
    if (!client) {
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  function throwIfError(error, fallback) {
    if (error) throw new Error(error.message || fallback);
  }

  async function loadCatalog() {
    const db = getClient();
    if (!db) return null;
    const { data, error } = await db
      .from('catalogs')
      .select('id,data')
      .in('id', ['settings', 'categories', 'products']);
    throwIfError(error, 'Não foi possível carregar o cardápio.');
    const rows = Object.fromEntries((data || []).map(row => [row.id, row.data]));
    if (!rows.settings || !rows.categories || !rows.products) return null;
    return { settings: rows.settings, categories: rows.categories, products: rows.products };
  }

  async function saveCatalog(catalog) {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de publicar.');
    const updatedAt = new Date().toISOString();
    const rows = [
      { id: 'settings', data: catalog.settings, updated_at: updatedAt },
      { id: 'categories', data: catalog.categories, updated_at: updatedAt },
      { id: 'products', data: catalog.products, updated_at: updatedAt }
    ];
    const { error } = await db.from('catalogs').upsert(rows, { onConflict: 'id' });
    throwIfError(error, 'Não foi possível publicar as alterações.');
  }

  async function createOrder(payload, orderNumber) {
    const db = getClient();
    if (!db) return false;
    const row = {
      id: crypto.randomUUID(),
      order_number: orderNumber,
      customer: payload.customer,
      fulfillment: payload.fulfillment,
      address: payload.address,
      payment_method: payload.paymentMethod,
      change_for: payload.changeFor || '',
      notes: payload.notes || '',
      items: payload.items,
      subtotal: Number(payload.subtotal || 0),
      delivery_fee: Number(payload.deliveryFee || 0),
      total: Number(payload.total || 0),
      status: 'novo',
      payment_status: 'pendente'
    };
    const { error } = await db.from('orders').insert(row);
    throwIfError(error, 'Não foi possível registrar o pedido.');
    return { id: row.id, order_number: row.order_number };
  }

  async function notifyOrder(orderId) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('whatsapp-order', { body: { orderId } });
    throwIfError(error, 'O pedido foi salvo, mas o WhatsApp automático não foi enviado.');
    return data || {};
  }

  async function createCheckout(orderId, provider) {
    const db = getClient();
    if (!db) throw new Error('Supabase não configurado.');
    const { data, error } = await db.functions.invoke('create-checkout', { body: { orderId, provider } });
    throwIfError(error, 'O pedido foi salvo, mas o checkout não pôde ser criado.');
    return data || {};
  }

  async function listOrders() {
    const db = getClient();
    if (!db) return [];
    const { data, error } = await db
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    throwIfError(error, 'Não foi possível carregar os pedidos.');
    return data || [];
  }

  async function updateOrder(id, status, paymentStatus) {
    const db = getClient();
    const { error } = await db
      .from('orders')
      .update({ status, payment_status: paymentStatus, updated_at: new Date().toISOString() })
      .eq('id', id);
    throwIfError(error, 'Não foi possível atualizar o pedido.');
  }

  async function optimizeImage(file) {
    let source;
    try {
      source = await createImageBitmap(file);
    } catch (error) {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Não foi possível ler esta imagem.')); };
        image.src = objectUrl;
      });
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { alpha: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    const optimized = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.84));
    if (!optimized) throw new Error('Não foi possível otimizar a imagem.');
    return optimized;
  }

  async function uploadImage(file, folder = 'geral') {
    const db = getClient();
    if (!db) throw new Error('Configure o Supabase antes de enviar imagens.');
    if (!file?.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
    if (file.size > 12 * 1024 * 1024) throw new Error('A imagem original deve ter no máximo 12 MB.');
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData?.session) throw new Error('Sua sessão expirou. Entre novamente no painel.');
    const optimized = await optimizeImage(file);
    if (optimized.size > 5 * 1024 * 1024) throw new Error('A imagem ficou maior que 5 MB mesmo após a otimização.');
    const safeFolder = String(folder || 'geral').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    const path = `${safeFolder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.webp`;
    const { error } = await db.storage.from('menu-images').upload(path, optimized, {
      cacheControl: '31536000',
      contentType: 'image/webp',
      upsert: false
    });
    if (error) {
      const missingBucket = /bucket|row-level|policy|not found/i.test(error.message || '');
      throw new Error(missingBucket
        ? 'O armazenamento de imagens ainda não está liberado. Execute novamente database/supabase.sql no Supabase.'
        : (error.message || 'Não foi possível enviar a imagem.'));
    }
    return db.storage.from('menu-images').getPublicUrl(path).data.publicUrl;
  }

  async function signIn(email, password) {
    const db = getClient();
    if (!db) throw new Error('Supabase ainda não configurado.');
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    throwIfError(error, 'E-mail ou senha incorretos.');
    return data.session;
  }

  async function getSession() {
    const db = getClient();
    if (!db) return null;
    const { data, error } = await db.auth.getSession();
    throwIfError(error, 'Não foi possível verificar o acesso.');
    return data.session;
  }

  async function signOut() {
    const db = getClient();
    if (db) await db.auth.signOut();
  }

  window.SupabaseStore = {
    configured,
    getClient,
    loadCatalog,
    saveCatalog,
    createOrder,
    notifyOrder,
    createCheckout,
    listOrders,
    updateOrder,
    uploadImage,
    signIn,
    getSession,
    signOut
  };
})();
