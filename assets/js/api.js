(function(){
  const json = r => { if(!r.ok) throw new Error('Falha na comunicação'); return r.json(); };
  async function loadCatalog(){
    try { return await fetch('sistema/api.php?action=catalog',{cache:'no-store'}).then(json); }
    catch(e){
      const [settings,categories,products]=await Promise.all([
        fetch('data/config/store.json').then(json),
        fetch('data/categories/catalog.json').then(json),
        fetch('data/products/catalog.json').then(json)
      ]);
      return {settings,categories,products};
    }
  }
  async function createOrder(payload){
    try {
      const response=await fetch('sistema/api.php?action=order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      return await json(response);
    } catch(e){
      const number='ADB-'+Date.now().toString().slice(-8);
      const note=buildNote(number,payload);
      const orders=JSON.parse(localStorage.getItem('acai_orders')||'[]');
      orders.unshift({id:crypto.randomUUID(),number,status:'novo',createdAt:new Date().toISOString(),...payload});
      localStorage.setItem('acai_orders',JSON.stringify(orders));
      const phone=(window.ACAI_CATALOG?.settings.whatsapp||'').replace(/\D/g,'');
      const email=window.ACAI_CATALOG?.settings.orderEmail||'';
      return {orderNumber:number,note,whatsappUrl:phone?'https://wa.me/'+phone+'?text='+encodeURIComponent(note):'',emailUrl:email?'mailto:'+email+'?subject='+encodeURIComponent('Pedido '+number)+'&body='+encodeURIComponent(note):'',pixKey:window.ACAI_CATALOG?.settings.pixKey||'',paymentUrl:payload.paymentMethod==='payment_link'?(window.ACAI_CATALOG?.settings.paymentLink||''):''};
    }
  }
  function money(value){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(value)||0); }
  function buildNote(number,p){
    const lines=['🟣 *AÇAÍ DO BOM — PEDIDO '+number+'*','','👤 Cliente: '+p.customer.name,'📱 Telefone: '+p.customer.phone,'','🧾 *ITENS*'];
    p.items.forEach((item,i)=>{ lines.push((i+1)+'. '+item.quantity+'x '+item.name+' — '+money(item.unitTotal*item.quantity)); (item.selections||[]).forEach(s=>lines.push('   '+s.groupName+': '+s.options.map(o=>o.name).join(', '))); if(item.notes) lines.push('   Obs: '+item.notes); });
    lines.push('','Subtotal: '+money(p.subtotal),'Entrega: '+money(p.deliveryFee),'*TOTAL: '+money(p.total),'','Pagamento: '+p.paymentMethod);
    if(p.fulfillment==='delivery'){ const a=p.address; lines.push('📍 '+a.street+', '+a.number+(a.complement?' — '+a.complement:''),a.neighborhood+' — '+a.city+' — CEP '+a.zip); if(a.reference) lines.push('Referência: '+a.reference); }
    return lines.join('\n');
  }
  function injectTracking(settings){
    if(settings.gtmId){ const s=document.createElement('script'); s.text="(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer','"+settings.gtmId.replace(/[^A-Z0-9-]/gi,'')+"');"; document.head.appendChild(s); }
    if(settings.metaPixelId){ const s=document.createElement('script'); const id=settings.metaPixelId.replace(/\D/g,''); s.text="!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','"+id+"');fbq('track','PageView');"; document.head.appendChild(s); }
  }
  window.MenuAPI={loadCatalog,createOrder,money,buildNote,injectTracking};
})();