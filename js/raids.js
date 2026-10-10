/* PvP phase 10 : raccordement préparé, verrou local fermé, aucun départ effectif. */
(() => {
  'use strict';
  const supabase = window.arvor?.supabase;
  if (!supabase) return;
  // Activation ultérieure uniquement par modification de code revue ; aucun URL/GUC/storage ne l'ouvre.
  const RAID_DEPARTURE_ENABLED = false;
  const departure = window.ARVORRaidDeparture?.create({ enabled: RAID_DEPARTURE_ENABLED, rpc: (name, params) => supabase.rpc(name, params) });
  const node = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  const button = (text, callback) => {
    const e = node('button', text); e.type = 'button';
    if (callback) e.addEventListener('click', callback);
    return e;
  };
  const dialog = node('dialog', undefined, 'confirmation-dialog raid-dialog');
  dialog.setAttribute('aria-labelledby', 'raid-title');
  const header = node('header', undefined, 'raid-header');
  const title = node('h2', 'Préparer une attaque'); title.id = 'raid-title';
  const close = button('✕ Fermer', () => dialog.close()); close.id = 'raid-close';
  header.append(title, close);
  const note = node('p', RAID_DEPARTURE_ENABLED ? 'Test contrôlé : seule une autorisation serveur valide permet le départ.' : 'Les raids sont désactivés. Cette préparation ne réserve aucun soldat.', 'raid-disabled-note');
  const status = node('p'); status.id = 'raid-message'; status.setAttribute('role', 'status');
  const body = node('div'); body.id = 'raid-preparation';
  dialog.append(header, note, status, body); document.body.append(dialog);
  const review = node('dialog', undefined, 'confirmation-dialog raid-dialog raid-review');
  review.setAttribute('aria-labelledby', 'raid-review-title');
  const reviewHeader = node('header', undefined, 'raid-header');
  const reviewTitle = node('h2', 'Récapitulatif militaire'); reviewTitle.id = 'raid-review-title';
  reviewHeader.append(reviewTitle, button('✕ Fermer', () => review.close()));
  const reviewBody = node('div'); reviewBody.id = 'raid-review-body';
  review.append(reviewHeader, reviewBody); document.body.append(review);
  const panel = node('section', undefined, 'arvor-panel raid-panel'); panel.id = 'raid-panel'; panel.hidden = true;
  const panelHeader = node('div', undefined, 'raid-header');
  panelHeader.append(node('h2', 'Veille militaire'), button('Actualiser', () => void refresh()));
  const panelStatus = node('p'); panelStatus.setAttribute('role', 'status');
  const protection = node('p'); protection.id = 'raid-own-protection';
  const incoming = node('div'); incoming.id = 'raid-incoming';
  const outgoing = node('div'); outgoing.id = 'raid-outgoing';
  const reports = node('div'); reports.id = 'raid-reports';
  const prestige = node('p'); prestige.id = 'raid-prestige';
  const tabs = node('div', undefined, 'raid-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Conseil militaire');
  const panes = [], tabButtons = [];
  function selectTab(index) {
    panes.forEach((pane, i) => { pane.hidden = i !== index; tabButtons[i].setAttribute('aria-selected', String(i === index)); tabButtons[i].tabIndex = i === index ? 0 : -1; });
  }
  for (const [index, [name, content]] of [['Alertes', incoming], ['Missions', outgoing], ['Rapports', reports]].entries()) {
    const pane = node('section'); pane.id = 'raid-tab-panel-' + index; pane.setAttribute('role', 'tabpanel');
    const tab = button(name, () => selectTab(index)); tab.id = 'raid-tab-' + index; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', pane.id); pane.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % 3;
      else if (event.key === 'ArrowLeft') next = (index + 2) % 3;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 2;
      if (next !== undefined) { event.preventDefault(); selectTab(next); tabButtons[next].focus(); }
    });
    pane.append(node('h3', name === 'Alertes' ? 'Attaques entrantes' : name === 'Missions' ? 'Armées en déplacement et en retour' : 'Rapports de bataille'), content);
    panes.push(pane); tabButtons.push(tab); tabs.append(tab);
  }
  panel.append(panelHeader, panelStatus, protection, prestige, tabs, ...panes); selectTab(0);
  document.getElementById('player-screen')?.append(panel);
  let player = null, generation = 0, request = 0, overviewRequest = 0, timer = null, poll = null;
  let target = null, ownDomain = null, prepared = null, quantities = { infantry: 0, archer: 0, scout: 0 }, countdowns = [], offset = 0;
  let previewTimer = null;
  let departureBusy = false;
  async function confirmDeparture() {
    if (!departure || departureBusy) return;
    const gen = generation, id = player;
    if (!id || !target || !prepared || !review.open) return;
    departureBusy = true;
    reviewBody.querySelector('#raid-review-send')?.setAttribute('disabled', '');
    try {
      const result = await departure.send({ player: id, ownDomain, target, prepared, composition: { ...quantities } });
      // Une réponse tardive ne doit jamais mettre à jour une nouvelle session.
      if (gen !== generation || id !== player) return;
      status.textContent = result.message;
      const feedback = reviewBody.querySelector('#raid-departure-message');
      if (feedback) feedback.textContent = result.message;
      if (result.kind === 'accepted') {
        await refresh();
        if (gen !== generation || id !== player) return;
        try { await window.arvor?.refreshAfterRaid?.(id); }
        catch { if (gen === generation && id === player) status.textContent = 'Départ confirmé. Actualisation des soldats indisponible : rechargez la page, sans relancer le départ.'; }
      } else if (['uncertain', 'refused'].includes(result.kind)) await refresh();
    } finally { departureBusy = false; }
  }
  const names = { infantry: 'Fantassins', archer: 'Archers', scout: 'Éclaireurs' };
  const resourceNames = { food: 'Vivres', wood: 'Bois', stone: 'Pierre', iron: 'Fer' };
  const allowedReads = new Set(['get_my_raid_targets', 'get_raid_preparation', 'get_my_incoming_raids', 'get_my_outgoing_raids', 'get_my_battle_reports', 'get_my_raid_logistics']);
  const states = { outbound: 'Armée en route', returning: 'Retour en cours', completed: 'Retour terminé', destroyed: 'Armée détruite' };
  const outcomes = { offensive_win: 'Victoire offensive', defensive_win: 'Victoire défensive', protected: 'Renvoi sans combat — domaine protégé' };
  const integer = value => {
    if ((typeof value === 'number' && !Number.isSafeInteger(value)) || !['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value))) throw new Error('quantity');
    const n = BigInt(value); if (n > 9223372036854775807n) throw new Error('quantity'); return n;
  };
  const amount = value => integer(value).toLocaleString('fr-FR');
  function troops(value) {
    if (!value) throw new Error('troops');
    return Object.keys(names).map(type => `${names[type]} : ${amount(value[type])}`).join(' · ');
  }
  function resources(value, label) {
    if (!value) throw new Error('resources');
    const block = node('div', undefined, 'raid-resources'); block.append(node('h4', label));
    for (const type of Object.keys(resourceNames)) block.append(node('p', `${resourceNames[type]} : ${amount(value[type])}`));
    return block;
  }
  function uniqueRows(rows) {
    if (!Array.isArray(rows) || rows.some(row => !validUuid(row?.mission_id)) || new Set(rows.map(row => row.mission_id)).size !== rows.length) throw new Error('rows');
    return new Map(rows.map(row => [row.mission_id, row]));
  }
  function transport(composition) {
    // Projection d'affichage uniquement ; le serveur022 calcule après les pertes.
    return amount(String(integer(composition.infantry) * 30n + integer(composition.archer) * 20n + integer(composition.scout) * 10n));
  }
  const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const duration = seconds => {
    const s = Math.max(0, Math.ceil(seconds));
    return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`;
  };
  function protectionText(value) {
    if (!value || typeof value.protected !== 'boolean') throw new Error('protection');
    const parts = [];
    for (const [key, name] of [['beginner_until', 'Protection débutant'], ['heavy_defeat_until', 'Protection après défaite']]) {
      if (value[key]) {
        const at = Date.parse(value[key]); if (!Number.isFinite(at)) throw new Error('protection-date');
        parts.push(`${name} jusqu’au ${new Date(at).toLocaleString('fr-FR')}`);
      }
    }
    return parts.length ? parts.join(' · ') : 'Aucune protection active';
  }
  function updateCountdowns() {
    for (const { element, deadline } of countdowns) {
      const left = (deadline - Date.now() - offset) / 1000;
      element.textContent = left > 0 ? duration(left) : 'Échéance atteinte — en attente du serveur';
    }
  }
  async function rpc(name, params) {
    if (!allowedReads.has(name)) throw new Error('read-only');
    const result = await supabase.rpc(name, params);
    if (result.error) throw new Error('rpc');
    return result.data;
  }
  function renderOverview(rows, foreign, battleMap, logisticsMap) {
    if (!Array.isArray(rows)) throw new Error('rows');
    const fragment = document.createDocumentFragment(), clocks = [];
    for (const row of rows) {
      if (!row || !validUuid(row.mission_id) || typeof row.target_domain !== 'string' ||
          !['outbound', 'returning'].includes(row.status) || (foreign && (row.status !== 'outbound' || typeof row.attacker_name !== 'string' || typeof row.attacker_domain !== 'string'))) throw new Error('row');
      const deadline = Date.parse(row.status === 'returning' ? row.returns_at : row.arrives_at);
      const departed = Date.parse(row.departed_at);
      if (!Number.isFinite(deadline) || !Number.isFinite(departed) || deadline < departed) throw new Error('date');
      const card = node('article', undefined, 'raid-overview-card');
      if (foreign) card.append(node('strong', 'ALERTE ! Une armée ennemie approche !'), node('p', `${row.attacker_name} · ${row.attacker_domain} → ${row.target_domain}`));
      else card.append(node('strong', row.target_domain), node('p', row.status === 'returning' ? 'Retour en cours' : 'Armée en route'));
      if (foreign) card.append(node('p', 'Composition adverse confidentielle jusqu’à la bataille.'));
      else {
        const survivors = row.status === 'returning' ? battleMap.get(row.mission_id)?.attacker_survivors : row.composition;
        card.append(node('p', survivors ? 'Soldats indisponibles : ' + troops(survivors) : 'Survivants : rapport serveur non disponible.'));
        const logistics = logisticsMap.get(row.mission_id);
        if (row.status === 'returning') card.append(logistics?.plunder ? resources(logistics.plunder.obtained, 'Butin transporté — crédit au retour') : node('p', 'Butin transporté : lecture serveur non disponible.'));
      }
      card.append(node('p', `Départ : ${new Date(departed).toLocaleString('fr-FR')} · ${row.status === 'returning' ? 'Retour' : 'Arrivée'} : ${new Date(deadline).toLocaleString('fr-FR')}`));
      const clock = node('p'); clocks.push({ element: clock, deadline }); card.append(clock); fragment.append(card);
    }
    if (!rows.length) fragment.append(node('p', foreign ? 'Aucune attaque entrante.' : 'Aucune attaque en cours.'));
    return { fragment, clocks };
  }
  function renderReports(rows, logisticsMap, reserves) {
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      if (!outcomes[row.outcome] || !validUuid(row.attacker_domain_id) || !validUuid(row.defender_domain_id) || typeof row.attacker_domain !== 'string' || typeof row.defender_domain !== 'string' || !Number.isFinite(Date.parse(row.battle_at))) throw new Error('report');
      if (ownDomain && ![row.attacker_domain_id, row.defender_domain_id].includes(ownDomain)) throw new Error('participant');
      const card = node('details', undefined, 'raid-overview-card raid-battle-card');
      card.append(node('summary', `${row.attacker_domain} → ${row.defender_domain} · ${outcomes[row.outcome]} · ${new Date(row.battle_at).toLocaleString('fr-FR')}`));
      for (const [side, label] of [['attacker', 'Attaquant'], ['defender', 'Défenseur']]) {
        const camp = node('section'); camp.append(node('h4', label));
        camp.append(node('p', 'Effectif : ' + troops(row[side + '_units'])), node('p', 'Pertes : ' + troops(row[side + '_losses'])), node('p', 'Survivants : ' + troops(row[side + '_survivors']))); card.append(camp);
      }
      const beneficiary = row.prestige_domain_id === row.attacker_domain_id ? row.attacker_domain : row.prestige_domain_id === row.defender_domain_id ? row.defender_domain : null;
      const score = integer(row.prestige);
      if (score > 0n && !beneficiary) throw new Error('prestige');
      card.append(node('p', score > 0n ? `Prestige attribué à ${beneficiary} : +${amount(row.prestige)}` : 'Aucun prestige attribué.'));
      if (ownDomain) card.append(node('p', 'Votre prestige gagné : ' + (row.prestige_domain_id === ownDomain ? amount(row.prestige) : '0')));
      if (row.force_applied || row.protection_applied) card.append(node('p', [row.force_applied ? 'Force appliquée à l’attaquant' : '', row.protection_applied ? 'Protection appliquée au défenseur' : ''].filter(Boolean).join(' · ')));
      const logistics = logisticsMap.get(row.mission_id);
      if (logistics) {
        if (!states[logistics.status] || !logistics.plunder) throw new Error('logistics');
        card.append(node('p', states[logistics.status]), resources(logistics.plunder.obtained, 'Ressources pillées'));
        if (logistics.delivery) {
          const at = Date.parse(logistics.delivery.delivered_at); if (!Number.isFinite(at)) throw new Error('delivery');
          card.append(node('p', `Livraison confirmée le ${new Date(at).toLocaleString('fr-FR')}`), resources(logistics.delivery.stored, 'Butin livré'), resources(logistics.delivery.excess, 'Excédent au retour — relevé historique'));
        } else card.append(node('p', logistics.status === 'returning' ? 'Butin en transit — aucun crédit immédiat.' : 'Aucune livraison confirmée.'));
      } else card.append(node('p', 'Logistique non disponible dans les dernières lectures serveur.'));
      fragment.append(card);
    }
    if (!rows.length) fragment.append(node('p', 'Aucun rapport de bataille.'));
    if (!Array.isArray(reserves)) throw new Error('reserves');
    if (reserves.length) {
      const reserve = node('section', undefined, 'raid-overview-card'); reserve.append(node('h4', 'Vos réserves de butin actuelles'));
      const seen = new Set();
      for (const row of reserves) {
        const key = row.mission_id + ':' + row.resource;
        if (!validUuid(row.mission_id) || !resourceNames[row.resource] || seen.has(key)) throw new Error('reserve');
        seen.add(key);
        reserve.append(node('p', `${resourceNames[row.resource]} : ${amount(row.quantity)} en réserve · ${amount(row.claimed)} déjà récupérés · mission ${row.mission_id}`));
      }
      reserve.append(node('p', 'Consultation uniquement. Aucun transfert de ressources depuis cet écran.')); fragment.append(reserve);
    }
    fragment.append(node('p', 'Les 100 derniers rapports sont consultables. Les réserves de butin restent conservées côté serveur.', 'raid-disabled-note'));
    return fragment;
  }
  async function refresh() {
    if (!player) return;
    const gen = generation, id = player, seq = ++overviewRequest;
    const current = () => gen === generation && player === id && seq === overviewRequest;
    try {
      const [a, b, c, d] = await Promise.all([rpc('get_my_incoming_raids'), rpc('get_my_outgoing_raids'), rpc('get_my_battle_reports', { p_limit: 100 }), rpc('get_my_raid_logistics', { p_limit: 100 })]);
      if (!current()) return;
      const serverAt = Date.parse(a?.server_now); if (!Number.isFinite(serverAt)) throw new Error('clock');
      const protectedText = protectionText(a.protection);
      uniqueRows(a.raids); uniqueRows(b?.raids);
      const battleMap = uniqueRows(c?.reports), logisticsMap = uniqueRows(d?.reports);
      const first = renderOverview(a.raids, true, battleMap, logisticsMap), second = renderOverview(b.raids, false, battleMap, logisticsMap);
      const reportFragment = renderReports(c.reports, logisticsMap, d.reserves);
      prestige.textContent = 'Prestige militaire total : ' + amount(c.military_prestige);
      incoming.replaceChildren(first.fragment); outgoing.replaceChildren(second.fragment); reports.replaceChildren(reportFragment);
      countdowns = [...first.clocks, ...second.clocks]; offset = serverAt - Date.now(); protection.textContent = protectedText;
      panelStatus.textContent = RAID_DEPARTURE_ENABLED ? 'Veille militaire · départ soumis au permis serveur' : 'Raids désactivés · consultation uniquement'; updateCountdowns();
    } catch {
      if (current()) { countdowns = []; incoming.replaceChildren(); outgoing.replaceChildren(); reports.replaceChildren(); protection.textContent = ''; prestige.textContent = ''; panelStatus.textContent = 'Veille militaire indisponible. Aucun départ possible.'; }
    }
  }
  async function preview() {
    if (!player || !target || !dialog.open) return;
    const id = player, gen = generation, seq = ++request, selected = target;
    status.textContent = 'Préparation serveur en cours…';
    prepared = null;
    try {
      const data = await rpc('get_raid_preparation', { p_target_domain_id: selected.domain_id, p_infantry_qty: quantities.infantry, p_archer_qty: quantities.archer, p_scout_qty: quantities.scout });
      if (id !== player || gen !== generation || seq !== request || !dialog.open) return;
      if (!data || data.target?.domain_id !== selected.domain_id || typeof data.target.domain_name !== 'string' ||
          typeof data.target.player_name !== 'string' || data.distance == null || !Number.isFinite(Number(data.distance)) || Number(data.distance) < 0 || typeof data.composition_valid !== 'boolean' || !Number.isInteger(data.travel_seconds) || data.travel_seconds < 1) throw new Error('preparation');
      const fragment = document.createDocumentFragment();
      fragment.append(node('h3', data.target.domain_name), node('p', `Seigneur : ${data.target.player_name}`),
        node('p', `Distance : ${Number(data.distance).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} · Trajet aller : ${duration(data.travel_seconds)}`),
        node('p', protectionText(data.protection)), node('p', 'Aucun coût de déplacement défini.'));
      fragment.append(node('p', 'Votre domaine : ' + protectionText(data.own_protection)));
      const controls = node('div', undefined, 'raid-unit-grid');
      for (const type of Object.keys(names)) {
        const available = Number(data.available?.[type]);
        if (!Number.isSafeInteger(available) || available < 0) throw new Error('availability');
        const label = node('label', `${names[type]} · disponibles : ${available}`);
        const input = node('input'); input.type = 'number'; input.min = '0'; input.max = String(Math.min(2147483647, available)); input.step = '1'; input.inputMode = 'numeric'; input.value = String(quantities[type]); input.dataset.raidUnit = type;
        input.addEventListener('input', () => {
          request++; prepared = null; clearTimeout(previewTimer);
          body.querySelector('#raid-review-button')?.setAttribute('disabled', '');
          const n = Number(input.value);
          if (!Number.isInteger(n) || n < 0 || n > Number(input.max)) { status.textContent = 'Choisissez des quantités entières parmi vos soldats disponibles.'; return; }
          quantities[type] = n; previewTimer = setTimeout(() => void preview(), 350);
        });
        label.append(input); controls.append(label);
      }
      fragment.append(controls);
      const selectedComposition = { ...quantities };
      fragment.append(node('p', `Capacité de transport indicative si tous reviennent : ${transport(selectedComposition)} unités. Le serveur confirmera la capacité après les pertes.`, 'raid-transport'));
      const recap = button('Voir le récapitulatif', () => {
        if (!prepared || !player || !dialog.open) return;
        reviewBody.replaceChildren(node('h3', prepared.target.domain_name), node('p', 'Seigneur : ' + prepared.target.player_name), node('p', troops(selectedComposition)), node('p', 'Trajet aller : ' + duration(prepared.travel_seconds)), node('p', 'Trajet retour prévu : ' + duration(prepared.travel_seconds)), node('p', protectionText(prepared.protection)), node('p', 'Transport indicatif : ' + transport(selectedComposition) + ' unités.'), node('p', 'Les soldats restent indisponibles jusqu’à leur retour confirmé. Un futur départ offensif lèvera votre protection PvP.', 'raid-disabled-note'), node('p', 'Raids désactivés — ce récapitulatif ne réserve rien et ne lance aucune mission.', 'raid-disabled-note'));
        const disabled = button(RAID_DEPARTURE_ENABLED ? 'Confirmer l’attaque' : 'Confirmer le départ — indisponible', () => void confirmDeparture());
        disabled.disabled = !RAID_DEPARTURE_ENABLED || departureBusy || departure?.state !== 'idle' || !prepared.can_start || prepared.protection.protected;
        disabled.id = 'raid-review-send';
        const feedback = node('p'); feedback.id = 'raid-departure-message'; feedback.setAttribute('role', 'status');
        reviewBody.append(node('p', 'Les pertes sont définitives. Un pillage éventuel est crédité au retour seulement. Le serveur revalide la découverte, les protections, le permis et les soldats au départ.', 'raid-disabled-note'), disabled, feedback); review.showModal();
      });
      recap.id = 'raid-review-button'; recap.disabled = !data.composition_valid; fragment.append(recap);
      const send = button('Confirmer le départ — indisponible'); send.id = 'raid-send'; send.disabled = true;
      fragment.append(send, node('p', 'Raccordement préparé ; verrou local fermé. Le permis administratif et les verrous serveur restent obligatoires.', 'raid-disabled-note'));
      const focusType = document.activeElement?.dataset.raidUnit;
      body.replaceChildren(fragment);
      prepared = data;
      if (focusType) body.querySelector(`[data-raid-unit="${focusType}"]`)?.focus({ preventScroll: true });
      status.textContent = data.composition_valid ? (data.protection.protected ? 'Domaine protégé : aucun départ possible. ' : 'Composition consultable. ') + 'Aucun soldat réservé.' : 'Composition vide ou soldats insuffisants. Sélectionnez vos soldats disponibles.';
    } catch {
      if (id === player && gen === generation && seq === request && dialog.open) { body.replaceChildren(); status.textContent = 'Préparation militaire indisponible. Aucun départ possible.'; }
    }
  }
  async function openTarget(domain) {
    if (!player) return;
    if (review.open) review.close();
    target = null; prepared = null; quantities = { infantry: 0, archer: 0, scout: 0 }; body.replaceChildren(); status.textContent = 'Vérification de la cible découverte…';
    if (!dialog.open) dialog.showModal(); close.focus({ preventScroll: true });
    const id = player, gen = generation, seq = ++request;
    try {
      const rows = await rpc('get_my_raid_targets');
      if (id !== player || gen !== generation || seq !== request || !dialog.open) return;
      if (!Array.isArray(rows)) throw new Error('targets');
      const matches = rows.filter(row => Number(row.x) === Number(domain.x) && Number(row.y) === Number(domain.y));
      if (matches.length !== 1 || !validUuid(matches[0].domain_id) || matches[0].domain_id === ownDomain) throw new Error('target');
      target = matches[0]; await preview();
    } catch {
      if (id === player && gen === generation && seq === request && dialog.open) status.textContent = 'Ce domaine ne peut pas être préparé comme cible. Aucun départ possible.';
    }
  }
  dialog.addEventListener('close', () => { request++; clearTimeout(previewTimer); target = prepared = null; body.replaceChildren(); if (review.open) review.close(); });
  review.addEventListener('close', () => reviewBody.replaceChildren());
  document.addEventListener('visibilitychange', () => { if (!document.hidden && player) void refresh(); });
  window.arvor.raids = Object.freeze({ openTarget, refresh, setUser(id, domainId) {
    generation++; request++; overviewRequest++; player = id || null; ownDomain = validUuid(domainId) ? domainId : null; target = prepared = null; countdowns = [];
    clearInterval(timer); clearInterval(poll); clearTimeout(previewTimer); timer = poll = null;
    if (dialog.open) dialog.close(); if (review.open) review.close(); body.replaceChildren(); incoming.replaceChildren(); outgoing.replaceChildren(); reports.replaceChildren(); protection.textContent = ''; prestige.textContent = ''; panelStatus.textContent = ''; panel.hidden = !player; selectTab(0);
    if (player) {
      // Hors du callback Auth : ne pas réentrer dans le verrou de session du SDK.
      const gen = generation;
      setTimeout(() => { if (player && gen === generation) void refresh(); }, 0);
      timer = setInterval(updateCountdowns, 1000); poll = setInterval(() => { if (!document.hidden) void refresh(); }, 60000);
    }
  } });
})();
