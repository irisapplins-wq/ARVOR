/* Récompenses uniquement depuis les RPC ; aucune attribution calculée dans le navigateur. */
(() => {
  'use strict';
  const dialog = document.getElementById('inventory-dialog');
  if (!dialog) return;
  const panel = document.createElement('section'); panel.className = 'inventory-active-effects';
  panel.setAttribute('aria-live','polite');
  dialog.querySelector('.inventory-storage').prepend(panel);
  let user = null, epoch = 0, busy = false, refreshGeneration = 0;
  const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname) || /^(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  const preview = local && new URLSearchParams(location.search).get('inventoryPreview') === 'potions';
  const node = (tag,text) => { const e=document.createElement(tag); e.textContent=text; return e; };
  async function read() {
    const r=await window.arvor.supabase.rpc('get_my_expedition_potion_rewards');
    if(r.error||!Array.isArray(r.data))throw Error('Lecture indisponible');
    for(const x of r.data)if(typeof x.expedition_id!=='string'||typeof x.item_id!=='string'||!['PENDING','STORED'].includes(x.state)||typeof x.can_claim!=='boolean')throw Error('Réponse invalide');
    return r.data;
  }
  let catalog;
  async function name(id) {
    catalog ||= fetch('js/item-catalog.json').then(r=>{if(!r.ok)throw Error('Catalogue indisponible');return r.json();}).then(c=>c.items).catch(error=>{catalog=null;throw error;});
    return (await catalog).find(i=>i.id===id)?.name||id;
  }
  async function refresh() {
    const who=user,e=epoch,g=++refreshGeneration;if(!who||preview)return;
    panel.replaceChildren();
    try{
      const rows=await read();if(e!==epoch||g!==refreshGeneration)return;
      for(const r of rows.filter(r=>r.state==='PENDING')){
        const label=await name(r.item_id);if(e!==epoch||g!==refreshGeneration)return;
        const row=node('p',label+' ×1 — '+(r.can_claim?'En attente : libérez une place si nécessaire.':'Transportée par l’expédition ; disponible au retour.'));
        if(r.can_claim){const b=node('button','Récupérer la potion');b.type='button';b.disabled=busy;b.addEventListener('click',async()=>{
          if(busy||user!==who||epoch!==e)return;busy=true;b.disabled=true;
          try{const response=await arvor.supabase.rpc('claim_my_expedition_potion',{p_expedition_id:r.expedition_id});if(epoch!==e)return;
            if(response.error||typeof response.data?.stored!=='boolean')throw Error('Réponse incertaine');
            if(response.data?.stored!==true){row.firstChild.textContent=label+' ×1 — Inventaire plein : potion conservée, aucune perte.';return;}
            await arvor.inventory.refresh(who);busy=false;await refresh();
          }catch{if(epoch===e)row.firstChild.textContent='Récupération non confirmée. Réessayez : aucune seconde potion ne sera attribuée.';}
          finally{if(epoch===e){busy=false;b.disabled=false;}}
        });row.append(b);}panel.append(row);
      }
      if(panel.childNodes.length)panel.prepend(node('h3','Potions rapportées des expéditions'));
    }catch{if(e===epoch&&g===refreshGeneration)panel.append(node('p','Récompenses de potions indisponibles pour le moment. Les possessions existantes restent inchangées.'));}
  }
  async function renderFor(id,parent) {
    const e=epoch;if(!user||!id||preview)return;
    try{const row=(await read()).find(r=>r.expedition_id===id);if(!row||epoch!==e)return;
      const label=await name(row.item_id);if(epoch!==e||!parent.isConnected)return;
      parent.append(node('p','Potion : '+label+' ×1 — '+(row.state==='STORED'?'déposée dans l’inventaire.':row.can_claim?'conservée en attente ; récupération depuis l’inventaire.':'transportée jusqu’au retour.')));
    }catch{/* Installation progressive : aucun gain supposé. */}
  }
  new MutationObserver(()=>{if(dialog.open)void refresh();}).observe(dialog,{attributes:true,attributeFilter:['open']});
  window.arvor ||= {};
  window.arvor.potionRewards=Object.freeze({setUser(id){user=id||null;epoch++;refreshGeneration++;busy=false;panel.replaceChildren();},renderFor,refresh});
})();
