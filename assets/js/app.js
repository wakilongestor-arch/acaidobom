(async function(){
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let catalog,active='destaques',query='',selected=null,selections={},quantity=1;
  try{ catalog=await MenuAPI.loadCatalog(); window.ACAI_CATALOG=catalog; boot(); }catch(e){ $('#products').innerHTML='<div class="empty"><h3>Cardápio indisponível</h3><p>Tente novamente em alguns minutos.</p></div>'; }
  function boot(){
    const s=catalog.settings;
    if(!s.logoUrl) s.logoUrl='assets/images/logo/logo-acai-do-bom.webp';
    if(!s.primaryColor||s.primaryColor.toLowerCase()==='#5b1779') s.primaryColor='#620853';
    if(!s.accentColor||s.accentColor.toLowerCase()==='#f4c430') s.accentColor='#fcd307';
    s.brandBrightColor=s.brandBrightColor||'#be13af';
    document.documentElement.style.setProperty('--brand',s.primaryColor);
    document.documentElement.style.setProperty('--accent',s.accentColor);
    document.documentElement.style.setProperty('--brand-bright',s.brandBrightColor);
    renderLogo(s.logoUrl,s.storeName);
    $$('[data-store-name]').forEach(el=>el.textContent=s.storeName); $('#store-tagline').textContent=s.tagline; $('#store-city').textContent=s.city; $('#store-time').textContent=s.estimatedTime; $('#store-fee').textContent=MenuAPI.money(s.deliveryFee); $('#store-address').textContent=s.address;
    $('#hero-image').src=s.bannerUrl; const wa='https://wa.me/'+String(s.whatsapp).replace(/\D/g,''); $('#nav-whatsapp').href=wa; $('#callout-whatsapp').href=wa;
    $('#store-status').textContent=s.open?'● Aberto agora':'● Fechado no momento'; $('#store-status').classList.toggle('closed',!s.open);
    $('#minimum-order').textContent='Pedido mínimo para entrega: '+MenuAPI.money(s.minOrder);
    MenuAPI.injectTracking(s); renderCategories(); renderProducts(); bind(); CartStore.subscribe(renderCart);
  }
  function renderLogo(url,name){
    $$('.brand-mark').forEach(mark=>{
      const image=document.createElement('img');
      image.src=url;
      image.alt=name||'Açaí do Bom';
      image.addEventListener('error',()=>{ mark.classList.remove('has-logo'); mark.textContent='A'; mark.closest('.brand')?.classList.remove('has-image'); },{once:true});
      mark.replaceChildren(image);
      mark.classList.add('has-logo');
      mark.closest('.brand')?.classList.add('has-image');
    });
  }
  function renderCategories(){
    $('#categories').innerHTML=catalog.categories.filter(c=>c.active).map(c=>'<button data-category="'+escape(c.id)+'" class="'+(c.id===active?'active':'')+'"><span>'+escape(c.emoji)+'</span>'+escape(c.name)+'</button>').join('');
    $('#categories').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ active=b.dataset.category; query=''; $('#search').value=''; renderCategories(); renderProducts(); }));
  }
  function list(){
    return catalog.products.filter(p=>p.active).filter(p=>query?((p.name+' '+p.description).toLowerCase().includes(query.toLowerCase())):(active==='destaques'?p.featured:p.categoryId===active));
  }
  function renderProducts(){
    const products=list(); if(!products.length){ $('#products').innerHTML='<div class="empty"><span>⌕</span><h3>Nenhum produto encontrado</h3><p>Tente outro nome ou categoria.</p></div>'; return; }
    $('#products').innerHTML=products.map(p=>{ const c=catalog.categories.find(x=>x.id===p.categoryId)||{}; return '<article class="product-card"><button data-product="'+escape(p.id)+'"><div class="product-media">'+(p.imageUrl?'<img src="'+escape(p.imageUrl)+'" alt="'+escape(p.name)+'">':'<span>'+escape(c.emoji||'🥣')+'</span>')+(p.badge?'<b>'+escape(p.badge)+'</b>':'')+'</div><div class="product-copy"><small>'+escape(c.name||'Açaí do Bom')+'</small><h3>'+escape(p.name)+'</h3><p>'+escape(p.description)+'</p><footer><b>'+MenuAPI.money(p.price)+'</b><span>＋</span></footer></div></button></article>'; }).join('');
    $('#products').querySelectorAll('[data-product]').forEach(b=>b.addEventListener('click',()=>openProduct(b.dataset.product)));
  }
  function openProduct(id){
    selected=catalog.products.find(p=>p.id===id); if(!selected)return; selections={}; quantity=1; $('#product-image').src=selected.imageUrl||catalog.settings.bannerUrl; $('#product-name').textContent=selected.name; $('#product-description').textContent=selected.description; $('#product-base-price').textContent='A partir de '+MenuAPI.money(selected.price); $('#item-notes').value=''; $('#product-error').hidden=true;
    $('#addon-list').innerHTML=(selected.addonGroups||[]).map(g=>'<fieldset data-group="'+escape(g.id)+'"><legend><span><b>'+escape(g.name)+'</b><small>'+(g.required?'Obrigatório':'Opcional')+' · escolha até '+g.max+'</small></span>'+(g.required?'<em>OBRIGATÓRIO</em>':'')+'</legend>'+g.options.filter(o=>o.available!==false).map(o=>'<label><input type="'+(g.max===1?'radio':'checkbox')+'" name="group-'+escape(g.id)+'" value="'+escape(o.id)+'"><span>'+escape(o.name)+'</span><b>'+(o.price?'+ '+MenuAPI.money(o.price):'Incluso')+'</b></label>').join('')+'</fieldset>').join('');
    $('#addon-list').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>changeSelection(input))); updateProductTotal(); $('#product-overlay').hidden=false; document.body.classList.add('no-scroll');
  }
  function changeSelection(input){
    const field=input.closest('fieldset'),group=selected.addonGroups.find(g=>g.id===field.dataset.group),option=group.options.find(o=>o.id===input.value),current=selections[group.id]||[];
    if(group.max===1) selections[group.id]=input.checked?[option]:[];
    else if(input.checked){ if(current.length>=group.max){ input.checked=false; return; } selections[group.id]=[...current,option]; }
    else selections[group.id]=current.filter(o=>o.id!==option.id);
    input.closest('label').classList.toggle('selected',input.checked); updateProductTotal();
  }
  function unitTotal(){ return Number(selected?.price||0)+Object.values(selections).flat().reduce((sum,o)=>sum+Number(o.price),0); }
  function updateProductTotal(){ $('#item-quantity').textContent=quantity; $('#add-to-cart').textContent='Adicionar · '+MenuAPI.money(unitTotal()*quantity); }
  function addProduct(){
    for(const g of selected.addonGroups||[]){ if((selections[g.id]||[]).length<Number(g.min||0)){ const e=$('#product-error'); e.textContent='Escolha '+g.min+' opção em “'+g.name+'”.'; e.hidden=false; return; } }
    CartStore.add({productId:selected.id,name:selected.name,imageUrl:selected.imageUrl,basePrice:selected.price,quantity,selections:(selected.addonGroups||[]).filter(g=>(selections[g.id]||[]).length).map(g=>({groupId:g.id,groupName:g.name,options:selections[g.id]})),notes:$('#item-notes').value,unitTotal:unitTotal()}); closeProduct(); openCart();
  }
  function closeProduct(){ $('#product-overlay').hidden=true; document.body.classList.remove('no-scroll'); selected=null; }
  function renderCart(){
    const items=CartStore.get(),count=CartStore.count(),subtotal=CartStore.subtotal(); $$('[data-cart-count]').forEach(el=>el.textContent=count); $('#cart-subtotal').textContent=MenuAPI.money(subtotal); $('#mobile-total').textContent=MenuAPI.money(subtotal); $$('.mobile-cart').forEach(el=>el.hidden=!count); $('#cart-footer').hidden=!count;
    $('#cart-items').innerHTML=items.length?items.map(i=>'<article><header><div><b>'+i.quantity+'x '+escape(i.name)+'</b><strong>'+MenuAPI.money(i.unitTotal*i.quantity)+'</strong></div><button data-remove="'+i.cartId+'">🗑</button></header>'+i.selections.map(s=>'<p>'+escape(s.groupName)+': '+s.options.map(o=>escape(o.name)).join(', ')+'</p>').join('')+(i.notes?'<p>Obs: '+escape(i.notes)+'</p>':'')+'<div class="quantity small"><button data-minus="'+i.cartId+'">−</button><b>'+i.quantity+'</b><button data-plus="'+i.cartId+'">+</button></div></article>').join(''):'<div class="empty"><span>🛍</span><h3>Seu carrinho está vazio</h3><p>Escolha seus favoritos no cardápio.</p></div>';
    $('#cart-items').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>CartStore.remove(b.dataset.remove)); $('#cart-items').querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>{ const i=items.find(x=>x.cartId===b.dataset.minus); CartStore.quantity(i.cartId,i.quantity-1); }); $('#cart-items').querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>{ const i=items.find(x=>x.cartId===b.dataset.plus); CartStore.quantity(i.cartId,i.quantity+1); });
  }
  function openCart(){ $('#cart').classList.add('open'); $('#cart').setAttribute('aria-hidden','false'); $('#cart-backdrop').hidden=false; document.body.classList.add('no-scroll'); }
  function closeCart(){ $('#cart').classList.remove('open'); $('#cart').setAttribute('aria-hidden','true'); $('#cart-backdrop').hidden=true; document.body.classList.remove('no-scroll'); }
  function bind(){
    $('#search').addEventListener('input',e=>{ query=e.target.value; renderProducts(); });
    $$('[data-open-cart]').forEach(b=>b.addEventListener('click',openCart)); $('[data-close-cart]').addEventListener('click',closeCart); $('#cart-backdrop').addEventListener('click',closeCart);
    $('[data-close-product]').addEventListener('click',closeProduct); $('#product-overlay').addEventListener('click',e=>{ if(e.target.id==='product-overlay') closeProduct(); });
    $('[data-qty-minus]').addEventListener('click',()=>{ quantity=Math.max(1,quantity-1); updateProductTotal(); }); $('[data-qty-plus]').addEventListener('click',()=>{ quantity++; updateProductTotal(); }); $('#add-to-cart').addEventListener('click',addProduct);
    $('#start-checkout').addEventListener('click',()=>{ closeCart(); Checkout.open(catalog); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ closeProduct(); closeCart(); } });
  }
})();
