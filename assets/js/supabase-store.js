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
    return true;
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

  async function uploadImage(file) {
    const db = getClient();
    if (!file?.type?.startsWith('image/')) throw new Error('Selecione uma imagem válida.');
    if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 5 MB.');
    const extension = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
    const { error } = await db.storage.from('menu-images').upload(path, file, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false
    });
    throwIfError(error, 'Não foi possível enviar a imagem.');
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
    listOrders,
    updateOrder,
    uploadImage,
    signIn,
    getSession,
    signOut
  };
})();
