(function(){
  const listeners=new Set();
  const storageKey='acai_cart';
  const readItems=()=>{
    try{
      const parsed=JSON.parse(localStorage.getItem(storageKey)||'[]');
      return Array.isArray(parsed)?parsed.filter(item=>item&&typeof item==='object'):[];
    }catch(_){
      try{localStorage.removeItem(storageKey)}catch(__){}
      return [];
    }
  };
  let items=readItems();
  function notify(){ const snapshot=get(); listeners.forEach(fn=>{try{fn(snapshot)}catch(_){}}); }
  function persist(){
    try{localStorage.setItem(storageKey,JSON.stringify(items));}catch(_){/* O carrinho continua em memória quando o armazenamento está bloqueado. */}
    notify();
  }
  function get(){ return items.map(i=>({...i})); }
  function add(item){ if(!item||typeof item!=='object') return; items.push({...item,cartId:crypto.randomUUID()}); persist(); }
  function remove(id){ items=items.filter(i=>i.cartId!==id); persist(); }
  function quantity(id,value){ const next=Math.max(0,Math.floor(Number(value)||0)); if(next<=0) return remove(id); items=items.map(i=>i.cartId===id?{...i,quantity:next}:i); persist(); }
  function clear(){ items=[]; persist(); }
  function subtotal(){ return items.reduce((sum,i)=>sum+(Number(i.unitTotal)||0)*(Number(i.quantity)||0),0); }
  function count(){ return items.reduce((sum,i)=>sum+(Number(i.quantity)||0),0); }
  function hasFreeShipping(){ return items.some(i=>i.freeShippingEnabled===true); }
  function subscribe(fn){ listeners.add(fn); fn(get()); return ()=>listeners.delete(fn); }
  window.CartStore={get,add,remove,quantity,clear,subtotal,count,hasFreeShipping,subscribe};
})();