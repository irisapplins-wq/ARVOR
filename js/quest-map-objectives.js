/* Indications géographiques ciblées, autorisées par une lecture serveur ; aucun changement du brouillard. */
(() => {
  'use strict';
  const map=document.getElementById('armorique-map'), view=document.getElementById('armorique-view');
  if (!map || !view) return;
  const layer=document.createElement('div'); layer.className='quest-map-objectives'; map.parentElement.append(layer);
  const panel=document.createElement('div'); panel.className='armorique-location-panel'; panel.hidden=true; view.append(panel);
  const notice=document.createElement('p'); notice.className='quest-map-objective-notice'; view.append(notice);
  let user=null, revision=0, busy=false, timer=null, panelRevision=0;
  function clear() { panelRevision++; layer.replaceChildren(); panel.replaceChildren(); panel.hidden=true; }
  function visible() { return user && !view.hidden && !document.hidden; }
  function show(location,opener,kind) {
    const pr=++panelRevision, rev=revision;
    const current=()=>pr===panelRevision && rev===revision && !panel.hidden && user;
    panel.replaceChildren(); const title=document.createElement('h4'); title.textContent=kind==='FIND_ITEM'?'Expédition de quête : '+location.name:location.name;
    const text=document.createElement('p'); text.textContent=kind==='FIND_ITEM'?'Rapportez l’objet demandé au cours d’une expédition E2 victorieuse.':'Objectif de quête';
    const close=document.createElement('button'); close.type='button'; close.textContent='Fermer';
    close.onclick=()=>{panelRevision++;panel.hidden=true;opener.focus({preventScroll:true});};
    panel.append(title,text);
    if (kind==='FIND_ITEM') {
      const status=document.createElement('p'); status.textContent='Vérification des conditions d’expédition…'; status.setAttribute('role','status');
      const prepare=document.createElement('button'); prepare.type='button'; prepare.textContent='Préparer l’expédition'; prepare.hidden=true;
      let sending=false;
      const inspect=async()=>{
        try {
          const api=window.arvor?.questExpeditions;
          if (!api) throw Error('Préparation indisponible');
          const result=await api.inspect(location.code); if (!current()) return;
          status.textContent=result.message; prepare.hidden=!result.canPrepare;
        } catch { if(current())status.textContent='La préparation des expéditions est indisponible. Réessayez dans un instant.'; }
      };
      prepare.onclick=async()=>{
        if (sending || !current()) return; sending=true; prepare.disabled=true; status.textContent='Vérification du lieu et ouverture de la préparation…';
        try {
          const result=await window.arvor.questExpeditions.prepare(location.code,opener,current); if(!current())return;
          if(result.opened){panelRevision++;panel.hidden=true;}
          else {status.textContent=result.message || 'La préparation est indisponible. Réessayez.';prepare.hidden=!result.canPrepare;}
        } catch {if(current())status.textContent='La préparation est indisponible. Aucun départ n’a été envoyé.';}
        finally {sending=false;if(current())prepare.disabled=false;}
      };
      panel.append(status,prepare); void inspect();
    }
    panel.append(close); panel.hidden=false; close.focus({preventScroll:true});
  }
  async function refresh() {
    if (!visible() || busy) return;
    const rev=revision, who=user; busy=true;
    try {
      const {data,error}=await window.arvor.supabase.rpc('get_my_quest_map_objectives');
      if (rev!==revision || who!==user) return;
      if (error || !Array.isArray(data)) throw Error('Lecture indisponible');
      const codes=new Set();
      for (const l of data) {
        if (!l || typeof l.code!=='string' || !l.code || codes.has(l.code) || typeof l.name!=='string' ||
          !Number.isInteger(l.columns) || l.columns<1 || !Number.isInteger(l.rows) || l.rows<1 ||
          !Number.isInteger(l.column_index) || l.column_index<0 || l.column_index>=l.columns ||
          !Number.isInteger(l.row_index) || l.row_index<0 || l.row_index>=l.rows) throw Error('Coordonnées invalides');
        if (l.objective_types !== undefined && (!Array.isArray(l.objective_types) || !l.objective_types.length ||
          new Set(l.objective_types).size!==l.objective_types.length ||
          l.objective_types.some(t=>!['DISCOVER_LOCATION','FIND_ITEM'].includes(t)))) throw Error('Objectifs invalides');
        codes.add(l.code);
      }
      clear(); notice.textContent=''; const fragment=document.createDocumentFragment();
      for (const l of data) {
        // Compatibilité avec 035 : absence de type signifie uniquement découverte.
        const types=l.objective_types || ['DISCOVER_LOCATION'];
        const group=document.createElement('div'); group.className='quest-map-objective-group';
        const half=types.length*22;
        group.style.left='clamp('+half+'px, '+((l.column_index+.5)*100/l.columns)+'%, calc(100% - '+half+'px))';
        group.style.top='clamp(22px, '+((l.row_index+.5)*100/l.rows)+'%, calc(100% - 22px))';
        for (const kind of types) {
          const expedition=kind==='FIND_ITEM';
          const b=document.createElement('button'); b.type='button'; b.className='quest-map-objective'+(expedition?' quest-map-expedition':'');
          b.textContent=expedition?'⚔\uFE0E':'!'; b.dataset.locationCode=l.code; b.dataset.objectiveType=kind;
          b.title=expedition?'Expédition de quête : '+l.name:l.name+' — Objectif de quête'; b.setAttribute('aria-label',b.title);
          b.onclick=()=>show(l,b,kind); group.append(b);
        }
        fragment.append(group);
      }
      layer.append(fragment);
    } catch {
      if (rev===revision) { clear(); notice.textContent='Les repères de quête sont momentanément indisponibles.'; }
    } finally { if (rev===revision) busy=false; }
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){panelRevision++;panel.hidden=true;}});
  document.addEventListener('visibilitychange',()=>void refresh());
  window.arvor ||= {};
  window.arvor.questMap=Object.freeze({refresh,setUser(id){revision++;user=id||null;busy=false;clear();notice.textContent='';clearInterval(timer);timer=user?setInterval(()=>void refresh(),15000):null;}});
})();
