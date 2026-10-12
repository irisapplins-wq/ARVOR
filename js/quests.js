/* Le serveur fournit les états, preuves, possessions et récompenses. Aucun événement inventé. */
(() => {
  'use strict';
  const el = id => document.getElementById(id), journal = el('quest-dialog'), npcDialog = el('quest-npc-dialog');
  if (!journal || !npcDialog) return;
  const access = el('show-quests'), notice = el('quest-notice'), npcNotice = el('quest-npc-notice');
  let user = null, epoch = 0, list = [], enabled = false, selected = null, category = 'principale';
  let storyActive = false;
  let refreshTimer = null;
  function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; }
  function refreshVisible() { if (user && journal.open && !document.hidden && !npcDialog.open && !storyActive) void refresh(true); }
  let busy = false, pending = null, confirmation = null, npc = null, opener = null, dialogueEpoch = 0;
  const labels = { LOCKED:'Verrouillée', AVAILABLE:'Disponible', ACTIVE:'En cours', READY_TO_TURN_IN:'Prête à remettre', COMPLETED:'Terminée' };
  const item = id => window.ARVORQuestItems?.items.find(x => x.id === id);
  const characters = {merlin_guide:'merlin',tavernier:'tavernier',forgeron:'forgeron',herboriste:'herboriste'};
  const npcNames = {merlin_guide:'Merlin',tavernier:'le tavernier',forgeron:'le forgeron',herboriste:'l’herboriste'};
  let storyRevision = 0;
  let rewardCatalog;
  function loadRewardCatalog() {
    rewardCatalog ||= fetch('js/item-catalog.json').then(r => { if (!r.ok) throw Error('Catalogue indisponible'); return r.json(); }).then(c => c.items).catch(() => []);
    return rewardCatalog;
  }
  let rewardItems = [];
  function node(tag, text, className) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; }
  function button(text, callback, disabled = false) { const b = node('button', text); b.type = 'button'; b.disabled = disabled || busy; b.addEventListener('click', callback); return b; }
  function errorText(error) {
    const code = String(error?.message || error || '');
    const reasons = { DISABLED:'Les quêtes ne sont pas encore ouvertes.', LOCKED:'Cette quête est encore verrouillée.', TALK_REQUIRED:'Poursuivez le dialogue avec le donneur avant d’accepter la quête.', ITEM_ABSENT:'L’objet requis n’est plus dans votre inventaire.', WRONG_DELIVERY:'Cet objet ne peut pas être remis ici.', NOT_READY:'Les objectifs ne sont pas encore terminés.', REQUEST_CONFLICT:'La requête précédente ne correspond pas à cette action.', AUTH_REQUIRED:'Reconnectez-vous pour poursuivre.', NPC_INVALID:'Ce personnage est indisponible.' };
    return Object.entries(reasons).find(([key]) => code.includes(key))?.[1] || 'Opération indisponible. Aucune réussite n’est présumée ; actualisez ou réessayez la même action.';
  }
  async function rpc(name, params = {}) {
    const client = window.arvor?.supabase; if (!client || !user) throw Error('AUTH_REQUIRED');
    const result = await client.rpc(name, params); if (result.error) throw result.error; return result.data;
  }
  function valid(data) {
    if (!data || typeof data.enabled !== 'boolean' || !Array.isArray(data.quests)) throw Error('Réponse invalide');
    const ids = new Set();
    for (const q of data.quests) { if (!q || typeof q.id !== 'string' || ids.has(q.id) || !labels[q.state] || !Array.isArray(q.objectives) || !q.rewards) throw Error('Réponse invalide'); ids.add(q.id); }
    enabled = data.enabled; list = enabled ? data.quests : [];
    void window.arvor?.questMap?.refresh();
    selected = list.find(q => q.id === selected?.id) || null;
  }
  function rewardText(q) {
    const resources = {food:'nourriture',wood:'bois',stone:'pierre',iron:'fer'};
    const parts = Object.entries(q.rewards.resources || {}).map(([k,v]) => v + ' ' + (resources[k] || k));
    if (Number(q.rewards.coins)) parts.push(q.rewards.coins + ' pièces d’or');
    for (const [k,v] of Object.entries(q.rewards.items || {})) parts.push(v + ' × ' + (item(k)?.name || rewardItems.find(i => i.id === k)?.name || k));
    return parts.join(' · ') || 'La suite de votre aventure';
  }
  function progress(q) {
    const index = q.step_index;
    return Number.isInteger(index) && index >= 0 && index <= q.objectives.length &&
      q.objectives.every((o,i) => typeof o.done === 'boolean' && o.done === (i < index)) ? index : null;
  }
  function render() {
    for (const b of journal.querySelectorAll('[data-quest-category]')) b.setAttribute('aria-pressed', String(b.dataset.questCategory === category));
    el('quest-refresh').disabled = busy || !user;
    const target = el('quest-list'); target.replaceChildren();
    const shown = list.filter(q => q.type === category);
    if (!selected || !shown.some(q => q.id === selected.id)) selected = shown.find(q => ['ACTIVE','READY_TO_TURN_IN'].includes(q.state)) || shown.find(q => q.state === 'AVAILABLE') || shown[0] || null;
    if (!shown.length) target.append(node('p', enabled ? 'Aucun récit dans cette catégorie pour le moment.' : 'Le journal ouvrira lorsque les récits seront disponibles.', 'quest-list-empty'));
    for (const [title,states] of [['En cours',['ACTIVE','READY_TO_TURN_IN']],['Disponibles',['AVAILABLE']],['À débloquer',['LOCKED']],['Terminées',['COMPLETED']]]) {
      const quests = shown.filter(q => states.includes(q.state)); if (!quests.length) continue;
      const group = node(title === 'Terminées' ? 'details' : 'section',undefined,'quest-list-group');
      group.append(node(title === 'Terminées' ? 'summary' : 'h3',title + ' · ' + quests.length));
      if (title === 'Terminées') group.open = quests.some(q => q.id === selected?.id);
      for (const q of quests) {
        const b = button('', () => { selected = q; render(); }); b.className = 'quest-card';
        b.setAttribute('aria-pressed', String(selected?.id === q.id)); b.dataset.questId = q.id;
        b.append(node('strong',q.title),node('span',labels[q.state],'quest-card-state'));
        group.append(b);
      }
      target.append(group);
    }
    renderDetails();
  }
  function meet(q,id,label) { return button(label || (id === 'tavernier' ? 'Parler au tavernier' : id === 'forgeron' ? 'Parler au forgeron' : 'Parler à ' + (npcNames[id] || id)), () => openQuestNPC(q,id)); }
  function navigate(id) {
    const control = el(id); if (!control || control.disabled) return;
    journal.close(); control.click(); control.focus();
  }
  function renderDetails() {
    const box = el('quest-details'); box.replaceChildren(); const q = selected;
    if (!q) { box.append(node('p', enabled ? 'Choisissez une quête dans la liste pour ouvrir son parchemin.' : 'Les récits seront accessibles à l’ouverture des quêtes.')); return; }
    box.append(node('p', q.type === 'principale' ? 'Quête principale' : 'Quête secondaire', 'inventory-kicker'), node('h3', q.title), ...(q.chapter ? [node('p', q.chapter, 'inventory-kicker')] : []), node('p', q.description,'quest-narrative'), node('p', labels[q.state], 'quest-state'));
    const index = progress(q), current = q.state === 'ACTIVE' && index !== null && index < q.objectives.length ? q.objectives[index] : null;
    box.append(node('h4','Votre chemin'));
    if (index !== null) box.append(node('p', ['READY_TO_TURN_IN','COMPLETED'].includes(q.state) ? 'Objectifs accomplis : ' + index + ' sur ' + q.objectives.length : q.state === 'ACTIVE' && current ? 'Étape ' + (index + 1) + ' sur ' + q.objectives.length : q.objectives.length + ' étape(s)', 'quest-step-count'));
    const objectives = node('ol',undefined,'quest-objectives');
    for (const [i,o] of q.objectives.entries()) {
      const active = current && i === index, done = o.done === true;
      const li = node('li',undefined,done ? 'quest-done' : active ? 'quest-current' : 'quest-future');
      li.append(node('span',done ? '✓' : active ? '➜' : '○','quest-objective-symbol'),node('span',o.label));
      if (active) li.setAttribute('aria-current','step'); objectives.append(li);
    }
    box.append(objectives,node('h4','Récompenses'),node('p',rewardText(q),'quest-rewards'));
    const actions = node('div',undefined,'quest-actions'), extra = node('div',undefined,'quest-secondary-actions'); let primary;
    if (pending?.questId === q.id) primary = button('Reprendre la dernière action', () => act(pending.questId,pending.action,pending.npcId));
    else if (q.reward_state === 'PENDING') {
      box.append(node('p','Votre récompense vous attend. Libérez de la place dans votre stockage ou votre inventaire.'));
      primary = button('Recevoir ma récompense', () => ask(q,'CLAIM_REWARD',null,'Recevoir la récompense conservée ?'));
    } else if (q.state === 'AVAILABLE') primary = meet(q,q.giver,'Rencontrer ' + (npcNames[q.giver] || q.giver));
    else if (q.state === 'READY_TO_TURN_IN') primary = meet(q,q.recipient,'Terminer la quête');
    else if (q.state === 'ACTIVE') {
      if (current?.type === 'TALK_TO_NPC') primary = meet(q,current.npc_id);
      else if (current?.type === 'DELIVER_ITEM') primary = meet(q,current.npc_id,'Remettre l’objet demandé');
      else if (current?.type === 'COLLECT_RESOURCE') primary = button('Vérifier mes réserves', () => act(q.id,'SYNC',null));
      else if (current && ['FIND_ITEM','DISCOVER_LOCATION','BUILD_STRUCTURE'].includes(current.type)) {
        const id = current.type === 'BUILD_STRUCTURE' ? 'show-domain-view' : 'show-armorique-view';
        if (el(id) && !el(id).disabled) primary = button(current.type === 'BUILD_STRUCTURE' ? 'Voir mon domaine' : 'Consulter la carte', () => navigate(id));
        box.append(node('p',current.type === 'BUILD_STRUCTURE' ? 'Retrouvez vos constructions dans la vue du domaine.' : 'Explorez depuis la carte et les lieux que vous avez découverts.'));
        extra.append(button('Vérifier cet objectif', () => act(q.id,'SYNC',null)));
      } else {
        box.append(node('p','Consultez les objectifs : les informations disponibles ne permettent pas de préciser votre prochaine action.'));
        extra.append(button('Vérifier les objectifs', () => act(q.id,'SYNC',null)));
      }
    } else if (q.state === 'LOCKED') box.append(node('p','Poursuivez les récits précédents pour débloquer cette quête.'));
    else if (q.state === 'COMPLETED') { box.append(node('p','Ce récit est terminé. Vous pouvez en relire les objectifs et les récompenses.')); extra.append(meet(q,q.recipient,'Relire la rencontre')); }
    if (primary) { primary.classList.add('quest-primary-action'); if (pending && pending.questId !== q.id) { primary.disabled = true; box.append(node('p','Reprenez d’abord l’action en attente dans sa quête.')); } actions.append(primary); }
    box.append(actions,extra);
  }
  async function refresh(silent = false) {
    if (busy || !user) return; const e = epoch; busy = true; if (!silent) notice.textContent = 'Lecture du journal…'; render();
    try { const [data,catalog] = await Promise.all([rpc('get_my_quests'),loadRewardCatalog()]); if (e !== epoch) return; rewardItems = catalog; valid(data); notice.textContent = enabled ? '' : 'Les quêtes ne sont pas encore ouvertes.'; }
    catch (error) { if (e !== epoch) return; enabled = false; list = []; selected = null; notice.textContent = errorText(error); }
    finally { if (e === epoch) { busy = false; render(); if (journal.open && !refreshTimer) refreshTimer = setInterval(refreshVisible,30000); } }
  }
  function ask(q, action, npcId, text) {
    if (!user || busy || !enabled) return;
    confirmation = {questId:q.id,action,npcId}; el('quest-confirmation-text').textContent = text; el('quest-confirmation').hidden = false;
    // La confirmation vit dans la fenêtre de dialogue, même pour une récompense en attente.
    if (!npcDialog.open) { el('quest-npc-title').textContent = 'Confirmation'; el('quest-npc-description').textContent = q.title; el('quest-npc-text').textContent = ''; el('quest-npc-actions').replaceChildren(); npcNotice.textContent = ''; npcDialog.showModal(); }
    el('quest-confirm-yes').focus();
  }
  async function act(questId, action, npcId) {
    if (busy || !enabled || !user) return;
    if (pending && (pending.questId !== questId || pending.action !== action || pending.npcId !== npcId)) { notice.textContent = npcNotice.textContent = 'Une réponse est incertaine. Réessayez d’abord la même action ou actualisez pour vérifier son résultat.'; return; }
    const e = epoch, who = user; pending ||= {questId,action,npcId,requestId:crypto.randomUUID()}; const attempt = pending;
    busy = true; notice.textContent = npcNotice.textContent = 'Mise à jour du journal…'; el('quest-confirmation').hidden = true; render(); el('quest-npc-actions').querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const data = await rpc('quest_action',{p_quest_id:questId,p_action:action,p_npc_id:npcId,p_request_id:attempt.requestId});
      if (e !== epoch || who !== user) return; valid(data); pending = null;
      notice.textContent = ''; npcNotice.textContent = 'Votre journal a été mis à jour.';
      await Promise.allSettled([window.arvor.inventory?.refresh(who), window.arvor.refreshAfterQuest?.(who)]);
      return true;
    } catch (error) {
      if (e !== epoch) return; notice.textContent = npcNotice.textContent = errorText(error);
      // Un refus métier est définitif ; une panne de transport conserve le même UUID.
      if (String(error?.message || '').includes('ARVOR_')) pending = null;
      return false;
    } finally {
      if (e === epoch) { busy = false; confirmation = null; render(); if (npcDialog.open && npc) await loadNPC(questId,npc); else if (npcDialog.open) npcDialog.close(); }
    }
  }
  async function loadNPC(questId,npcId) {
    const e = epoch, de = ++dialogueEpoch; el('quest-npc-actions').replaceChildren();
    try {
      const [d,inventory] = await Promise.all([rpc('get_quest_dialogue',{p_quest_id:questId,p_npc_id:npcId}),rpc('get_my_inventory')]);
      if (e !== epoch || de !== dialogueEpoch || npc !== npcId || !npcDialog.open) return;
      if (!d || d.npc_id !== npcId || typeof d.name !== 'string' || typeof d.text !== 'string' || !Array.isArray(inventory)) throw Error('Réponse invalide');
      el('quest-npc-title').textContent = d.name; el('quest-npc-description').textContent = d.description; el('quest-npc-text').textContent = d.text;
      const q = list.find(x => x.id === questId); if (!q) return; const box = el('quest-npc-actions');
      box.append(button('Poursuivre le dialogue', () => act(questId,'TALK',npcId)));
      if (q.state === 'AVAILABLE' && q.giver === npcId) { box.append(button('Accepter la quête', () => ask(q,'ACCEPT',npcId,'Accepter « ' + q.title + ' » ?'), d.can_accept !== true)); if (!d.can_accept) box.append(node('p','Poursuivez le dialogue avant d’accepter cette mission.')); }
      const o = q.objectives[q.step_index];
      if (q.state === 'ACTIVE' && o?.type === 'DELIVER_ITEM' && o.npc_id === npcId) {
        const owned = inventory.filter(x => x.item_id === o.item_id).reduce((s,x) => s + Number(x.quantity),0), def = item(o.item_id);
        const row = node('div',undefined,'quest-handover'); if (def) { const img = node('img'); img.src = def.image; img.alt = def.name; row.append(img); }
        row.append(node('p',(def?.name || o.item_id) + ' — ' + owned + ' possédé(s), ' + o.quantity + ' requis.'), button('Sélectionner et remettre cet objet', () => ask(q,'DELIVER',npcId,'Remettre ' + o.quantity + ' × ' + (def?.name || o.item_id) + ' ? L’objet sera retiré de votre inventaire.'), owned < Number(o.quantity))); box.append(row);
      }
      if (q.state === 'READY_TO_TURN_IN' && q.recipient === npcId) box.append(button('Terminer la quête', () => ask(q,'COMPLETE',npcId,'Valider les objectifs et recevoir la récompense ?')));
      if (pending && !busy && pending.questId === questId) box.append(button('Réessayer la même requête', () => act(pending.questId,pending.action,pending.npcId)));
    } catch (error) { if (e === epoch && de === dialogueEpoch) npcNotice.textContent = errorText(error); }
  }
  async function openQuestNPC(q,npcId) {
    if (busy || !user || !enabled || storyActive) return;
    const e = epoch;
    busy = true; render(); notice.textContent = 'Lecture du dialogue…';
    let dialogue;
    try { dialogue = await rpc('get_quest_dialogue', {p_quest_id:q.id,p_npc_id:npcId}); }
    catch (error) { notice.textContent = errorText(error); }
    finally { if (e === epoch) { busy = false; render(); } }
    if (e !== epoch || !dialogue) return;
    const presentation = dialogue.presentation;
    // Compatibilité avec la première fiche illustrée : aucun identifiant de quête codé ici.
    const legacy = Array.isArray(presentation?.pages) && q.giver === npcId;
    const config = presentation?.npcs?.[npcId] || (legacy ? {
      title:presentation.title, pages:presentation.pages,
      states:{AVAILABLE:'greeting',ACTIVE:'accepted',READY_TO_TURN_IN:'accepted'}
    } : null);
    const character = characters[npcId];
    const state = dialogue.state;
    if (!config || !config.states?.[state] || !character) { await openNPC(q.id,npcId); return; }
    const nodes = Object.fromEntries(config.pages.map(page => [page.id, page]));
    const revision = ++storyRevision;
    journal.close(); storyActive = true;
    const current = () => e === epoch && revision === storyRevision && storyActive && user;
    const opened = await window.arvor.npcDialogue.open(character, {
      step:config.states[state], nodes, title:config.title || presentation.title || q.title,
      trigger:access, headerLabel:q.chapter || '',
      note:'Progression et récompense vérifiées côté serveur.',
      onResponse: async (action,answer) => {
        if (!current()) throw Error('Reconnectez-vous ou rouvrez le dialogue pour poursuivre.');
        if (!['TALK','ACCEPT','SYNC','DELIVER','COMPLETE','CLAIM_REWARD'].includes(action)) throw Error('Action indisponible.');
        const run = async (a,n) => {
          if (!current()) throw Error('Dialogue fermé. Rouvrez la rencontre pour poursuivre.');
          if (!await act(q.id,a,n)) throw Error(notice.textContent);
          if (!current()) throw Error('Dialogue fermé. La progression sera relue à la réouverture.');
        };
        if (pending) {
          if (pending.questId !== q.id) throw Error('Réessayez d’abord la requête incertaine dans son journal.');
          await run(pending.action,pending.npcId);
        }
        let quest = list.find(x => x.id === q.id);
        if (action === 'ACCEPT') {
          if (quest?.state === 'AVAILABLE') { await run('TALK',npcId); await run('ACCEPT',npcId); }
        } else if (action === 'COMPLETE') {
          if (quest?.state === 'ACTIVE') await run('TALK',npcId);
          quest = list.find(x => x.id === q.id);
          if (quest?.state !== 'COMPLETED') await run('COMPLETE',npcId);
        } else {
          if (action === 'DELIVER' && !window.confirm('Remettre l’objet demandé ? Il sera retiré de votre inventaire après validation serveur.')) return {next:config.states[quest?.state]};
          await run(action,['SYNC','CLAIM_REWARD'].includes(action) ? null : npcId);
        }
        quest = list.find(x => x.id === q.id);
        if (quest?.state === 'COMPLETED' && !config.states.COMPLETED) return {close:true};
        return answer?.next ? {next:answer.next} : config.states[quest?.state] ? {next:config.states[quest.state]} : {close:true};
      },
      onClose: () => { if (revision !== storyRevision) return; storyActive = false; storyRevision++; if (e === epoch && user) { journal.showModal(); void refresh(); } }
    });
    if (!opened && revision === storyRevision) { storyActive = false; storyRevision++; if (e === epoch && user) { journal.showModal(); notice.textContent = 'Dialogue indisponible : vérifiez les pages et les illustrations.'; } }
  }
  async function openNPC(id,npcId) { if (busy || !user || !enabled) return; npc = npcId; confirmation = null; el('quest-confirmation').hidden = true; npcNotice.textContent = ''; npcDialog.showModal(); await loadNPC(id,npcId); }
  access.addEventListener('click', () => { if (!user) return; opener = document.activeElement; selected = null; journal.showModal(); refresh(); });
  el('quest-close').addEventListener('click', () => journal.close());
  journal.addEventListener('close', () => { stopRefresh(); if (npcDialog.open) npcDialog.close(); opener?.focus(); });
  el('quest-npc-close').addEventListener('click', () => npcDialog.close());
  npcDialog.addEventListener('close', () => { dialogueEpoch++; npc = null; confirmation = null; el('quest-confirmation').hidden = true; });
  el('quest-confirm-no').addEventListener('click', () => { confirmation = null; el('quest-confirmation').hidden = true; });
  el('quest-confirm-yes').addEventListener('click', () => { if (!confirmation || busy) return; const c = confirmation; act(c.questId,c.action,c.npcId); });
  el('quest-refresh').addEventListener('click', () => refresh());
  window.addEventListener('focus', refreshVisible);
  document.addEventListener('visibilitychange', refreshVisible);
  for (const b of journal.querySelectorAll('[data-quest-category]')) b.addEventListener('click', () => { category = b.dataset.questCategory; selected = null; render(); });
  window.arvor ||= {};
  window.arvor.quests = Object.freeze({setUser(id) { stopRefresh(); user = id || null; epoch++; if (storyActive) { window.arvor.npcDialogue?.close(); storyActive = false; } busy = false; enabled = false; list = []; selected = null; category = 'principale'; pending = null; confirmation = null; npc = null; if (npcDialog.open) npcDialog.close(); if (journal.open) journal.close(); access.disabled = !user; render(); }});
})();
