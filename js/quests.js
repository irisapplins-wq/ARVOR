/* Le serveur fournit les états, preuves, possessions et récompenses. Aucun événement inventé. */
(() => {
  'use strict';
  const el = id => document.getElementById(id), journal = el('quest-dialog'), npcDialog = el('quest-npc-dialog');
  if (!journal || !npcDialog) return;
  const access = el('show-quests'), notice = el('quest-notice'), npcNotice = el('quest-npc-notice');
  let user = null, epoch = 0, list = [], enabled = false, selected = null, tab = 'AVAILABLE';
  let busy = false, pending = null, confirmation = null, npc = null, opener = null, dialogueEpoch = 0;
  const labels = { LOCKED:'Verrouillée', AVAILABLE:'Disponible', ACTIVE:'En cours', READY_TO_TURN_IN:'Prête à remettre', COMPLETED:'Terminée' };
  const item = id => window.ARVORQuestItems?.items.find(x => x.id === id);
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
    selected = list.find(q => q.id === selected?.id) || null;
  }
  function rewardText(q) {
    const resources = {food:'nourriture',wood:'bois',stone:'pierre',iron:'fer'};
    const parts = Object.entries(q.rewards.resources || {}).map(([k,v]) => v + ' ' + (resources[k] || k));
    if (Number(q.rewards.coins)) parts.push(q.rewards.coins + ' pièces d’or');
    for (const [k,v] of Object.entries(q.rewards.items || {})) parts.push(v + ' × ' + (item(k)?.name || k));
    return parts.join(' · ') || 'La suite de votre aventure';
  }
  function render() {
    for (const b of journal.querySelectorAll('[data-quest-tab]')) b.setAttribute('aria-pressed', String(b.dataset.questTab === tab));
    el('quest-refresh').disabled = busy || !user;
    const target = el('quest-list'); target.replaceChildren();
    const shown = list.filter(q => tab === 'AVAILABLE' ? ['AVAILABLE','LOCKED'].includes(q.state) : tab === 'ACTIVE' ? ['ACTIVE','READY_TO_TURN_IN'].includes(q.state) : q.state === 'COMPLETED');
    if (!shown.length) target.append(node('p', enabled ? 'Aucune quête dans cette rubrique.' : 'Le journal ouvrira lorsque les récits seront disponibles.'));
    for (const q of shown) { const b = button(q.title + ' — ' + labels[q.state], () => { selected = q; renderDetails(); render(); }); b.className = 'quest-card'; b.setAttribute('aria-pressed', String(selected?.id === q.id)); target.append(b); }
    renderDetails();
  }
  function renderDetails() {
    const box = el('quest-details'); box.replaceChildren(); const q = selected;
    if (!q) { box.append(node('p', enabled ? 'Choisissez un récit pour consulter ses objectifs.' : 'Les dialogues, objectifs et récompenses seront accessibles à l’ouverture des quêtes.')); return; }
    box.append(node('p', q.type === 'principale' ? 'Quête principale' : 'Quête secondaire', 'inventory-kicker'), node('h3', q.title), node('p', q.description), node('p', labels[q.state], 'quest-state'));
    const objectives = node('ol'); for (const o of q.objectives) objectives.append(node('li', (o.done ? '✓ ' : '○ ') + o.label, o.done ? 'quest-done' : '')); box.append(objectives);
    box.append(node('h4','Récompense'), node('p',rewardText(q)));
    if (q.reward_state === 'PENDING') box.append(node('p','Récompense conservée en attente : libérez de la place dans votre stockage ou votre inventaire.'));
    const actions = node('div',undefined,'quest-actions');
    if (q.state !== 'LOCKED') {
      const ids = new Set([q.giver, q.recipient]); for (const o of q.objectives) if (o.npc_id) ids.add(o.npc_id);
      for (const id of ids) actions.append(button(id === 'tavernier' ? 'Parler au tavernier' : 'Parler à ' + (id === 'merlin_guide' ? 'Merlin' : id), () => openNPC(q.id,id)));
      if (q.state === 'ACTIVE') actions.append(button('Vérifier ma progression', () => act(q.id,'SYNC',null)));
      if (q.reward_state === 'PENDING') actions.append(button('Recevoir la récompense', () => ask(q,'CLAIM_REWARD',null,'Recevoir la récompense conservée par le serveur ?')));
    }
    box.append(actions);
    if (pending && !busy && pending.questId === q.id) box.append(button('Réessayer la même requête', () => act(pending.questId,pending.action,pending.npcId)));
  }
  async function refresh() {
    if (busy || !user) return; const e = epoch; busy = true; notice.textContent = 'Lecture du journal…'; render();
    try { const data = await rpc('get_my_quests'); if (e !== epoch) return; valid(data); notice.textContent = enabled ? 'Votre progression est vérifiée côté serveur.' : 'Les quêtes ne sont pas encore ouvertes.'; }
    catch (error) { if (e !== epoch) return; enabled = false; list = []; selected = null; notice.textContent = errorText(error); }
    finally { if (e === epoch) { busy = false; render(); } }
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
    busy = true; notice.textContent = npcNotice.textContent = 'Vérification serveur…'; el('quest-confirmation').hidden = true; render(); el('quest-npc-actions').querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const data = await rpc('quest_action',{p_quest_id:questId,p_action:action,p_npc_id:npcId,p_request_id:attempt.requestId});
      if (e !== epoch || who !== user) return; valid(data); pending = null;
      notice.textContent = npcNotice.textContent = 'Progression enregistrée par le serveur.';
      await Promise.allSettled([window.arvor.inventory?.refresh(who), window.arvor.refreshAfterQuest?.(who)]);
    } catch (error) {
      if (e !== epoch) return; notice.textContent = npcNotice.textContent = errorText(error);
      // Un refus métier est définitif ; une panne de transport conserve le même UUID.
      if (String(error?.message || '').includes('ARVOR_')) pending = null;
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
  async function openNPC(id,npcId) { if (busy || !user || !enabled) return; npc = npcId; confirmation = null; el('quest-confirmation').hidden = true; npcNotice.textContent = ''; npcDialog.showModal(); await loadNPC(id,npcId); }
  access.addEventListener('click', () => { if (!user) return; opener = document.activeElement; tab = 'AVAILABLE'; selected = null; journal.showModal(); refresh(); });
  el('quest-close').addEventListener('click', () => journal.close());
  journal.addEventListener('close', () => { if (npcDialog.open) npcDialog.close(); opener?.focus(); });
  el('quest-npc-close').addEventListener('click', () => npcDialog.close());
  npcDialog.addEventListener('close', () => { dialogueEpoch++; npc = null; confirmation = null; el('quest-confirmation').hidden = true; });
  el('quest-confirm-no').addEventListener('click', () => { confirmation = null; el('quest-confirmation').hidden = true; });
  el('quest-confirm-yes').addEventListener('click', () => { if (!confirmation || busy) return; const c = confirmation; act(c.questId,c.action,c.npcId); });
  el('quest-refresh').addEventListener('click', refresh);
  for (const b of journal.querySelectorAll('[data-quest-tab]')) b.addEventListener('click', () => { tab = b.dataset.questTab; selected = null; render(); });
  window.arvor ||= {};
  window.arvor.quests = Object.freeze({setUser(id) { user = id || null; epoch++; busy = false; enabled = false; list = []; selected = null; pending = null; confirmation = null; npc = null; if (npcDialog.open) npcDialog.close(); if (journal.open) journal.close(); access.disabled = !user; render(); }});
})();
