(function(){
  let catalog=null,step=1,bound=false;
  const $=s=>document.querySelector(s);
  const show=(el,yes)=>{ el.hidden=!yes; };
  function open(nextCatalog){
    catalog=nextCatalog; step=1; render(); $('#checkout-overlay').hidden=false; document.body.classList.add('no-scroll');
  }
  function close(){ $('#checkout-overlay').hidden=true; document.body.classList.remove('no-scroll'); $('#order-success').hidden=true; $('#checkout-form').hidden=false; $('#checkout-form').reset(); step=1; render(); }
  function render(){
    document.querySelectorAll('.checkout-step').forEach(el=>el.hidden=Number(el.dataset.step)!==step);
    $('#checkout-step-label').textContent='Etapa '+step+' de 3';
    $('#checkout-progress').style.width=(step/3*100)+'%';
    $('#checkout-back').disabled=step===1;
    $('#checkout-next').hidden=step===3;
    $('#checkout-submit').hidden=step!==3;
    $('#checkout-error').hidden=true;
    if(step===3){ renderPayments(); renderSummary(); }
  }
  function formData(){ return Object.fromEntries(new FormData($('#checkout-form')).entries()); }
  function validate(){
    const d=formData(), error=$('#checkout-error'); let message='';
    if(step===1 && (!String(d.name||'').trim() || String(d.phone||'').replace(/\D/g,'').length<10)) message='Informe seu nome e um WhatsApp válido.';
    if(step===2 && d.fulfillment==='delivery' && (!d.street||!d.number||!d.neighborhood||!d.city)) message='Preencha rua número bairro e cidade.';
    if(message){ error.textContent=message; error.hidden=false; return false; } return true;
  }
  function renderPayments(){
    const methods=[['pix','PIX',catalog.settings.pixKey?'Chave após confirmar':'Confirme com a loja'],['card_delivery','Cartão na entrega','Crédito ou débito'],['cash','Dinheiro','Informe se precisa de troco']];
    if(catalog.settings.paymentLink) methods.push(['payment_link','Pagamento on-line','Link seguro']);
    const current=document.querySelector('input[name=paymentMethod]:checked')?.value||'pix';
    $('#payment-options').innerHTML=methods.map(([v,l,d])=>'<label><input type="radio" name="paymentMethod" value="'+v+'" '+(v===current?'checked':'')+'><span><b>'+l+'</b><small>'+d+'</small></span></label>').join('');
    $('#payment-options').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{ $('#change-field').hidden=input.value!=='cash'; }));
  }
  function renderSummary(){
    const delivery=formData().fulfillment==='delivery'?Number(catalog.settings.deliveryFee):0,total=CartStore.subtotal()+delivery;
    $('#order-summary').innerHTML='<h3>Resumo</h3>'+CartStore.get().map(i=>'<div><span>'+i.quantity+'x '+i.name+'</span><b>'+MenuAPI.money(i.unitTotal*i.quantity)+'</b></div>').join('')+'<hr><div><span>Subtotal</span><b>'+MenuAPI.money(CartStore.subtotal())+'</b></div><div><span>Entrega</span><b>'+MenuAPI.money(delivery)+'</b></div><div class="total"><span>Total</span><b>'+MenuAPI.money(total)+'</b></div>';
    $('#checkout-submit').textContent='Confirmar · '+MenuAPI.money(total);
  }
  async function submit(event){
    event.preventDefault(); const d=formData(),delivery=d.fulfillment==='delivery'?Number(catalog.settings.deliveryFee):0;
    if(CartStore.subtotal()<Number(catalog.settings.minOrder) && d.fulfillment==='delivery'){ const e=$('#checkout-error'); e.textContent='O pedido mínimo é '+MenuAPI.money(catalog.settings.minOrder)+'.'; e.hidden=false; return; }
    const button=$('#checkout-submit'); button.disabled=true; button.textContent='Enviando pedido...';
    const payload={customer:{name:d.name,phone:d.phone,email:d.email||''},fulfillment:d.fulfillment,address:{zip:d.zip||'',street:d.street||'',number:d.number||'',complement:d.complement||'',neighborhood:d.neighborhood||'',reference:d.reference||'',city:d.city||''},paymentMethod:d.paymentMethod||'pix',changeFor:d.changeFor||'',notes:d.notes||'',items:CartStore.get(),subtotal:CartStore.subtotal(),deliveryFee:delivery,total:CartStore.subtotal()+delivery};
    try { const result=await MenuAPI.createOrder(payload); CartStore.clear(); showSuccess(result,d.name); }
    catch(error){ const e=$('#checkout-error'); e.textContent=error.message||'Não foi possível concluir o pedido.'; e.hidden=false; }
    finally { button.disabled=false; }
  }
  function showSuccess(result,name){
    $('#checkout-form').hidden=true; const box=$('#order-success'); box.hidden=false;
    box.innerHTML='<span class="success-icon">✓</span><small>PEDIDO RECEBIDO</small><h2>Obrigado '+String(name).split(' ')[0]+'!</h2><p>Seu pedido foi registrado com sucesso.</p><div class="order-number"><small>NÚMERO DO PEDIDO</small><b>'+result.orderNumber+'</b></div>'+
      (result.pixKey?'<div class="pix"><span><small>CHAVE PIX</small><b>'+result.pixKey+'</b></span><button type="button" data-copy-pix>Copiar</button></div>':'')+
      '<div class="success-links">'+(result.paymentUrl?'<a href="'+result.paymentUrl+'" target="_blank">Pagar on-line</a>':'')+(result.whatsappUrl?'<a class="wa" href="'+result.whatsappUrl+'" target="_blank">Enviar pelo WhatsApp</a>':'')+(result.emailUrl?'<a href="'+result.emailUrl+'">Enviar por e-mail</a>':'')+'</div><button type="button" class="link-button" data-finish>Voltar ao cardápio</button>';
    box.querySelector('[data-copy-pix]')?.addEventListener('click',()=>navigator.clipboard.writeText(result.pixKey));
    box.querySelector('[data-finish]').addEventListener('click',close);
  }
  function bind(){
    if(bound) return; bound=true;
    $('#checkout-next').addEventListener('click',()=>{ if(validate()){ step=Math.min(3,step+1); render(); } });
    $('#checkout-back').addEventListener('click',()=>{ step=Math.max(1,step-1); render(); });
    $('#close-checkout').addEventListener('click',close);
    $('#checkout-form').addEventListener('submit',submit);
    document.querySelectorAll('input[name=fulfillment]').forEach(input=>input.addEventListener('change',()=>{ $('#address-fields').hidden=input.value==='pickup'; }));
  }
  document.addEventListener('DOMContentLoaded',bind);
  window.Checkout={open,close};
})();