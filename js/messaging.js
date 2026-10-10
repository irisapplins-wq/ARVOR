/* SOCIAL 2B : état privé en mémoire, RPC uniquement, aucun contenu conservé dans le stockage. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const client = window.arvor?.supabase;
  const dialog = el('messaging-dialog');
  let user = null, generation = 0, tab = 'received', listRequest = 0, readRequest = 0, searchRequest = 0;
  let rows = [], cursor = null, recipient = null, attempt = null, sending = false, deleting = false;
  let listBusy = false, countBusy = false, timer = null, currentMessage = null;
  let attachment = null, attachmentChoices = [], attachmentChosen = null, attachmentRequest = 0;
  // Double verrou : activation locale explicite après validation ; jamais via URL/stockage.
  const ATTACHMENT_TRANSFERS_ENABLED = true;
  let serverTransfers = false, pendingRequest = 0, pendingCountRequest = 0, pendingBusy = false, claimBusy = false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const key = id => 'arvor.private-message.pending.' + id;
  const notice = text => {
    el('messaging-message').textContent = text;
    el('message-compose-status').textContent = text;
  };
  function requestUUID() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // getRandomValues reste disponible sur HTTP LAN ; UUID v4 sans hasard faible.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  const date = value => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const stamp = () => ({ user, generation });
  const valid = s => user === s.user && generation === s.generation && Boolean(user);
  function remember(requestId, mode = attempt?.mode || "ordinary") {
    // Seuls l'identifiant de tentative et celui du compte sont stockés dans la session de l'onglet.
    sessionStorage.setItem(key(user), JSON.stringify({ userId: user, requestId, ...(mode === 'attachment' ? {mode} : {}) }));
  }
  function forget() {
    sessionStorage.removeItem(key(user));
    attempt = null;
  }
  function controls() {
    const frozen = sending || Boolean(attempt?.payload);
    for (const id of ['message-recipient-query', 'message-recipient-search', 'message-subject', 'message-body'])
      el(id).disabled = frozen;
    for (const button of el('message-recipient-results').querySelectorAll('button')) button.disabled = frozen;
    el('message-send').disabled = sending || !user || !client;
    el('message-send').textContent = sending ? 'Envoi en cours…' : attempt ? 'Reprendre le même envoi' : 'Envoyer';
    el('message-attachment-add').disabled = frozen || !user;
    el('message-attachment-remove')?.toggleAttribute('disabled', frozen);
    el('message-delete').disabled = deleting;
    el('message-more').disabled = listBusy;
  }
  async function refreshCount() {
    if (!user || !client || document.hidden || countBusy) return;
    const s = stamp(); countBusy = true;
    try {
      const { data, error } = await client.rpc('get_my_unread_message_count');
      if (!valid(s)) return;
      if (error || !Number.isSafeInteger(data) || data < 0) throw Error('count');
      el('message-unread-count').textContent = String(data);
      el('message-unread-count').hidden = data === 0;
      el('show-messaging').setAttribute('aria-label', data ? 'Messagerie, ' + data + ' message(s) non lu(s)' : 'Messagerie');
    } catch {
      if (valid(s)) { el('message-unread-count').hidden = true; el('show-messaging').setAttribute('aria-label', 'Messagerie'); }
    } finally { if (valid(s)) countBusy = false; }
  }
  async function reconcileAttempt() {
    if (!attempt || !user || sending) return;
    const s = stamp(), requestId = attempt.requestId;
    try {
      const { data, error } = await client.rpc(attempt.mode === 'attachment' ? 'get_my_attachment_request' : 'get_my_private_message_send', { p_request_id: requestId });
      if (!valid(s) || attempt?.requestId !== requestId) return;
      if (error) throw Error('status');
      if (data) {
        if (!uuid.test(data.message_id)) throw Error('status');
        const transferred = attempt.mode === 'attachment'; forget(); resetAttachment(); controls(); notice('L’envoi précédent est confirmé.'); if (transferred) void refreshTransferred(s.user);
        el('message-compose-form').reset(); recipient = null; el('message-recipient-selected').textContent = '';
        if (dialog.open) await showTab('sent');
      } else {
        notice(attempt.payload ? 'Envoi non confirmé. Reprenez le même envoi avec le même identifiant.'
          : 'Un envoi précédent reste à confirmer. Ressaisissez exactement le même destinataire, sujet et contenu pour le reprendre.');
        controls();
      }
    } catch { if (valid(s)) notice('Impossible de vérifier l’envoi précédent. Sa tentative est conservée.'); }
  }
  function clearReading() {
    currentMessage = null; readRequest++;
    renderReadingAttachment(null);
    el('message-read-attachment-label').textContent = '';
    el('message-reading').hidden = true;
    el('message-reply').hidden = true;
    for (const id of ['message-read-person', 'message-read-origin', 'message-read-subject', 'message-read-date', 'message-read-body']) el(id).textContent = '';
  }
  function renderList() {
    el('message-list').replaceChildren();
    for (const row of rows) {
      const li = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.className = 'private-message-row';
      if (tab === 'received' && !row.is_read) button.classList.add('is-unread');
      const name = document.createElement('span'), subject = document.createElement('strong'), time = document.createElement('time');
      name.textContent = tab === 'received' ? row.sender_username : row.recipient_username;
      subject.textContent = row.subject; time.textContent = date(row.created_at); time.dateTime = row.created_at;
      button.append(name, subject, time);
      if (tab === 'received') {
        const origin = document.createElement('span'); origin.className = 'message-origin';
        origin.textContent = ({ PLAYER: 'Joueur', NPC: 'PNJ', SYSTEM: 'Système' })[row.sender_kind] || 'Joueur';
        button.append(origin);
      }
      if (tab === 'received' && !row.is_read) {
        const mark = document.createElement('span'); mark.className = 'private-message-unread'; mark.textContent = 'Non lu'; button.append(mark);
      }
      button.addEventListener('click', () => openMessage(row.message_id));
      li.append(button); el('message-list').append(li);
    }
    el('message-empty').hidden = rows.length !== 0;
    el('message-more').hidden = !cursor;
  }
  async function loadList(more = false) {
    if (!user || !dialog.open || tab === 'compose' || (more && listBusy)) return;
    const s = stamp(), selectedTab = tab, request = ++listRequest;
    const active = () => valid(s) && dialog.open && tab === selectedTab && listRequest === request;
    listBusy = true; controls();
    if (!more) { rows = []; cursor = null; renderList(); }
    const params = { p_limit: 20, p_before_created_at: more ? cursor?.created_at : null, p_before_id: more ? cursor?.message_id : null };
    try {
      const { data, error } = await client.rpc(selectedTab === 'received' ? 'get_my_received_messages' : 'get_my_sent_messages', params);
      if (!active()) return;
      if (error || !Array.isArray(data) || data.length > 20 || data.some(r => !uuid.test(r.message_id) ||
          typeof r.subject !== 'string' || typeof (selectedTab === 'received' ? r.sender_username : r.recipient_username) !== 'string' ||
          !Number.isFinite(Date.parse(r.created_at)))) throw Error('list');
      const ids = new Set(rows.map(r => r.message_id));
      rows.push(...data.filter(r => !ids.has(r.message_id)));
      cursor = data.length === 20 ? data[data.length - 1] : null;
      renderList();
    } catch { if (active()) notice('Impossible de charger les messages. Réessayez en ouvrant cet onglet.'); }
    finally { if (active()) { listBusy = false; controls(); } }
  }
  async function showTab(next) {
    tab = next; listRequest++; listBusy = false; clearReading();
    for (const b of el('message-tabs').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.messageTab === tab));
    el('message-compose').hidden = tab !== 'compose';
    el('message-mailbox').hidden = tab === 'compose';
    if (tab !== 'compose') await loadList();
    controls(); preserveMailboxBounds();
  }
  async function openMessage(messageId) {
    const s = stamp(), request = ++readRequest;
    const active = () => valid(s) && dialog.open && readRequest === request;
    el('message-read-body').textContent = '';
    try {
      const { data, error } = await client.rpc('read_private_message', { p_message_id: messageId });
      if (!active()) return;
      if (error || !data || data.message_id !== messageId || typeof data.body !== 'string' ||
          typeof data.subject !== 'string' || typeof data.username !== 'string' ||
          !['received', 'sent'].includes(data.direction)) throw Error('read');
      currentMessage = data;
      el('message-reply').hidden = data.direction !== 'received' || data.sender_kind !== 'PLAYER' || !uuid.test(data.player_id) || data.player_id === user;
      el('message-read-person').textContent = (data.direction === 'received' ? 'De : ' : 'À : ') + data.username;
      el('message-read-subject').textContent = data.subject;
      el('message-read-origin').textContent = ({ PLAYER: 'Joueur', NPC: 'PNJ', SYSTEM: 'Système' })[data.sender_kind] || 'Joueur';
      el('message-read-date').textContent = date(data.created_at);
      el('message-read-body').textContent = data.body;
      el('message-reading').hidden = false;
      el('message-reading').focus();
      const row = rows.find(r => r.message_id === messageId);
      if (row && data.direction === 'received') { row.is_read = true; renderList(); }
      void refreshCount(); void loadReadingAttachment(messageId, active);
    } catch { if (active()) { clearReading(); notice('Ce message est indisponible ou a été supprimé.'); } }
  }
  async function searchRecipient(event) {
    event.preventDefault();
    if (!user || sending || attempt?.payload) return;
    const s = stamp(), request = ++searchRequest, query = el('message-recipient-query').value.trim();
    el('message-recipient-results').replaceChildren(); recipient = null; el('message-recipient-selected').textContent = ''; controls();
    if (!query) return;
    el('message-recipient-search').disabled = true;
    try {
      const { data, error } = await client.rpc(uuid.test(query) ? 'get_player_profile' : 'search_players',
        uuid.test(query) ? { p_player_id: query } : { p_query: query });
      if (!valid(s) || !dialog.open || request !== searchRequest) return;
      if (error || !Array.isArray(data) || data.length > 10 || data.some(p => !uuid.test(p.player_id) || typeof p.username !== 'string')) throw Error('search');
      for (const player of data.filter(p => p.player_id !== user)) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = player.username;
        button.addEventListener('click', () => {
          if (sending || attempt?.payload) return;
          recipient = player; el('message-recipient-selected').textContent = 'À : ' + player.username;
          el('message-recipient-results').replaceChildren(); controls();
        });
        el('message-recipient-results').append(button);
      }
      notice(el('message-recipient-results').children.length ? '' : 'Aucun autre joueur trouvé.');
    } catch { if (valid(s) && request === searchRequest) notice('Recherche indisponible ou trop fréquente. Réessayez dans une minute.'); }
    finally { if (valid(s) && request === searchRequest) controls(); }
  }
  const errors = {
    ARVOR_MESSAGE_SELF_REFUSED: 'Vous ne pouvez pas vous envoyer de message.',
    ARVOR_MESSAGE_RECIPIENT_MISSING: 'Ce destinataire est introuvable.',
    ARVOR_MESSAGE_SUBJECT_INVALID: 'Le sujet doit contenir de 1 à 120 caractères.',
    ARVOR_MESSAGE_BODY_INVALID: 'Le message doit contenir de 1 à 5000 caractères.',
    ARVOR_MESSAGE_WAIT_10_SECONDS: 'Patientez 10 secondes entre deux messages.',
    ARVOR_MESSAGE_LIMIT_HOUR: 'Limite de 20 messages par heure atteinte.',
    ARVOR_MESSAGE_LIMIT_DAY: 'Limite de 100 messages sur 24 heures atteinte.',
    ARVOR_MESSAGE_LIMIT_RECIPIENT: 'Limite de 5 messages par heure vers ce joueur atteinte.',
    ARVOR_MESSAGE_REQUEST_MISMATCH: 'Cette tentative correspond déjà à un autre message. Aucun nouvel envoi effectué.',
    ARVOR_MESSAGE_REQUEST_REQUIRED: 'Identifiant d’envoi indisponible.',
    ARVOR_MESSAGE_SENDER_MISSING: 'Votre profil est indisponible.',
    ARVOR_AUTH_REQUIRED: 'Reconnectez-vous pour envoyer un message.',
    ARVOR_MAIL_TRANSFERS_DISABLED: 'Les transferts sont désactivés.',
    ARVOR_MAIL_STOCK_INSUFFICIENT: 'Stock insuffisant. Aucun bien envoyé.',
    ARVOR_MAIL_CAPACITY_INSUFFICIENT: 'Stockage insuffisant. Le bien reste en attente ; libérez de la place puis réessayez.',
    ARVOR_MAIL_REQUEST_CONFLICT: 'Identifiant déjà utilisé pour une autre opération. Aucun transfert effectué.',
    ARVOR_MAIL_ATTACHMENT_UNAVAILABLE: 'Cette pièce jointe ne vous est pas accessible.',
    ARVOR_MAIL_DOMAIN_REQUIRED: 'Domaine indisponible pour ce transfert.',
    ARVOR_MAIL_GOOD_INVALID: 'Ce bien ne peut pas être transféré.',
    ARVOR_MAIL_QUANTITY_INVALID: 'Quantité invalide.',
    ARVOR_MAIL_PAYLOAD_INVALID: 'Sélection invalide.',
    ARVOR_MAIL_ITEM_FORBIDDEN: 'Cet objet ne peut pas être transféré.'
  };
  async function send(event) {
    event.preventDefault();
    if (sending) return;
    if ((attachment || attempt?.mode === 'attachment') && !(ATTACHMENT_TRANSFERS_ENABLED && serverTransfers)) { notice('Pièce jointe non envoyée : les transferts sont désactivés. Retirez la sélection pour envoyer un courrier ordinaire.'); return; }
    if (!user || !client) { notice('Reconnectez-vous pour envoyer un message.'); return; }
    if (!attempt?.payload && !recipient) {
      notice('Recherchez le destinataire puis cliquez sur son pseudo dans les résultats.');
      el('message-recipient-query').focus(); return;
    }
    if (!attempt?.payload) {
      const subject = el('message-subject'), body = el('message-body');
      if (!subject.value.trim() || !subject.checkValidity()) {
        notice('Le sujet doit contenir de 1 à 120 caractères.'); subject.focus(); return;
      }
      if (!body.value.trim() || !body.checkValidity()) {
        notice('Le message doit contenir de 1 à 5000 caractères.'); body.focus(); return;
      }
    }
    const mode = attachment ? 'attachment' : 'ordinary';
    if (attempt && attempt.mode && attempt.mode !== mode && !attempt.payload) { notice('Reconstituez exactement la pièce jointe de la tentative précédente. Aucun nouvel envoi effectué.'); return; }
    const s = stamp(); sending = true;
    try {
      if (!attempt) attempt = { requestId: requestUUID(), mode };
      if (!attempt.payload) attempt.payload = { p_recipient_id: recipient.player_id, p_subject: el('message-subject').value, p_body: el('message-body').value };
      if (mode === 'attachment' && !attempt.payload.p_attachment) attempt.payload.p_attachment = { kind: attachment.category === 'potion' ? 'item' : attachment.category, key: attachment.id, quantity: attachment.quantity };
      remember(attempt.requestId); // Sauvegarde avant le réseau ; jamais sujet/contenu/destinataire.
    } catch { sending = false; attempt = null; controls(); notice('Impossible de préparer une tentative sûre dans ce navigateur. Aucun message envoyé.'); return; }
    controls();
    try {
      const { data, error } = await client.rpc(attempt.mode === 'attachment' ? 'send_private_message_with_attachment' : 'send_private_message', { ...attempt.payload, p_request_id: attempt.requestId });
      if (!valid(s)) return;
      if (error) {
        const code = Object.keys(errors).find(k => String(error.message).includes(k));
        if (code) { forget(); notice(errors[code]); }
        else notice('Envoi incertain. Reprenez le même envoi ; aucun nouveau message ne sera créé en double.');
        return;
      }
      if (!data || !uuid.test(data.message_id)) throw Error('response');
      const transferred = attempt.mode === 'attachment';
      if (transferred && (!uuid.test(data.attachment_id) || data.status !== 'PENDING')) throw Error('response');
      forget(); resetAttachment(); if (transferred) void refreshTransferred(s.user); el('message-compose-form').reset(); recipient = null; el('message-recipient-selected').textContent = '';
      el('message-recipient-results').replaceChildren(); notice('Message envoyé.');
      await showTab('sent'); void refreshCount();
    } catch { if (valid(s)) notice('Envoi incertain. La même tentative est conservée pour une reprise sûre.'); }
    finally { if (valid(s)) { sending = false; controls(); } }
  }
  async function deleteMessage() {
    if (!user || !currentMessage || deleting) return;
    const s = stamp(), messageId = currentMessage.message_id; deleting = true; controls();
    try {
      const { error } = await client.rpc('delete_private_message', { p_message_id: messageId });
      if (!valid(s) || !dialog.open) return;
      if (error) throw Error('delete');
      clearReading(); rows = rows.filter(r => r.message_id !== messageId); renderList();
      notice('Message supprimé de votre messagerie.'); void refreshCount(); void refreshPending();
    } catch { if (valid(s)) notice('Suppression impossible pour le moment. Réessayez.'); }
    finally { if (valid(s)) { deleting = false; controls(); } }
  }
  function setUser(id) {
    generation++; listRequest++; readRequest++; searchRequest++;
    resetAttachment(); serverTransfers = false; pendingRequest++; pendingCountRequest++; pendingBusy = false; claimBusy = false; el('message-pending-access').hidden = true; if (pendingDialog.open) pendingDialog.close();
    clearInterval(timer); timer = null; user = id;
    rows = []; cursor = null; recipient = null; attempt = null; currentMessage = null;
    sending = deleting = listBusy = countBusy = false;
    if (dialog.open) dialog.close();
    el('message-compose-form').reset(); el('message-recipient-form').reset();
    el('message-recipient-results').replaceChildren(); el('message-recipient-selected').textContent = '';
    el('message-list').replaceChildren(); clearReading(); notice('');
    el('message-unread-count').hidden = true; el('message-unread-count').textContent = '';
    el('show-messaging').setAttribute('aria-label', 'Messagerie');
    if (!user || !client) { controls(); return; }
    try {
      const stored = JSON.parse(sessionStorage.getItem(key(user)) || 'null');
      if (stored?.userId === user && uuid.test(stored.requestId)) attempt = { requestId: stored.requestId, mode: stored.mode === 'attachment' ? 'attachment' : 'ordinary' };
    } catch { notice('La tentative précédente ne peut pas être relue.'); }
    controls(); void refreshCount();
    timer = setInterval(() => { if (!document.hidden) void refreshCount(); }, 60000);
  }
  // Phase 13.2 : le sélecteur validé, sans transfert tant que les deux verrous sont fermés.
  const attachmentPicker = document.createElement('dialog');
  attachmentPicker.id = 'message-attachment-picker';
  attachmentPicker.className = 'confirmation-dialog message-attachment-picker';
  attachmentPicker.setAttribute('aria-labelledby', 'message-attachment-title');
  attachmentPicker.innerHTML = '<h3 id="message-attachment-title">Ajouter un objet</h3><p id="message-attachment-gate">Les transferts sont désactivés. La sélection ne débite aucun bien et ne peut pas être envoyée.</p><label for="message-attachment-category">Catégorie</label><select id="message-attachment-category"><option value="resource">Ressources</option><option value="coins">Pièces d’or</option><option value="potion">Potions</option><option value="item">Objets autorisés</option></select><ul id="message-attachment-grid" class="inventory-grid"></ul><p id="message-attachment-selection">Sélectionnez un bien.</p><label for="message-attachment-quantity">Quantité</label><input id="message-attachment-quantity" inputmode="numeric" value="1"><p id="message-attachment-error" role="status"></p><div class="message-attachment-actions"><button id="message-attachment-cancel" type="button">Annuler</button><button id="message-attachment-validate" type="button">Valider la sélection</button></div>';
  document.body.append(attachmentPicker);
  function preserveMailboxBounds() {
    if (!dialog.open) return;
    const tools = el('message-attachment-tools'), visible = !tools.hidden;
    tools.hidden = true; dialog.style.height = '';
    dialog.style.height = dialog.getBoundingClientRect().height + 'px';
    tools.hidden = !visible;
  }
  function renderAttachment() {
    const line = el('message-attachment-line'); line.replaceChildren(); line.hidden = !attachment;
    el('message-attachment-add').textContent = attachment ? '📎 Modifier la sélection' : '📎 Ajouter un objet';
    if (!attachment) return;
    const label = document.createElement('span'); label.textContent = '📎 ' + attachment.quantity + ' ' + attachment.name + ' · Non envoyée';
    const remove = document.createElement('button'); remove.id = 'message-attachment-remove'; remove.type = 'button'; remove.textContent = '✕'; remove.setAttribute('aria-label', 'Retirer la pièce jointe');
    remove.addEventListener('click', () => { if (sending || attempt?.payload) return; attachment = null; renderAttachment(); notice('Sélection retirée. Aucun bien débité.'); });
    line.append(label, remove);
  }
  function resetAttachment() {
    attachmentRequest++; attachment = null; attachmentChoices = []; attachmentChosen = null;
    if (attachmentPicker.open) attachmentPicker.close();
    renderAttachment();
  }
  function renderAttachmentChoices() {
    attachmentChosen = null; el('message-attachment-grid').replaceChildren();
    el('message-attachment-error').textContent = ''; el('message-attachment-selection').textContent = 'Sélectionnez un bien.';
    const choices = attachmentChoices.filter(item => item.category === el('message-attachment-category').value);
    for (const item of choices) {
      const slot = document.createElement('li'); slot.className = 'inventory-slot';
      const button = document.createElement('button'); button.type = 'button'; button.dataset.attachmentItem = item.id;
      button.setAttribute('aria-label', item.name + ' — ' + item.quantity + ' disponibles');
      const image = document.createElement('img'); image.src = item.iconPath; image.alt = item.name;
      const quantity = document.createElement('span'); quantity.className = 'inventory-item-quantity'; quantity.textContent = item.quantity;
      const name = document.createElement('span'); name.className = 'message-attachment-name'; name.textContent = item.name;
      button.append(image, quantity, name); slot.append(button); el('message-attachment-grid').append(slot);
      button.addEventListener('click', () => { attachmentChosen = item; el('message-attachment-selection').textContent = item.name + ' · ' + item.quantity + ' disponibles'; el('message-attachment-quantity').value = attachment?.id === item.id ? attachment.quantity : '1'; });
    }
    if (!choices.length) el('message-attachment-selection').textContent = 'Aucun bien disponible dans cette catégorie. Les objets de quête et objets non autorisés sont exclus.';
  }
  el('message-attachment-add').addEventListener('click', async () => {
    if (!user || sending || attempt?.payload || attachmentPicker.open) return;
    const s = stamp(), request = ++attachmentRequest;
    attachmentChoices = []; el('message-attachment-category').value = attachment?.category || 'resource'; renderAttachmentChoices();
    attachmentPicker.showModal(); el('message-attachment-validate').disabled = true;
    el('message-attachment-selection').textContent = 'Chargement des disponibilités…';
    try {
      const items = await window.arvor?.inventory?.readAttachmentItems(s.user) || [];
      if (!valid(s) || request !== attachmentRequest || !attachmentPicker.open || !dialog.open) return;
      const resources = window.arvor?.getAttachmentResources?.(s.user) || {};
      for (const [id, name] of [['food','nourriture'],['wood','bois'],['stone','pierre'],['iron','fer'],['coins','pièces d’or']]) {
        const value = resources[id]; const quantity = typeof value === 'number' && Number.isSafeInteger(Math.floor(value)) ? String(Math.floor(value)) : typeof value === 'string' && /^[0-9]+$/.test(value) ? value : '0';
        if (BigInt(quantity) > 0n) attachmentChoices.push({ id, name, quantity, category: id === 'coins' ? 'coins' : 'resource', iconPath: 'assets/market/' + id + '.svg' });
      }
      attachmentChoices.push(...items.filter(item => item.category === 'potion' && /^[0-9]+$/.test(item.quantity) && BigInt(item.quantity) > 0n));
      const available = await readTransferableGoods();
      if (!valid(s) || request !== attachmentRequest || !attachmentPicker.open) return;
      if (available && ATTACHMENT_TRANSFERS_ENABLED) attachmentChoices = available;
      el('message-attachment-gate').textContent = ATTACHMENT_TRANSFERS_ENABLED && serverTransfers ? 'Le bien sera débité à l’envoi et conservé jusqu’à sa récupération.' : 'Les transferts sont désactivés. La sélection ne débite aucun bien et ne peut pas être envoyée.';
      renderAttachmentChoices();
      if (attachment) el('message-attachment-grid').querySelector('[data-attachment-item="' + attachment.id + '"]')?.click();
    } catch { if (valid(s) && request === attachmentRequest) el('message-attachment-selection').textContent = 'Disponibilités indisponibles. Fermez puis réessayez.'; }
    finally { if (valid(s) && request === attachmentRequest) el('message-attachment-validate').disabled = false; }
  });
  el('message-attachment-quantity').addEventListener('input', () => { el('message-attachment-error').textContent = ''; });
  el('message-attachment-category').addEventListener('change', renderAttachmentChoices);
  el('message-attachment-cancel').addEventListener('click', () => attachmentPicker.close());
  attachmentPicker.addEventListener('close', () => { if (!attachmentPicker.open) attachmentRequest++; });
  el('message-attachment-validate').addEventListener('click', () => {
    if (!user || sending || attempt?.payload || !attachmentChosen) return;
    const raw = el('message-attachment-quantity').value.trim();
    if (!/^[0-9]{1,19}$/.test(raw) || BigInt(raw) < 1n || BigInt(raw) > BigInt(attachmentChosen.quantity)) { el('message-attachment-error').textContent = 'Quantité invalide ou stock insuffisant.'; return; }
    attachment = { ...attachmentChosen, quantity: BigInt(raw).toString() }; renderAttachment(); attachmentPicker.close();
    notice(ATTACHMENT_TRANSFERS_ENABLED && serverTransfers ? 'Pièce jointe sélectionnée. Aucun bien débité avant confirmation serveur.' : 'Sélection locale uniquement. Retirez-la pour envoyer un courrier : les transferts sont désactivés.');
  });
  window.addEventListener('resize', preserveMailboxBounds);
  el('show-messaging').addEventListener('click', async () => {
    if (!user || !client) return;
    if (!dialog.open) dialog.showModal();
    notice(''); await showTab('received'); void refreshCount(); void reconcileAttempt(); void refreshPending(); void readTransferableGoods();
  });
  el('messaging-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // Une ancienne fermeture ne doit pas effacer une réouverture immédiate.
    listRequest++; readRequest++; searchRequest++; listBusy = false;
    attachmentRequest++; if (attachmentPicker.open) attachmentPicker.close();
    rows = []; cursor = null; el('message-list').replaceChildren(); clearReading();
    el('message-recipient-results').replaceChildren(); controls();
  });
  for (const b of el('message-tabs').querySelectorAll('button')) b.addEventListener('click', () => { notice(''); void showTab(b.dataset.messageTab); });
  el('message-more').addEventListener('click', () => loadList(true));
  el('message-read-back').addEventListener('click', clearReading);
  el('message-delete').addEventListener('click', deleteMessage);
  el('message-reply').addEventListener('click', () => {
    if (sending || attempt || !currentMessage || currentMessage.direction !== 'received' ||
        currentMessage.sender_kind !== 'PLAYER' || !uuid.test(currentMessage.player_id) || currentMessage.player_id === user) return;
    const message = currentMessage;
    recipient = { player_id: message.player_id, username: message.username };
    el('message-compose-form').reset(); resetAttachment();
    el('message-recipient-selected').textContent = 'À : ' + message.username;
    el('message-subject').value = (message.subject.startsWith('Re : ') ? message.subject : 'Re : ' + message.subject).slice(0, 120);
    notice(''); void showTab('compose'); el('message-body').focus();
  });
  el('message-recipient-form').addEventListener('submit', searchRecipient);
  el('message-recipient-query').addEventListener('input', () => {
    searchRequest++; recipient = null; el('message-recipient-selected').textContent = ''; el('message-recipient-results').replaceChildren(); controls();
  });
  // Validation explicite : chaque blocage est expliqué dans la zone de statut.
  el('message-compose-form').noValidate = true;
  el('message-compose-form').addEventListener('submit', send);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refreshCount(); if (dialog.open) void reconcileAttempt(); } });
  // Phase 13.2 : seules les lectures propres et les deux mutations dédiées sont utilisées.
  const pendingAccess = document.createElement('button');
  pendingAccess.id = 'message-pending-access'; pendingAccess.type = 'button'; pendingAccess.hidden = true;
  el('message-tabs').after(pendingAccess);
  const pendingDialog = document.createElement('dialog');
  pendingDialog.id = 'message-pending-dialog'; pendingDialog.className = 'confirmation-dialog message-attachment-picker';
  pendingDialog.setAttribute('aria-labelledby', 'message-pending-title');
  pendingDialog.innerHTML = '<h3 id="message-pending-title">Biens à récupérer</h3><p>Ces biens restent en réserve, même après suppression du courrier.</p><ul id="message-pending-list"></ul><p id="message-pending-status" role="status" aria-live="polite"></p><button id="message-pending-more" type="button" hidden>Afficher la suite</button><button id="message-pending-close" type="button">Fermer</button>';
  document.body.append(pendingDialog);
  let pendingCursor = null, readingAttachment = null;
  const readingIcon = document.createElement('img');
  readingIcon.width = readingIcon.height = 48; readingIcon.alt = ''; readingIcon.hidden = true;
  const missingRPC = error => error?.code === 'PGRST202' || error?.code === '42883';
  // jsonb scalaire ou ligne RPC enveloppée : même validation, aucune donnée inventée.
  function attachmentRPCValue(data, name) {
    if (Array.isArray(data)) {
      if (!data.length) return null;
      if (data.length !== 1) throw Error('attachment-shape');
      data = data[0];
    }
    if (data && typeof data === 'object' && Object.keys(data).length === 1 &&
        Object.prototype.hasOwnProperty.call(data, name)) return data[name];
    return data;
  }
  const goodMetadata = a => a && uuid.test(a.attachment_id) && uuid.test(a.message_id) &&
    ['resource','coins','item'].includes(a.kind) && ['PENDING','CLAIMED'].includes(a.status) &&
    typeof a.quantity === 'string' && /^[1-9][0-9]{0,18}$/.test(a.quantity) && typeof a.name === 'string' &&
    typeof a.icon_path === 'string' && /^assets\/(items\/[a-z0-9_/-]+\.png|market\/[a-z]+\.svg)$/.test(a.icon_path);
  const transferError = error => errors[Object.keys(errors).find(k => String(error?.message).includes(k))];
  async function refreshTransferred(playerId) {
    // Aucun delta client. Les quantités et capacités sont relues par les mécanismes existants.
    const s = stamp();
    try { await Promise.all([window.arvor?.inventory?.refresh?.(playerId), window.arvor?.refreshAfterMailTransfer?.(playerId)]); }
    catch { if (valid(s)) notice('Transfert confirmé. Actualisation indisponible ; rouvrez l’inventaire pour relire les stocks.'); }
    if (valid(s)) { void refreshPending(); void readTransferableGoods(); }
  }
  async function readTransferableGoods() {
    if (!user || !client) return null;
    const s = stamp();
    try {
      const {data,error} = await client.rpc('get_my_transferable_goods');
      if (!valid(s)) return null;
      if (error || !Array.isArray(data)) { serverTransfers = false; return null; }
      serverTransfers = data.length > 0 && data.every(r => r.transfers_enabled === true);
      const names = {food:'nourriture',wood:'bois',stone:'pierre',iron:'fer',coins:'pièces d’or'};
      return data.filter(r => typeof r.quantity === 'string' && /^[1-9][0-9]{0,18}$/.test(r.quantity) &&
        (['resource','coins'].includes(r.kind) && names[r.key] || r.kind === 'item' && /^assets\/items\/[a-z0-9_/-]+\.png$/.test(r.icon_path)))
        .map(r => ({id:r.key,name:r.name || names[r.key],quantity:r.quantity,category:r.kind === 'item' ? (r.category === 'potion' ? 'potion' : 'item') : r.kind,iconPath:r.icon_path || 'assets/market/'+r.key+'.svg'}));
    } catch { if (valid(s)) serverTransfers = false; return null; }
  }
  async function refreshPending() {
    if (!user || !client) return;
    const s = stamp(), request = ++pendingCountRequest;
    try {
      const {data,error} = await client.rpc('get_my_pending_attachment_count');
      if (!valid(s) || request !== pendingCountRequest) return;
      if (error) { if (missingRPC(error)) { pendingAccess.hidden = true; return; } throw Error('pending'); }
      const count = attachmentRPCValue(data, 'get_my_pending_attachment_count');
      if (!/^[0-9]+$/.test(String(count))) throw Error('pending');
      pendingAccess.textContent = '📦 Biens à récupérer ('+count+')'; pendingAccess.hidden = BigInt(count) === 0n;
    } catch { if (valid(s) && request === pendingCountRequest) {
      // Une panne du compteur ne doit pas condamner l'accès à une réserve existante.
      pendingAccess.textContent = '📦 Biens à récupérer — vérifier'; pendingAccess.hidden = false;
    } }
  }
  function renderReadingAttachment(a) {
    readingAttachment = a;
    el('message-read-attachment').hidden = !a; readingIcon.hidden = !a;
    if (a) { readingIcon.src = a.icon_path; el('message-read-attachment-label').before(readingIcon); }
    else { readingIcon.remove(); readingIcon.removeAttribute('src'); }
    const b = el('message-attachment-claim'); b.disabled = true;
    if (!a) return;
    el('message-read-attachment-label').textContent = a.quantity+' '+a.name+' · '+(a.status === 'CLAIMED' ? 'Récupéré' : 'En attente');
    b.textContent = a.status === 'CLAIMED' ? 'Récupéré' : ATTACHMENT_TRANSFERS_ENABLED && a.can_claim ? 'Récupérer' : 'Récupérer — indisponible';
    b.disabled = claimBusy || !ATTACHMENT_TRANSFERS_ENABLED || a.can_claim !== true || a.status !== 'PENDING';
  }
  async function loadReadingAttachment(messageId, active) {
    renderReadingAttachment(null);
    try {
      const {data,error} = await client.rpc('get_my_message_attachment', {p_message_id:messageId});
      if (!active()) return;
      if (error) {
        notice(missingRPC(error) ? 'Lecture des pièces jointes indisponible sur le serveur. Les biens restent en réserve.'
          : 'La pièce jointe ne peut pas être chargée. Rouvrez ce courrier avant toute récupération.');
        return;
      }
      const a = attachmentRPCValue(data, 'get_my_message_attachment');
      if (a == null) return; // Ancien courrier sans pièce jointe.
      if (!goodMetadata(a) || a.message_id !== messageId) throw Error('attachment-metadata');
      renderReadingAttachment(a);
    } catch { if (active()) notice('Lecture de la pièce jointe indisponible. Aucun transfert effectué.'); }
  }
  async function loadPending(more = false) {
    if (!user || !pendingDialog.open || claimBusy || (more && pendingBusy)) return;
    pendingBusy = true;
    const s = stamp(), request = ++pendingRequest;
    const active = () => valid(s) && pendingDialog.open && request === pendingRequest;
    if (!more) { pendingCursor = null; el('message-pending-list').replaceChildren(); }
    el('message-pending-more').disabled = true;
    try {
      const {data,error} = await client.rpc('get_my_pending_attachments', {p_limit:20,p_before_created_at:more ? pendingCursor?.created_at : null,p_before_id:more ? pendingCursor?.attachment_id : null});
      if (!active()) return;
      if (error || !Array.isArray(data) || data.length > 20) throw Error('pending');
      const attachments = data.map(a => attachmentRPCValue(a, 'get_my_pending_attachments'));
      if (attachments.some(a=>!goodMetadata(a))) throw Error('pending');
      for (const a of attachments) {
        const li = document.createElement('li'), b = document.createElement('button'), img = document.createElement('img'), label = document.createElement('span');
        li.className = 'message-attachment-reader'; img.src = a.icon_path; img.alt = ''; img.width = img.height = 48;
        label.textContent = a.quantity+' '+a.name+' · En attente'; b.type = 'button'; b.textContent = 'Récupérer';
        b.disabled = !ATTACHMENT_TRANSFERS_ENABLED || a.can_claim !== true; b.dataset.claimAttachment = a.attachment_id;
        b.addEventListener('click',()=>claimAttachment(a,b));li.append(img,label,b);el('message-pending-list').append(li);
      }
      pendingCursor = attachments.length === 20 ? attachments[attachments.length-1] : null;
      el('message-pending-more').hidden = !pendingCursor;
      el('message-pending-status').textContent = el('message-pending-list').children.length ? '' : 'Aucun bien en attente.';
    } catch { if (active()) el('message-pending-status').textContent = 'Lecture indisponible. Les biens restent conservés sur le serveur.'; }
    finally { if (active()) { pendingBusy = false; el('message-pending-more').disabled = false; } }
  }
  async function claimAttachment(a, button) {
    if (!user || claimBusy || !ATTACHMENT_TRANSFERS_ENABLED || a.can_claim !== true || a.status !== 'PENDING') return;
    const s = stamp(), storageKey = 'arvor.mail.claim.'+user+'.'+a.attachment_id;
    let requestId;
    try { requestId = sessionStorage.getItem(storageKey) || requestUUID(); if (!uuid.test(requestId)) throw Error('id'); sessionStorage.setItem(storageKey,requestId); }
    catch { notice('Impossible de préparer une récupération sûre. Aucun transfert effectué.'); return; }
    claimBusy = true; button.disabled = true; button.textContent = 'Récupération…';
    for (const b of pendingDialog.querySelectorAll('[data-claim-attachment]')) b.disabled = true;
    try {
      const {data,error} = await client.rpc('claim_private_message_attachment',{p_attachment_id:a.attachment_id,p_request_id:requestId});
      if (!valid(s)) return;
      if (error) {
        const text = transferError(error);
        if (text) sessionStorage.removeItem(storageKey);
        throw Error(text || 'Réponse incertaine. Réessayez : le même identifiant sera conservé.');
      }
      if (!data || data.attachment_id !== a.attachment_id || data.status !== 'CLAIMED') throw Error('Réponse incertaine. Reprenez la récupération avec le même identifiant.');
      sessionStorage.removeItem(storageKey); a = {...a,status:'CLAIMED',can_claim:false};
      if (readingAttachment?.attachment_id === a.attachment_id) renderReadingAttachment(a);
      notice('Bien récupéré.'); el('message-pending-status').textContent = 'Bien récupéré.';
      await refreshTransferred(s.user);
    } catch (error) { if (valid(s)) { const text = transferError(error) || (error.message === 'Failed to fetch' ? 'Connexion interrompue. La tentative est conservée pour une reprise sûre.' : error.message);notice(text);el('message-pending-status').textContent=text; } }
    finally { if (valid(s)) { claimBusy = false; renderReadingAttachment(readingAttachment);button.textContent=a.status==='CLAIMED'?'Récupéré':'Récupérer';button.disabled=a.status==='CLAIMED'||!a.can_claim; if (pendingDialog.open) void loadPending(); } }
  }
  pendingDialog.addEventListener('close',()=>{if(!pendingDialog.open){pendingRequest++;pendingBusy=false;}});
  pendingAccess.addEventListener('click',()=>{if(!user)return;if(!pendingDialog.open)pendingDialog.showModal();void loadPending();});
  el('message-pending-close').addEventListener('click',()=>pendingDialog.close());
  el('message-pending-more').addEventListener('click',()=>loadPending(true));
  el('message-attachment-claim').addEventListener('click',()=>{if(readingAttachment)void claimAttachment(readingAttachment,el('message-attachment-claim'));});
  dialog.addEventListener('close',()=>{if(!dialog.open&&pendingDialog.open)pendingDialog.close();});
  window.arvor = window.arvor || {};
  window.arvor.messaging = Object.freeze({ setUser });
})();
