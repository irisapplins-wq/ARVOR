/* SOCIAL 3 : chat public, RPC d'envoi/modération ; Realtime notifie, jamais de mutation directe. */
(() => {
  'use strict';
  const get = id => document.getElementById(id), client = window.arvor?.supabase;
  const dialog = get('tavern-dialog'), input = get('tavern-input'), stream = get('tavern-stream');
  let user = null, generation = 0, channel = null, retry = null, rows = [], canModerate = false;
  let sending = false, pending = null, deleting = null, moderating = false, loading = false, dirty = false;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const current = token => token === generation && Boolean(user) && dialog.open;
  const notice = text => { get('tavern-message').textContent = text; };
  const count = () => { get('tavern-count').textContent = Array.from(input.value).length + ' / 500'; };
  function controls() {
    input.disabled = sending || Boolean(pending) || !user;
    get('tavern-send').disabled = sending || !user || !client;
    get('tavern-send').textContent = sending ? 'Envoi…' : pending ? 'Réessayer le même envoi' : 'Envoyer';
    get('tavern-delete-accept').disabled = moderating;
    get('tavern-delete-cancel').disabled = moderating;
    count();
  }
  function requestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // getRandomValues reste disponible sur le LAN HTTP ; aucun hasard faible.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
  }
  const nearBottom = () => stream.scrollHeight - stream.scrollTop - stream.clientHeight < 64;
  function render(initial = false) {
    const bottom = initial || nearBottom(), oldTop = stream.scrollTop;
    const oldIds = new Set([...stream.querySelectorAll('[data-message-id]')].map(e => e.dataset.messageId));
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const article = document.createElement('article'); article.className = 'tavern-letter'; article.dataset.messageId = row.message_id;
      const header = document.createElement('header'), name = document.createElement('strong'), time = document.createElement('time');
      name.textContent = row.username; time.dateTime = row.created_at;
      time.textContent = new Date(row.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      header.append(name, time); article.append(header);
      if (row.public_title) { const title = document.createElement('small'); title.className = 'tavern-public-title'; title.textContent = row.public_title; article.append(title); }
      const body = document.createElement('p'); body.textContent = row.body; article.append(body);
      if (canModerate) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'tavern-moderate'; button.textContent = 'Supprimer';
        button.disabled = moderating;
        button.addEventListener('click', () => {
          if (moderating) return;
          deleting = row.message_id; get('tavern-delete-confirm').hidden = false;
          get('tavern-delete-cancel').focus();
        });
        article.append(button);
      }
      fragment.append(article);
    }
    const added = rows.some(r => !oldIds.has(r.message_id));
    stream.replaceChildren(fragment);
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'tavern-empty'; empty.textContent = 'La salle est calme. Ouvrez la conversation.'; stream.append(empty); }
    if (bottom) { stream.scrollTop = stream.scrollHeight; get('tavern-new').hidden = true; }
    else { stream.scrollTop = oldTop; if (added) get('tavern-new').hidden = false; }
  }
  async function refresh(token = generation, initial = false) {
    if (!current(token)) return;
    if (loading) { dirty = true; return; }
    loading = true;
    try {
      const { data, error } = await client.rpc('get_tavern_messages', { p_limit: 50 });
      if (!current(token)) return;
      if (error || !Array.isArray(data) || data.length > 50 || data.some(r => !uuid.test(r.message_id) || typeof r.username !== 'string' || typeof r.body !== 'string' ||
        !(r.public_title === null || typeof r.public_title === 'string') || !Number.isFinite(Date.parse(r.created_at)))) throw Error('history');
      rows = [...new Map(data.map(r => [r.message_id, r])).values()].sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || a.message_id.localeCompare(b.message_id));
      render(initial);
    } catch { if (current(token)) notice('La conversation n’a pas pu être actualisée. Réessayez avec « Actualiser ».'); }
    finally {
      if (current(token)) {
        loading = false;
        if (dirty) { dirty = false; void refresh(token); }
      }
    }
  }
  function unsubscribe() {
    clearTimeout(retry); retry = null;
    const previous = channel; channel = null;
    if (previous) void client.removeChannel(previous).catch(() => {});
  }
  function subscribe(token) {
    if (!current(token) || channel) return;
    const connection = client.channel('arvor-tavern-' + token);
    channel = connection;
    connection.on('postgres_changes', { event: '*', schema: 'public', table: 'tavern_messages' }, () => {
      if (current(token)) void refresh(token);
    }).subscribe(status => {
      if (!current(token) || channel !== connection) return;
      if (status === 'SUBSCRIBED') {
        clearTimeout(retry); retry = null;
        get('tavern-connection').textContent = 'Conversation en direct'; void refresh(token);
      } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
        get('tavern-connection').textContent = 'Connexion interrompue — reconnexion…';
        if (!retry) retry = setTimeout(() => {
          if (!current(token)) return;
          unsubscribe(); subscribe(token); void refresh(token);
        }, 3000);
      }
    });
  }
  function stop() {
    generation++; unsubscribe(); loading = dirty = false; rows = []; canModerate = false; deleting = null;
    stream.replaceChildren(); get('tavern-new').hidden = true; get('tavern-delete-confirm').hidden = true;
    get('tavern-connection').textContent = ''; notice('');
  }
  function setUser(id) {
    stop(); user = id; sending = moderating = false; pending = null; input.value = '';
    if (dialog.open) dialog.close(); controls();
  }
  async function open() {
    if (!user || !client || dialog.open) return;
    stop(); dialog.showModal(); const token = generation;
    get('tavern-connection').textContent = 'Connexion à la Taverne…'; controls();
    subscribe(token); void refresh(token, true);
    try {
      const { data, error } = await client.rpc('get_my_tavern_permissions');
      if (!current(token)) return;
      canModerate = !error && data === true; render();
    } catch { /* Échec fermé : aucun bouton de modération. */ }
  }
  async function send(event) {
    event.preventDefault();
    if (!user || !client || sending || !dialog.open) return;
    const body = input.value.trim();
    if (!pending && (!body || Array.from(body).length > 500)) { notice('Écrivez un message de 1 à 500 caractères.'); input.focus(); return; }
    const token = generation; sending = true; notice('');
    try {
      if (!pending) pending = { p_body: body, p_request_id: requestId() };
      controls();
      const { data, error } = await client.rpc('send_tavern_message', pending);
      if (!current(token)) return;
      if (error) {
        if (String(error.message).includes('ARVOR_TAVERN_WAIT_3_SECONDS')) { pending = null; notice('Patientez 3 secondes entre deux messages.'); }
        else if (String(error.message).includes('ARVOR_TAVERN_BODY_INVALID')) { pending = null; notice('Le message doit contenir de 1 à 500 caractères.'); }
        else if (String(error.message).includes('ARVOR_AUTH_REQUIRED')) { pending = null; notice('Reconnectez-vous pour écrire dans la Taverne.'); }
        else notice('Envoi non confirmé. Réessayez le même envoi ; son identifiant est conservé.');
        return;
      }
      if (!uuid.test(data)) throw Error('send');
      pending = null; input.value = ''; notice('Message envoyé.'); await refresh(token);
    } catch { if (current(token)) notice('Envoi non confirmé. Réessayez le même envoi sans changer son contenu.'); }
    finally { if (current(token)) { sending = false; controls(); } }
  }
  async function remove() {
    if (!deleting || moderating || !canModerate || !dialog.open) return;
    const token = generation, id = deleting; moderating = true; controls();
    try {
      const { error } = await client.rpc('delete_tavern_message', { p_message_id: id });
      if (!current(token)) return;
      if (error) throw Error('delete');
      deleting = null; get('tavern-delete-confirm').hidden = true; notice('Message supprimé.'); await refresh(token);
    } catch { if (current(token)) notice('Suppression impossible. Vos droits seront vérifiés à la prochaine ouverture.'); }
    finally { if (current(token)) { moderating = false; controls(); render(); } }
  }
  get('show-tavern').addEventListener('click', open);
  get('tavern-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!dialog.open) { stop(); sending = moderating = false; controls(); } });
  get('tavern-form').addEventListener('submit', send);
  input.addEventListener('input', count);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); get('tavern-form').requestSubmit(); }
  });
  get('tavern-delete-cancel').addEventListener('click', () => { deleting = null; get('tavern-delete-confirm').hidden = true; });
  get('tavern-delete-accept').addEventListener('click', remove);
  get('tavern-refresh').addEventListener('click', () => { notice(''); void refresh(); });
  get('tavern-new').addEventListener('click', () => { stream.scrollTop = stream.scrollHeight; get('tavern-new').hidden = true; });
  stream.addEventListener('scroll', () => { if (nearBottom()) get('tavern-new').hidden = true; });
  window.addEventListener('online', () => { if (user && dialog.open) { subscribe(generation); void refresh(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && user && dialog.open) void refresh(); });
  window.arvor = window.arvor || {};
  window.arvor.tavern = Object.freeze({ setUser });
  controls();
})();
