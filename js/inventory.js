/* Inventaire : aucun objet possédé ; aperçu du catalogue uniquement sur hôte local. */
(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const dialog = get('inventory-dialog'), grid = get('inventory-grid'), access = get('show-inventory');
  const categories = [...dialog.querySelectorAll('[data-inventory-category]')];
  const hostname = window.location.hostname;
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' ||
    hostname === '[::1]' || /^10\.\d+\.\d+\.\d+$/.test(hostname) ||
    /^192\.168\.\d+\.\d+$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(hostname);
  const previewEnabled = localHost && ['http:', 'https:'].includes(window.location.protocol) &&
    new URLSearchParams(window.location.search).get('inventoryPreview') === 'potions';
  let catalogItems = [], ownedItems = [], catalogLoading = null, detailTrigger = null;
  let generation = 0, inventoryLoading = false, inventoryError = false;
  const counter = get('inventory-count');
  const notice = dialog.querySelector('.inventory-empty');
  let potionState = null, effectTimer = null, potionClock = null, using = false, attempt = null, useOperation = 0;
  const pendingPanel = document.createElement('section');
  pendingPanel.className = 'inventory-active-effects';
  dialog.querySelector('.inventory-storage').append(pendingPanel);
  const effectsPanel = document.createElement('section');
  effectsPanel.className = 'inventory-active-effects';
  effectsPanel.setAttribute('aria-label', 'Effets de potions actifs');
  dialog.querySelector('.inventory-storage').append(effectsPanel);
  const confirmation = document.createElement('dialog');
  confirmation.className = 'confirmation-dialog potion-use-confirmation';
  confirmation.setAttribute('aria-labelledby', 'potion-confirm-title');
  document.body.append(confirmation);
  const pendingKey = () => 'arvor:potion-request:' + user;
  function restoreAttempt() {
    attempt = null;
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey()));
      if (value?.player === user && typeof value.item_id === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.request_id))
        attempt = value;
    } catch { /* Identifiants de requête seulement ; aucune possession stockée. */ }
  }
  function rememberAttempt(item) {
    if (!attempt) {
      attempt = { player: user, item_id: item.id, request_id: crypto.randomUUID() };
      try { sessionStorage.setItem(pendingKey(), JSON.stringify(attempt)); } catch { /* Retry en mémoire. */ }
    }
  }
  function clearAttempt() {
    try { sessionStorage.removeItem(pendingKey()); } catch { /* Aucun état de jeu local. */ }
    attempt = null;
  }
  function confirmUse(item) {
    const title = document.createElement('h3');
    title.id = 'potion-confirm-title';
    title.textContent = 'Utiliser ' + item.name + ' ?';
    const text = document.createElement('p');
    text.textContent = 'Un exemplaire sera consommé. ' + item.description;
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Annuler';
    const accept = document.createElement('button');
    accept.type = 'button'; accept.textContent = 'Utiliser';
    cancel.addEventListener('click', () => confirmation.close('cancel'));
    accept.addEventListener('click', () => confirmation.close('confirm'));
    confirmation.replaceChildren(title, text, cancel, accept);
    confirmation.returnValue = '';
    return new Promise(resolve => {
      confirmation.addEventListener('close', () => resolve(confirmation.returnValue === 'confirm'), { once: true });
      confirmation.showModal();
      cancel.focus({ preventScroll: true });
    });
  }
  const potionReasons = {
    PVP_UNAVAILABLE: 'Indisponible : combat PvP non développé.',
    DOMAIN_REQUIRED: 'Un domaine est nécessaire.',
    ALREADY_ACTIVE: 'Un effet identique est déjà actif.',
    NO_CONSTRUCTION: 'Aucun chantier actif.',
    CONSTRUCTION_ALREADY_ACCELERATED: 'Ce chantier a déjà été accéléré.'
  };
  function renderEffects() {
    effectsPanel.replaceChildren();
    pendingPanel.replaceChildren();
    if (!previewEnabled && attempt) {
      const item = catalogItems.find(value => value.id === attempt.item_id);
      if (item) {
        const message = document.createElement('p');
        message.setAttribute('role', 'status');
        message.textContent = 'Une activation reste à vérifier : ' + item.name;
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = 'Vérifier l’activation précédente';
        retry.disabled = using;
        retry.addEventListener('click', () => activatePotion(item, retry, message));
        pendingPanel.append(message, retry);
      }
    }
    if (previewEnabled || !potionState?.effects?.length) return;
    const heading = document.createElement('h3'); heading.textContent = 'Effets actifs';
    effectsPanel.append(heading);
    const now = potionClock.server + (performance.now() - potionClock.local);
    for (const effect of potionState.effects) {
      const p = document.createElement('p');
      const name = catalogItems.find(item => item.id === effect.item_id)?.name || 'Potion';
      const remaining = effect.expires_at ? Math.max(0, Math.ceil((Date.parse(effect.expires_at) - now) / 1000)) : null;
      p.textContent = name + ' — ' + (remaining === null ? 'En attente de la prochaine action éligible' :
        remaining === 0 ? 'Expiration — vérification serveur…' :
          Math.floor(remaining / 3600) + ' h ' + Math.floor(remaining % 3600 / 60) + ' min ' + remaining % 60 + ' s');
      effectsPanel.append(p);
    }
  }
  async function refreshPotionState() {
    const current = generation;
    try {
      const result = await window.arvor.supabase.rpc('get_my_potion_effects');
      if (current !== generation || !user) return;
      if (result.error || !Array.isArray(result.data?.effects) || !Array.isArray(result.data?.availability) ||
          !Number.isFinite(Date.parse(result.data.server_time))) throw new Error('Effets indisponibles');
      potionState = result.data;
      potionClock = { server: Date.parse(result.data.server_time), local: performance.now() };
    } catch {
      if (current !== generation) return;
      potionState = null;
    }
    renderEffects();
    if (effectTimer !== null) clearInterval(effectTimer);
    effectTimer = null;
    if (dialog.open && !previewEnabled && potionState?.effects.some(e => e.expires_at))
      effectTimer = setInterval(() => {
        renderEffects();
        if (potionState.effects.some(e => e.expires_at &&
          Date.parse(e.expires_at) <= potionClock.server + performance.now() - potionClock.local)) {
          clearInterval(effectTimer); effectTimer = null;
          void refreshPotionState();
        }
      }, 1000);
  }
  async function activatePotion(item, button, message) {
    if (using || !user || previewEnabled || (attempt && attempt.item_id !== item.id)) return;
    const player = user, sessionGeneration = generation;
    const operation = ++useOperation;
    using = true; button.disabled = true;
    try {
      if (!await confirmUse(item) || player !== user || sessionGeneration !== generation) return;
      rememberAttempt(item);
      message.textContent = 'Activation en cours…';
      const result = await window.arvor.supabase.rpc('use_potion', {
        p_item_id: attempt.item_id, p_request_id: attempt.request_id
      });
      if (player !== user || sessionGeneration !== generation) return;
      if (result.error) {
        // Erreur réseau ambiguë : conserver le même UUID pour tout retry/rechargement.
        const code = result.error.message;
        if (/^ARVOR_(POTION_|AUTH_REQUIRED|DOMAIN_NOT_FOUND)/.test(code || '')) {
          clearAttempt();
          message.textContent = code.includes('ALREADY_ACTIVE') ? 'Un effet identique est déjà actif.' :
            code.includes('PVP_UNAVAILABLE') ? potionReasons.PVP_UNAVAILABLE :
            code.includes('NO_CONSTRUCTION') ? potionReasons.NO_CONSTRUCTION :
            code.includes('NOT_OWNED') ? 'Cette potion n’est plus disponible.' :
            code.includes('ALREADY_ACCELERATED') ? potionReasons.CONSTRUCTION_ALREADY_ACCELERATED :
            'Activation refusée par le serveur.';
        } else message.textContent = 'Réponse incertaine. Réessayez avec cette même potion pour vérifier l’activation.';
        return;
      }
      if (result.data?.request_id !== attempt.request_id || result.data?.item_id !== item.id)
        throw new Error('Réponse incertaine');
      clearAttempt();
      closeDetail();
      await loadInventory();
      if (player !== user) return;
      notice.textContent = 'Potion activée. Inventaire actualisé depuis le serveur.';
      window.dispatchEvent(new CustomEvent('arvor:potion-used', { detail: { playerId: player, itemId: item.id } }));
    } catch {
      if (player === user) message.textContent = 'Réponse incertaine. Réessayez avec cette même potion.';
    } finally {
      if (operation === useOperation) using = false;
      if (button.isConnected) button.disabled = false;
      if (player === user) renderEffects();
    }
  }
  const detail = document.createElement('dialog');
  detail.className = 'inventory-potion-detail';
  let inventoryScroll = 0;
  detail.setAttribute('aria-label', 'Détail de l’objet');
  detail.setAttribute('aria-labelledby', 'inventory-potion-detail-title');
  document.body.append(detail);
  detail.addEventListener('cancel', event => { event.preventDefault(); closeDetail(); });
  function closeDetail() {
    if (!detail.open && !detailTrigger) return;
    if (detail.open) detail.close();
    detail.replaceChildren();
    if (detailTrigger?.isConnected) detailTrigger.focus({ preventScroll: true });
    dialog.scrollTop = inventoryScroll;
    detailTrigger = null;
  }
  function showDetail(item, trigger, preview, quantity) {
    inventoryScroll = dialog.scrollTop;
    detailTrigger = trigger;
    const illustration = document.createElement('img');
    illustration.src = item.iconPath;
    illustration.alt = item.name;
    illustration.width = 400;
    illustration.height = 400;
    const title = document.createElement('h3');
    title.id = 'inventory-potion-detail-title';
    title.textContent = item.name;
    const description = document.createElement('p');
    description.textContent = item.description;
    const effect = document.createElement('p');
    const types = { prochaine_action: 'Prochaine action', immediat: 'Immédiat', temporaire: 'Temporaire' };
    const future = preview || ['potion_force', 'elixir_protection'].includes(item.id);
    effect.textContent = item.effect ? (future ? 'Effet futur : ' : 'Effet : ') + types[item.effect.type] + ' · ' +
      (item.effect.value > 0 ? '+' : '') + item.effect.value + ' %' : item.category === 'quest' ? 'Objet de quête — à remettre au PNJ indiqué dans votre journal.' : 'Utilisation indisponible.';
    const nodes = [illustration, title, description, effect];
    if (item.effect?.durationSeconds != null) {
      const duration = document.createElement('p');
      duration.textContent = 'Durée : ' + item.effect.durationSeconds / 3600 + ' heures';
      nodes.push(duration);
    }
    const label = document.createElement('p');
    label.textContent = preview ? 'Prévisualisation locale — objet non possédé, effet inactif.' :
      'Quantité possédée : ' + quantity;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fermer';
    close.autofocus = true;
    close.addEventListener('click', closeDetail);
    nodes.push(label);
    if (!preview && item.category === 'potion') {
      const availability = potionState?.availability.find(value => value.item_id === item.id);
      const message = document.createElement('p');
      message.setAttribute('role', 'status');
      if ((availability?.available || attempt?.item_id === item.id) && (!attempt || attempt.item_id === item.id)) {
        const use = document.createElement('button');
        use.type = 'button'; use.className = 'inventory-use-potion';
        use.textContent = attempt ? 'Réessayer l’activation' : 'Utiliser';
        use.disabled = using;
        use.addEventListener('click', () => activatePotion(item, use, message));
        nodes.push(use);
      } else message.textContent = attempt && attempt.item_id !== item.id ?
        'Vérifiez d’abord l’activation précédente.' :
        potionReasons[availability?.reason] || 'Utilisation indisponible : état serveur non vérifié.';
      nodes.push(message);
    }
    nodes.push(close);
    detail.replaceChildren(...nodes);
    detail.showModal();
    close.focus({ preventScroll: true });
    dialog.scrollTop = inventoryScroll;
  }
  function renderPreview() {
    const categoryMap = { equipment: 'equipment', items: 'item', quests: 'quest', potions: 'potion' };
    const catalog = new Map(catalogItems.map(item => [item.id, item]));
    const rows = previewEnabled ?
      catalogItems.filter(item => item.category === 'potion').map(item => ({ item_id: item.id, preview: true })) :
      ownedItems;
    const visible = rows.filter(row => selectedCategory === 'all' ||
      catalog.get(row.item_id)?.category === categoryMap[selectedCategory]);
    grid.setAttribute('aria-label', previewEnabled ? 'Prévisualisation locale — 30 emplacements' : 'Inventaire — 30 emplacements');
    [...grid.children].forEach((slot, index) => {
      slot.replaceChildren();
      slot.setAttribute('aria-label', 'Emplacement ' + (index + 1) + ' — vide');
      const row = visible[index];
      if (!row) return;
      const item = catalog.get(row.item_id);
      if (!item) {
        // Un objet serveur inconnu du catalogue client compte sans inventer son identité.
        slot.textContent = 'Objet inconnu';
        slot.setAttribute('aria-label', 'Objet possédé — catalogue à actualiser');
        return;
      }
      slot.setAttribute('aria-label', item.name + (row.preview ? ' — prévisualisation, non possédée' : ' — quantité ' + row.quantity));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inventory-potion-preview';
      button.dataset.itemId = item.id;
      button.setAttribute('aria-label', 'Voir ' + item.name + (row.preview ? ' — prévisualisation' : ' — quantité ' + row.quantity));
      const image = document.createElement('img');
      image.src = item.iconPath;
      image.alt = item.name;
      image.width = 400;
      image.height = 400;
      button.append(image);
      if (!row.preview) {
        const quantity = document.createElement('span');
        quantity.className = 'inventory-item-quantity';
        quantity.textContent = String(row.quantity);
        button.append(quantity);
      }
      button.addEventListener('click', () => showDetail(item, button, Boolean(row.preview), row.quantity));
      slot.append(button);
    });
    counter.textContent = inventoryError ? '— / 30' : ownedItems.length + ' / 30';
    counter.setAttribute('aria-label', inventoryError ? 'Inventaire indisponible' : ownedItems.length + ' emplacements occupés sur 30');
    if (inventoryError) notice.textContent = 'Inventaire indisponible. Fermez puis rouvrez pour réessayer.';
    else if (inventoryLoading) notice.textContent = 'Chargement de votre inventaire…';
    else if (previewEnabled) notice.textContent = 'Prévisualisation locale — ces images ne représentent pas vos possessions.';
    else notice.textContent = ownedItems.length ? 'Vos objets — sélectionnez un objet pour voir ses détails.' : 'Votre coffre est encore vide.';
  }
  function loadCatalog() {
    if (!catalogLoading)
      catalogLoading = fetch('js/item-catalog.json', { cache: 'no-store' })
        .then(response => { if (!response.ok) throw new Error('Catalogue indisponible'); return response.json(); })
        .then(catalog => {
          if (!Array.isArray(catalog.items)) throw new Error('Catalogue invalide');
          const questItems = window.ARVORQuestItems?.items || [];
          catalogItems = [...catalog.items, ...questItems.map(item => ({ ...item, iconPath: item.image }))];
        })
        .catch(error => { catalogLoading = null; throw error; });
    return catalogLoading;
  }
  async function loadInventory() {
    const current = ++generation;
    ownedItems = [];
    inventoryError = false;
    inventoryLoading = true;
    renderPreview();
    try {
      const client = window.arvor?.supabase;
      if (!client) throw new Error('Client indisponible');
      const [result] = await Promise.all([client.rpc('get_my_inventory'), loadCatalog(), refreshPotionState()]);
      if (current !== generation || !user) return;
      if (result.error || !Array.isArray(result.data) || result.data.length > 30)
        throw new Error('Lecture indisponible');
      const slots = new Set();
      for (const row of result.data) {
        if (!Number.isInteger(row.slot_index) || row.slot_index < 1 || row.slot_index > 30 ||
          slots.has(row.slot_index) || typeof row.item_id !== 'string' ||
          !Number.isInteger(row.quantity) || row.quantity < 1) throw new Error('État invalide');
        slots.add(row.slot_index);
      }
      ownedItems = result.data.slice().sort((a, b) => a.slot_index - b.slot_index);
    } catch {
      if (current !== generation || !user) return;
      ownedItems = [];
      inventoryError = true;
    } finally {
      if (current === generation && user) {
        inventoryLoading = false;
        renderPreview();
        renderEffects();
      }
    }
  }
  let user = null;
  let selectedCategory = 'all';
  function selectCategory(category) {
    closeDetail();
    selectedCategory = category;
    dialog.dataset.selectedCategory = selectedCategory;
    for (const button of categories)
      button.setAttribute('aria-pressed', String(button.dataset.inventoryCategory === selectedCategory));
    renderPreview();
  }
  for (const button of categories)
    button.addEventListener('click', () => selectCategory(button.dataset.inventoryCategory));
  selectCategory('all');
  const slots = document.createDocumentFragment();
  for (let index = 0; index < 30; index++) {
    const slot = document.createElement('li');
    slot.className = 'inventory-slot';
    slot.dataset.slotIndex = String(index);
    slot.setAttribute('aria-label', 'Emplacement ' + (index + 1) + ' — vide');
    slots.append(slot);
  }
  grid.replaceChildren(slots);
  access.disabled = true;
  access.addEventListener('click', () => {
    if (user && !dialog.open) {
      selectCategory('all');
      loadInventory();
      dialog.showModal();
      dialog.scrollTop = 0;
    }
  });
  dialog.addEventListener('close', () => {
    closeDetail();
    if (confirmation.open) confirmation.close('cancel');
    if (effectTimer !== null) clearInterval(effectTimer);
    effectTimer = null;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && user && dialog.open) void refreshPotionState();
  });
  get('inventory-close').addEventListener('click', () => dialog.close());
  window.arvor = window.arvor || {};
  window.arvor.inventory = Object.freeze({
    async refresh(playerId) {
      if (playerId && playerId === user && !previewEnabled) await loadInventory();
    },
    async readAttachmentItems(playerId) {
      if (!user || user !== playerId || previewEnabled) return [];
      await loadInventory();
      if (user !== playerId || inventoryError || inventoryLoading) return [];
      // Lecture du même inventaire serveur ; aucun objet de prévisualisation.
      return ownedItems.filter(row => row.instance_id == null).flatMap(row => {
        const item = catalogItems.find(item => item.id === row.item_id && item.category === 'potion');
        return item ? [{ id: item.id, name: item.name, iconPath: item.iconPath,
          category: item.category, quantity: String(row.quantity) }] : [];
      });
    },
    setUser(id) {
      generation++; useOperation++; using = false;
      ownedItems = [];
      inventoryError = false;
      inventoryLoading = false;
      if (effectTimer !== null) clearInterval(effectTimer);
      effectTimer = null; potionState = null; potionClock = null;
      if (confirmation.open) confirmation.close('cancel');
      user = id ?? null;
      restoreAttempt();
      renderEffects();
      selectCategory('all');
      if (dialog.open) dialog.close();
      access.disabled = !user;
    }
  });
})();
