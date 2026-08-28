(async function () {
  const defaults = {
    establishmentName: 'Açaí do Bom', locationName: 'Ji-Paraná - RO', cnpj: '',
    contactPhone: '(69) 9381-7951', publicEmail: 'contato@acaidobom.com.br'
  };
  let settings = defaults;
  try {
    const remote = window.SupabaseStore?.configured ? await window.SupabaseStore.loadCatalog() : null;
    if (remote?.settings) settings = { ...defaults, ...remote.settings };
    else {
      const response = await fetch('data/config/store.json', { cache: 'no-store' });
      if (response.ok) settings = { ...defaults, ...await response.json() };
    }
  } catch (error) {
    console.warn('Usando dados institucionais padrão.', error);
  }
  document.querySelectorAll('[data-legal-name]').forEach(el => { el.textContent = settings.establishmentName; });
  document.querySelectorAll('[data-legal-location]').forEach(el => { el.textContent = settings.locationName; });
  document.querySelectorAll('[data-legal-cnpj]').forEach(el => {
    el.textContent = settings.cnpj ? `CNPJ: ${settings.cnpj}` : '';
    el.hidden = !settings.cnpj;
  });
  const digits = String(settings.contactPhone || '').replace(/\D/g, '');
  const phone = digits.startsWith('55') ? digits : `55${digits}`;
  document.querySelectorAll('[data-legal-phone]').forEach(el => { el.textContent = settings.contactPhone; el.href = `tel:+${phone}`; });
  document.querySelectorAll('[data-legal-email]').forEach(el => { el.textContent = settings.publicEmail; el.href = `mailto:${settings.publicEmail}`; });
})();
