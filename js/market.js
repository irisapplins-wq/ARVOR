/* Marché mondial : seuls les résultats serveur représentent les échanges réels. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const dialog = el('market-dialog'), confirmDialog = el('market-confirm-dialog');
  const client = window.arvor?.supabase;
  if (!dialog || !client) return;
  const names = Object.freeze({ food: 'Vivres', wood: 'Bois', stone: 'Pierre', iron: 'Fer' });
  const maximum = 9223372036854775807n;
  let player = null, generation = 0, busy = false, pending = null, offset = 0, readVersion = 0;
  let own = null, board = [], confirmation = null;
  const key = () => 'arvor:market-request:v1:' + player;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  function requestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // HTTP LAN : getRandomValues reste disponible sans contexte HTTPS.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
  }
  function number(value) {
    if (!/^\d+$/.test(String(value))) throw new Error('Saisissez un entier positif.');
    const n = BigInt(value);
    if (n < 1n || n > maximum) throw new Error('La quantité et le prix doivent être des entiers positifs valides.');
    return n;
  }
  const format = value => BigInt(value).toLocaleString('fr-FR');
  const message = text => { el('market-message').textContent = text; };
  function remember(value) {
    // Seul le reçu technique est mémorisé ; aucune possession ni aucun solde local.
    if (value) localStorage.setItem(key(), JSON.stringify(value));
    else localStorage.removeItem(key());
    pending = value;
  }
  function controls() {
    el('show-market').disabled = !player;
    dialog.querySelectorAll('[data-market-mutation], #market-publish').forEach(node => { node.disabled = busy || Boolean(pending); });
    el('market-retry').hidden = !pending;
    el('market-retry').disabled = busy;
    el('market-confirm-accept').disabled = busy;
  }
  function node(tag, text, className) {
    const n = document.createElement(tag); if (text !== undefined) n.textContent = text;
    if (className) n.className = className; return n;
  }
  function action(text, fn) {
    const button = node('button', text); button.type = 'button'; button.dataset.marketMutation = '';
    button.addEventListener('click', fn); return button;
  }
  function confirm(text, operation) {
    if (!player || busy || pending) return;
    confirmation = operation; el('market-confirm-text').textContent = text; confirmDialog.showModal();
  }
  function errorText(error) {
    const code = String(error?.message || '');
    const labels = { LISTING_LIMIT: 'Vous possédez déjà dix offres actives.', COINS_INSUFFICIENT: 'Vous ne disposez pas de suffisamment de pièces.',
      RESOURCES_INSUFFICIENT: 'Vous ne disposez pas de suffisamment de ressources.', STORAGE_INSUFFICIENT: 'Votre stockage ne peut pas accueillir cette quantité.',
      QUANTITY_UNAVAILABLE: 'Cette quantité n’est plus disponible. Actualisez le marché.', SELF_PURCHASE: 'Vous ne pouvez pas acheter votre propre offre.',
      NOT_OWNER: 'Cette offre ne vous appartient pas.', REQUEST_CONFLICT: 'La transaction en attente ne correspond pas à cette demande.',
      AMOUNT_TOO_LARGE: 'Ce montant dépasse la limite technique autorisée.', LISTING_CLOSED: 'Cette offre est déjà fermée.', LISTING_MISSING: 'Cette offre n’existe plus.' };
    for (const [id, text] of Object.entries(labels)) if (code.includes(id)) return text;
    return 'Le marché est indisponible ou la demande a été refusée. Réessayez après actualisation.';
  }
  async function transact(operation = pending) {
    if (!player || busy || !operation) return;
    const currentPlayer = player, currentGeneration = generation;
    try {
      // Écrire le request_id avant le réseau : un retour incertain réutilise exactement ce reçu.
      if (!pending) remember({ ...operation, params: { ...operation.params, p_request_id: requestId() } });
    } catch { message('Impossible de sauvegarder le reçu de transaction dans ce navigateur. Aucun échange lancé.'); return; }
    const request = pending;
    busy = true; controls(); message('Transaction en cours…');
    try {
      const response = await client.rpc(request.rpc, request.params);
      if (currentGeneration !== generation || currentPlayer !== player) return;
      if (response.error) {
        // Une erreur PostgREST/PostgreSQL codée est une réponse définitive ; une panne réseau est incertaine.
        if (/^(?:[0-9A-Z]{5}|PGRST[0-9]+)$/.test(String(response.error.code || ''))) { remember(null); message(errorText(response.error)); }
        else message('Réponse réseau incertaine. Vérifiez la transaction avec le même reçu avant tout nouvel échange.');
      } else {
        const result = response.data; remember(null);
        const text = result?.status === 'published' ? 'Offre publiée : ressources mises en vente.'
          : result?.status === 'purchased' ? 'Achat effectué.'
          : result?.status === 'claimed' ? `${format(result.restored || '0')} ressource(s) récupérée(s).`
          : result?.status === 'cancelled' ? `Offre annulée. ${format(result.restored || '0')} restitué(s), ${format(result.reserved || '0')} en réserve.`
          : 'Cette offre est déjà annulée.';
        message(text);
        window.dispatchEvent(new CustomEvent('arvor:market-updated', { detail: { playerId: player } }));
      }
    } catch { if (currentGeneration === generation) message('Réponse réseau incertaine. Vérifiez la transaction en attente.'); }
    finally {
      if (currentGeneration === generation) { busy = false; controls(); if (!pending) await refresh(false); }
    }
  }
  function resourceImage(resource) {
    const image = node('img'); image.src = 'assets/market/' + resource + '.svg'; image.alt = ''; image.className = 'market-resource-image'; return image;
  }
  function resourceHeading(resource, detail) {
    const heading = node('div', undefined, 'market-resource-heading');
    const text = node('div'); text.append(node('h3', names[resource] || 'Ressource'), node('p', detail, 'market-seller-name'));
    heading.append(resourceImage(resource), text); return heading;
  }
  function fact(label, value, className = '') {
    const row = node('div', undefined, 'market-fact ' + className); row.append(node('span', label), node('strong', value)); return row;
  }
  function saleIllustration() {
    const resource = el('market-resource').value;
    el('market-sell-image').src = 'assets/market/' + resource + '.svg'; el('market-sell-image').alt = names[resource]; el('market-sell-name').textContent = names[resource];
  }
  function renderBoard() {
    const container = el('market-board'); container.replaceChildren();
    if (!board.length) {
      const empty = node('div', undefined, 'market-empty'); empty.append(node('span', '✥', 'market-empty-seal'), node('h3', 'Les étals sont encore déserts…'), node('p', 'Soyez le premier marchand à proposer vos ressources aux seigneurs d’Armorique !')); container.append(empty);
    }
    for (const offer of board) {
      if (!names[offer.resource] || !uuid(offer.listing_id)) continue;
      const card = node('article', undefined, 'market-card');
      card.append(resourceHeading(offer.resource, 'Vendeur : ' + offer.seller_name),
        fact('Quantité disponible', format(offer.quantity)), fact('Prix unitaire', format(offer.unit_price) + ' pièce(s)'), node('p', 'Offre entière : ' + format(offer.total) + ' pièces', 'market-note'));
      const label = node('label', 'Quantité souhaitée'); label.className = 'market-buy-quantity'; const input = node('input'); input.inputMode = 'numeric'; input.pattern = '[0-9]+'; input.value = '1';
      label.append(input); const total = node('p', undefined, 'market-purchase-total');
      const estimate = () => { try { total.textContent = 'Total : ' + format(number(input.value) * BigInt(offer.unit_price)) + ' pièces'; } catch { total.textContent = 'Saisissez une quantité entière positive.'; } };
      input.addEventListener('input', estimate); estimate();
      card.append(label, total, action('Acheter', () => {
        try {
          const qty = number(input.value); if (qty > BigInt(offer.quantity)) throw new Error('Quantité supérieure à l’offre disponible.');
          const gross = qty * BigInt(offer.unit_price); if (gross > maximum) throw new Error('Montant trop élevé.');
          confirm(`Acheter ${format(qty)} ${names[offer.resource].toLowerCase()} pour ${format(gross)} pièces ?`,
            { rpc: 'buy_market_listing', params: { p_listing_id: offer.listing_id, p_quantity: qty.toString() } });
        } catch (error) { message(error.message); }
      })); container.append(card);
    }
    el('market-page').textContent = 'Page ' + (offset / 50 + 1);
    el('market-prev').disabled = offset === 0; el('market-next').disabled = board.length < 50;
    controls();
  }
  function renderOwn() {
    const offers = el('market-offers'), reserves = el('market-reserves'), history = el('market-history');
    offers.replaceChildren(); reserves.replaceChildren(); history.replaceChildren();
    if (!own?.offers?.length) offers.append(node('p', 'Vous n’avez aucune offre.'));
    for (const offer of own?.offers || []) {
      const card = node('article', undefined, 'market-card');
      card.append(resourceHeading(offer.resource, 'Votre offre'), fact('Quantité initiale', format(offer.initial_quantity)), fact('Quantité restante', format(offer.remaining_quantity)), fact('Prix unitaire', format(offer.unit_price) + ' pièce(s)'),
        node('p', ({ active: 'En vente', sold_out: 'Vendue', cancelled: 'Annulée' })[offer.status] || 'Fermée', 'market-status market-status-' + offer.status));
      if (offer.status === 'active') card.append(action('Annuler l’offre', () => confirm('Annuler cette offre ? Les invendus dépassant votre stockage seront conservés en réserve.',
        { rpc: 'cancel_market_listing', params: { p_listing_id: offer.listing_id } })));
      offers.append(card);
    }
    if (!own?.reserves?.length) reserves.append(node('p', 'Aucune ressource en réserve.'));
    for (const reserve of own?.reserves || []) {
      const card = node('article', undefined, 'market-card'); card.append(resourceHeading(reserve.resource, 'Réserve de la halle'), node('p', format(reserve.quantity) + ' à récupérer'),
        action('Récupérer', () => confirm('Récupérer les ressources qui peuvent entrer dans votre stockage ?',
          { rpc: 'claim_market_reserve', params: { p_resource: reserve.resource } }))); reserves.append(card);
    }
    if (!own?.sales?.length) history.append(node('p', 'Aucune vente réalisée.'));
    for (const sale of own?.sales || []) history.append(node('p', `${format(sale.quantity)} ${names[sale.resource]} → ${sale.buyer_name} · ${format(sale.gross)} pièces · taxe ${format(sale.tax)} · net ${format(sale.net)} · ${new Date(sale.created_at).toLocaleString('fr-FR')}`));
    el('market-wallet').replaceChildren();
    if (own?.balance) for (const resource of Object.keys(names)) el('market-wallet').append(fact(names[resource], format(own.balance[resource])));
    el('market-coins').textContent = own?.balance ? format(own.balance.coins) : '—';
    controls();
  }
  async function refresh(showLoading = true) {
    if (!player) return;
    const currentGeneration = generation, version = ++readVersion;
    if (showLoading) message('Chargement du marché…');
    try {
      const [list, state] = await Promise.all([client.rpc('get_market_board', { p_resource: el('market-filter').value || null, p_sort: el('market-sort').value, p_offset: offset }), client.rpc('get_my_market')]);
      if (currentGeneration !== generation || version !== readVersion) return;
      if (list.error || state.error) { message(errorText(list.error || state.error)); return; }
      board = Array.isArray(list.data?.offers) ? list.data.offers : []; own = state.data;
      renderBoard(); renderOwn();
      if (showLoading) message(pending ? 'Une transaction attend une vérification avec son reçu initial.' : '');
    } catch { if (currentGeneration === generation && version === readVersion) message('Impossible de charger le marché.'); }
  }
  function estimateSell() {
    try {
      const gross = number(el('market-quantity').value) * number(el('market-price').value), tax = (gross + 19n) / 20n;
      el('market-estimate').replaceChildren(fact('Montant brut', format(gross) + ' pièces'), fact('Taxe : 5 %', format(tax) + ' pièces'), fact('Net estimé', format(gross - tax) + ' pièces', 'market-net'), node('p', 'Les achats partiels sont taxés séparément.', 'market-note'));
    } catch { el('market-estimate').textContent = 'Saisissez une quantité et un prix entiers positifs.'; }
  }
  function tab(name) {
    for (const item of ['buy', 'sell', 'own']) el('market-' + item).hidden = item !== name;
    dialog.querySelectorAll('[data-market-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.marketTab === name)));
  }
  el('market-resource').addEventListener('change', saleIllustration);
  el('show-market').addEventListener('click', () => { if (player) { tab('buy'); dialog.showModal(); void refresh(); } });
  el('market-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (confirmDialog.open) confirmDialog.close(); });
  el('market-confirm-cancel').addEventListener('click', () => confirmDialog.close());
  confirmDialog.addEventListener('close', () => { if (!confirmDialog.open) confirmation = null; });
  el('market-confirm-accept').addEventListener('click', () => { const operation = confirmation; confirmDialog.close(); void transact(operation); });
  el('market-retry').addEventListener('click', () => { void transact(); });
  el('market-refresh').addEventListener('click', () => { void refresh(); });
  dialog.querySelectorAll('[data-market-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.marketTab)));
  for (const id of ['market-filter', 'market-sort']) el(id).addEventListener('change', () => { offset = 0; void refresh(); });
  el('market-prev').addEventListener('click', () => { offset = Math.max(0, offset - 50); void refresh(); });
  el('market-next').addEventListener('click', () => { offset += 50; void refresh(); });
  for (const id of ['market-quantity', 'market-price']) el(id).addEventListener('input', estimateSell);
  el('market-sell-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const qty = number(el('market-quantity').value), price = number(el('market-price').value);
      if (qty * price > maximum) throw new Error('Montant trop élevé.');
      confirm(`Mettre en vente ${format(qty)} ${names[el('market-resource').value].toLowerCase()} à ${format(price)} pièce(s) par unité ?`,
        { rpc: 'create_market_listing', params: { p_resource: el('market-resource').value, p_quantity: qty.toString(), p_unit_price: price.toString() } });
    } catch (error) { message(error.message); }
  });
  window.arvor.market = Object.freeze({ refresh, setUser(id) {
    if (player === id) return;
    generation++; readVersion++; player = id; busy = false; pending = null; own = null; board = []; offset = 0;
    if (confirmDialog.open) confirmDialog.close(); if (dialog.open) dialog.close();
    message(''); el('market-coins').textContent = '—'; el('market-wallet').textContent = ''; el('market-board').replaceChildren(); el('market-offers').replaceChildren(); el('market-reserves').replaceChildren(); el('market-history').replaceChildren();
    if (player) {
      try {
        const receipt = JSON.parse(localStorage.getItem(key()) || 'null');
        const allowed = { create_market_listing: ['p_resource', 'p_quantity', 'p_unit_price', 'p_request_id'], buy_market_listing: ['p_listing_id', 'p_quantity', 'p_request_id'], cancel_market_listing: ['p_listing_id', 'p_request_id'], claim_market_reserve: ['p_resource', 'p_request_id'] };
        if (receipt && allowed[receipt.rpc] && uuid(receipt.params?.p_request_id) && Object.keys(receipt.params).every(k => allowed[receipt.rpc].includes(k))) pending = receipt;
      } catch { message('Le reçu local n’a pas pu être lu.'); }
    }
    controls(); estimateSell();
  } });
  controls(); estimateSell();
})();
