/* Collecte serveur et lectures via le client public soumis aux RLS Supabase. */
(() => {
  'use strict';
  const element = (id) => document.getElementById(id);
  const form = element('login-form');
  const panel = element('login-panel');
  const screen = element('player-screen');
  const message = element('login-message');
  const loginButton = element('login-button');
  const logoutButton = element('logout-button');
  const email = element('email');
  const password = element('password');
  const supabase = window.arvor?.supabase;
  const domainView = element('domain-view');
  const armoriqueView = element('armorique-view');
  const armoriqueMarker = element('armorique-marker');
  function resetMapChoice(id, text) {
    const select = element(id);
    select.replaceChildren(new Option(text, ''));
    select.disabled = true;
    return select;
  }
  element('armorique-location-choice').addEventListener('change', event => {
    const marker = Array.from(locationLayer.children).find(node => node.dataset.locationCode === event.target.value);
    event.target.value = '';
    marker?.click();
  });
  element('armorique-frontier-choice').addEventListener('change', event => {
    const marker = Array.from(frontierLayer.children).find(node => node.dataset.frontierKey === event.target.value);
    event.target.value = '';
    marker?.click();
  });
  let worldDiscoveries = null;
  let discoveryRequest = 0;
  // Paramètres esthétiques en fractions du côté d’une cellule, jamais en pixels.
  const fogAppearance = Object.freeze({ resolution: 12, inset: 0.13, feather: 0.52, drift: 0.08 });
  function buildFogOpening(known, columns, rows) {
    // Distance au terrain inconnu sur l'union entière ; aucune ouverture par cellule.
    const resolution = Math.max(2, Math.min(fogAppearance.resolution, Math.floor(Math.sqrt(220000 / (columns * rows))))), width = columns * resolution + 2, height = rows * resolution + 2;
    const labels = new Int32Array(columns * rows).fill(-1), components = [];
    for (const key of known) {
      const [col, row] = key.split(',').map(Number), first = row * columns + col;
      if (labels[first] !== -1) continue;
      const id = components.length, queue = [first]; labels[first] = id; components.push(0);
      for (let i = 0; i < queue.length; i++) {
        const cell = queue[i], x = cell % columns, y = Math.floor(cell / columns);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx, ny = y + dy, next = ny * columns + nx;
          if (nx >= 0 && nx < columns && ny >= 0 && ny < rows && labels[next] === -1 && known.has(nx + ',' + ny)) {
            labels[next] = id; queue.push(next);
          }
        }
      }
    }
    const distance = new Float64Array(width * height), owner = new Int32Array(width * height).fill(-1);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const col = Math.floor((x - 1) / resolution), row = Math.floor((y - 1) / resolution), id = labels[row * columns + col];
      if (id !== -1) { const i = y * width + x; distance[i] = 1e12; owner[i] = id; }
    }
    // Transformée euclidienne séparable, linéaire en nombre de pixels (pas de flou débordant).
    const size = Math.max(width, height), input = new Float64Array(size), output = new Float64Array(size);
    const sites = new Int32Array(size), breaks = new Float64Array(size + 1);
    function transform(n) {
      let k = 0; sites[0] = 0; breaks[0] = -Infinity; breaks[1] = Infinity;
      for (let q = 1; q < n; q++) {
        let s;
        do {
          const p = sites[k]; s = ((input[q] + q * q) - (input[p] + p * p)) / (2 * (q - p));
          if (s > breaks[k]) break;
          k--;
        } while (k >= 0);
        k++; sites[k] = q; breaks[k] = s; breaks[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < n; q++) { while (breaks[k + 1] < q) k++; const d = q - sites[k]; output[q] = d * d + input[sites[k]]; }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) input[x] = distance[y * width + x]; transform(width);
      for (let x = 0; x < width; x++) distance[y * width + x] = output[x];
    }
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) input[y] = distance[y * width + x]; transform(height);
      for (let y = 0; y < height; y++) {
        const i = y * width + x; distance[i] = Math.max(0, (Math.sqrt(output[y]) - 0.5) / resolution);
        if (owner[i] !== -1) components[owner[i]] = Math.max(components[owner[i]], distance[i]);
      }
    }
    const canvas = document.createElement('canvas'); canvas.width = width - 2; canvas.height = height - 2;
    const context = canvas.getContext('2d'); if (!context) throw new Error('fog-canvas');
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, id = owner[i], p = ((y - 1) * canvas.width + x - 1) * 4;
      let reveal = 0;
      if (id !== -1) {
        const cx = (x - 0.5) / resolution, cy = (y - 0.5) / resolution;
        // Variations stables et continues, communes à la zone, sans motif de grille.
        const drift = Math.sin(cx * 1.31 + cy * 0.73) * Math.cos(cy * 1.17 - cx * 0.49);
        const feather = Math.min(fogAppearance.feather, Math.max(0.28, components[id] * 0.55)) * (1 + drift * fogAppearance.drift);
        const t = Math.max(0, Math.min(1, (distance[i] - fogAppearance.inset) / feather));
        reveal = t * t * (3 - 2 * t);
      }
      const gray = Math.round(255 * (1 - reveal)); pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = gray; pixels.data[p + 3] = 255;
    }
    // Lisser le masque global, puis borner de nouveau chaque pixel vers l'intérieur.
    // Le lissage arrondit les angles convexes sans ouvrir les cellules voisines.
    const radius = Math.max(1, Math.round(resolution * 0.30)), span = radius * 2 + 1;
    let field = new Float32Array(canvas.width * canvas.height);
    for (let i = 0; i < field.length; i++) field[i] = 1 - pixels.data[i * 4] / 255;
    for (let pass = 0; pass < 2; pass++) {
      const horizontal = new Float32Array(field.length), vertical = new Float32Array(field.length);
      for (let y = 0; y < canvas.height; y++) {
        let sum = 0;
        for (let x = -radius; x <= radius; x++) if (x >= 0 && x < canvas.width) sum += field[y * canvas.width + x];
        for (let x = 0; x < canvas.width; x++) {
          horizontal[y * canvas.width + x] = sum / span;
          if (x - radius >= 0) sum -= field[y * canvas.width + x - radius];
          if (x + radius + 1 < canvas.width) sum += field[y * canvas.width + x + radius + 1];
        }
      }
      for (let x = 0; x < canvas.width; x++) {
        let sum = 0;
        for (let y = -radius; y <= radius; y++) if (y >= 0 && y < canvas.height) sum += horizontal[y * canvas.width + x];
        for (let y = 0; y < canvas.height; y++) {
          vertical[y * canvas.width + x] = sum / span;
          if (y - radius >= 0) sum -= horizontal[(y - radius) * canvas.width + x];
          if (y + radius + 1 < canvas.height) sum += horizontal[(y + radius + 1) * canvas.width + x];
        }
      }
      field = vertical;
    }
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      const i = y * width + x, p = ((y - 1) * canvas.width + x - 1) * 4;
      const gate = Math.max(0, Math.min(1, (distance[i] - fogAppearance.inset) / 0.18));
      const reveal = owner[i] === -1 ? 0 : Math.min(1, field[p / 4] * (components[owner[i]] <= 0.55 ? 2.5 : 1.35)) * gate;
      const gray = Math.round(255 * (1 - reveal)); pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = gray;
    }
    context.putImageData(pixels, 0, 0); return canvas.toDataURL('image/png');
  }
  function buildFogGeometry(known, columns, rows) {
    // Frontières orientées : les arêtes communes disparaissent avant tout lissage.
    const edges = new Map();
    const vertexKey = (x, y) => x + ',' + y;
    const add = (x, y, dx, dy) => {
      const key = vertexKey(x, y);
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ x, y, dx, dy });
    };
    for (const key of known) {
      const [x, y] = key.split(',').map(Number);
      if (!known.has(vertexKey(x, y - 1))) add(x, y, 1, 0);
      if (!known.has(vertexKey(x + 1, y))) add(x + 1, y, 0, 1);
      if (!known.has(vertexKey(x, y + 1))) add(x + 1, y + 1, -1, 0);
      if (!known.has(vertexKey(x - 1, y))) add(x, y + 1, 0, -1);
    }
    const width = 100 / columns, height = 100 / rows;
    const point = (x, y) => (x * width) + ' ' + (y * height);
    let exact = '', rounded = '', count = 0;
    while (edges.size) {
      const first = edges.values().next().value[0];
      let edge = first;
      const vertices = [];
      do {
        if (++count > known.size * 4) throw new Error('fog-contour');
        vertices.push(edge);
        const key = vertexKey(edge.x, edge.y), list = edges.get(key);
        list.splice(list.indexOf(edge), 1);
        if (!list.length) edges.delete(key);
        const x = edge.x + edge.dx, y = edge.y + edge.dy;
        if (x === first.x && y === first.y) break;
        const next = edges.get(vertexKey(x, y));
        if (!next?.length) throw new Error('fog-contour');
        // Aux contacts diagonaux, tourner à droite ferme chaque îlot séparément.
        const priority = e => {
          const cross = edge.dx * e.dy - edge.dy * e.dx;
          return cross > 0 ? 0 : edge.dx === e.dx && edge.dy === e.dy ? 1 : cross < 0 ? 2 : 3;
        };
        const chosen = next.reduce((a, b) => priority(a) <= priority(b) ? a : b);
        edge = chosen;
      } while (true);
      exact += 'M' + vertices.map(v => point(v.x, v.y)).join('L') + 'Z';
      rounded += 'M' + vertices.map(v => point(v.x, v.y)).join('L') + 'Z';
    }
    return { exact, rounded, width, height };
  }
  function publishWorldFog(known, columns, rows) {
    if (!window.SVGMaskElement || !window.SVGFEGaussianBlurElement) throw new Error('fog-support');
    const geometry = buildFogGeometry(known, columns, rows);
    element('armorique-known-cells').setAttribute('d', geometry.exact);
    element('armorique-reveal').setAttribute('d', geometry.rounded);
    element('armorique-opening').setAttribute('href', buildFogOpening(known, columns, rows));
    // Publication finale : ouverture esthétique lissée ; les contenus restent filtrés côté serveur.
    element('armorique-unknown-guard').setAttribute('d', '');
  }
  function resetWorldFog() {
    clearWorldDomains();
    worldDiscoveries = null;
    window.arvor?.worldGrid?.update(null);
    element('armorique-unknown-guard').setAttribute('d', 'M0 0H100V100H0Z');
    element('armorique-known-cells').setAttribute('d', '');
    element('armorique-reveal').setAttribute('d', '');
    element('armorique-opening').removeAttribute('href');
    element('armorique-fog-cover').setAttribute('d', 'M0 0H100V100H0Z');
    updateWorldMarkerVisibility();
  }
  function updateWorldMarkerVisibility() {
    const map = element('armorique-map');
    // Notre domaine reste visible indépendamment du brouillard.
    armoriqueMarker.hidden = !armoriqueMarker.dataset.positionReady || !map.complete || map.naturalWidth === 0;
  }
  async function loadWorldDiscoveries(id, requestGeneration) {
    const request = ++discoveryRequest;
    const current = () => request === discoveryRequest && generation === requestGeneration && userId === id;
    resetWorldFog();
    element('armorique-fog-message').textContent = 'Découvertes en cours de chargement…';
    try {
      const { data, error } = await supabase.rpc('get_my_world_discoveries');
      if (!current()) return;
      if (error) throw new Error('rpc');
      if (!data || data.status !== 'positioned') {
        element('armorique-fog-message').textContent = 'Découvertes indisponibles : domaine non positionné.';
        return;
      }
      const { grid_columns: columns, grid_rows: rows, cells } = data;
      // La carte master représente précisément ce repère ; aucune conversion implicite.
      if (data.region_code !== 'finistere' || data.x_min !== 0 || data.x_max !== 100 ||
          data.y_min !== 0 || data.y_max !== 100 || !Number.isInteger(columns) ||
          !Number.isInteger(rows) || columns < 1 || rows < 1 || columns * rows > 65536 ||
          !Array.isArray(cells) || cells.length > columns * rows) throw new Error('structure');
      const known = new Set();
      for (const cell of cells) {
        if (!cell || !Number.isInteger(cell.column_index) || !Number.isInteger(cell.row_index) ||
            cell.column_index < 0 || cell.column_index >= columns ||
            cell.row_index < 0 || cell.row_index >= rows) throw new Error('cell');
        const key = cell.column_index + ',' + cell.row_index;
        if (known.has(key)) continue;
        known.add(key);

      }
      // Publication atomique après validation complète : toute erreur conserve le voile total.
      publishWorldFog(known, columns, rows);
      worldDiscoveries = { columns, rows, cells: known };
      window.arvor?.worldGrid?.update(worldDiscoveries);
      element('armorique-fog-message').textContent = known.size ? '' : 'Aucune cellule découverte.';
      updateWorldMarkerVisibility();
    } catch {
      if (current()) {
        resetWorldFog();
        element('armorique-fog-message').textContent = 'Impossible de charger les découvertes. La carte reste masquée.';
      }
    }
  }
  // D4 : couche de consultation, alimentée exclusivement par la RPC personnelle.
  const locationLayer = document.createElement('div');
  locationLayer.className = 'armorique-locations';
  element('armorique-map').parentElement.append(locationLayer);
  const locationMessage = document.createElement('p');
  locationMessage.className = 'message';
  locationMessage.setAttribute('role', 'status');
  const locationPanel = document.createElement('section');
  locationPanel.className = 'armorique-location-panel';
  locationPanel.hidden = true;
  locationPanel.setAttribute('aria-label', 'Lieu découvert');
  armoriqueView.append(locationMessage, locationPanel);
  let locationRequest = 0;
  const worldDomainLayer = document.createElement('div');
  worldDomainLayer.className = 'armorique-world-domains';
  locationLayer.before(worldDomainLayer);
  const worldDomainMessage = document.createElement('p');
  worldDomainMessage.className = 'message'; worldDomainMessage.setAttribute('role', 'status');
  armoriqueView.append(worldDomainMessage);
  const worldDomainDialog = document.createElement('dialog');
  worldDomainDialog.className = 'confirmation-dialog world-domain-dialog';
  worldDomainDialog.setAttribute('aria-label', 'Domaine découvert');
  document.body.append(worldDomainDialog);
  let worldDomainRequest = 0;
  function clearWorldDomains() {
    worldDomainRequest++; worldDomainLayer.replaceChildren();
    resetMapChoice('armorique-domain-choice', 'Choisir un domaine découvert');
    worldDomainMessage.textContent = '';
    if (worldDomainDialog.open) worldDomainDialog.close();
    worldDomainDialog.replaceChildren();
  }
  function showWorldDomain(domain) {
    const title = document.createElement('h2'); title.textContent = domain.domain_name;
    const player = document.createElement('p'); player.textContent = 'Seigneur du domaine : ' + domain.player_name;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Fermer';
    close.addEventListener('click', () => worldDomainDialog.close());
    const attack = document.createElement('button'); attack.type = 'button'; attack.textContent = 'Attaquer — préparation';
    attack.addEventListener('click', () => {
      worldDomainDialog.close(); void window.arvor?.raids?.openTarget(domain);
    });
    worldDomainDialog.replaceChildren(title, player, attack, close);
    worldDomainDialog.showModal(); close.focus({ preventScroll: true });
  }
  element('armorique-domain-choice').addEventListener('change', event => {
    const marker = Array.from(worldDomainLayer.children).find(node => node.dataset.point === event.target.value);
    event.target.value = ''; marker?.click();
  });
  async function loadWorldDomains(id, requestGeneration) {
    clearWorldDomains();
    const request = worldDomainRequest, discoveries = worldDiscoveries;
    const current = () => request === worldDomainRequest && generation === requestGeneration && userId === id && worldDiscoveries === discoveries;
    if (!discoveries) return;
    try {
      const { data, error } = await supabase.rpc('get_my_visible_world_domains');
      if (!current()) return;
      if (error || !Array.isArray(data)) throw new Error('domains');
      const points = new Set();
      for (const d of data) {
        const x = Number(d?.x), y = Number(d?.y), point = x + ',' + y;
        if (!d || typeof d.domain_name !== 'string' || !d.domain_name.trim() ||
            typeof d.player_name !== 'string' || !d.player_name.trim() || d.region_code !== 'finistere' ||
            d.x === null || d.y === null || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100 ||
            !Number.isInteger(d.column_index) || !Number.isInteger(d.row_index) ||
            d.column_index !== Math.min(discoveries.columns - 1, Math.floor(x * discoveries.columns / 100)) ||
            d.row_index !== Math.min(discoveries.rows - 1, Math.floor(y * discoveries.rows / 100)) ||
            !discoveries.cells.has(d.column_index + ',' + d.row_index) || points.has(point) ||
            (armoriqueMarker.dataset.positionReady && x === parseFloat(armoriqueMarker.style.left) && y === parseFloat(armoriqueMarker.style.top))) throw new Error('hidden');
        points.add(point);
      }
      const fragment = document.createDocumentFragment(), choice = element('armorique-domain-choice');
      for (const d of data) {
        const marker = document.createElement('button'); marker.type = 'button';
        marker.className = 'armorique-foreign-domain'; marker.dataset.point = Number(d.x) + ',' + Number(d.y);
        marker.style.left = Number(d.x) + '%'; marker.style.top = Number(d.y) + '%';
        marker.textContent = '🏰'; marker.title = d.domain_name + ' — ' + d.player_name;
        marker.setAttribute('aria-label', marker.title);
        marker.addEventListener('click', () => showWorldDomain(d)); fragment.append(marker);
        choice.add(new Option(marker.title, marker.dataset.point));
      }
      worldDomainLayer.replaceChildren(fragment); choice.disabled = data.length === 0;
      void window.arvor?.raids?.refresh();
    } catch {
      if (current()) worldDomainMessage.textContent = 'Domaines découverts indisponibles pour le moment.';
    }
  }
  function clearWorldLocations() {
    clearWorldDomains();
    resetMapChoice('armorique-location-choice', 'Choisir un lieu découvert');
    locationRequest++;
    locationLayer.replaceChildren();
    locationPanel.replaceChildren();
    locationPanel.hidden = true;
    locationMessage.textContent = '';
  }
  function showLocationDetails(location, marker) {
    locationPanel.replaceChildren();
    const title = document.createElement('h4');
    title.textContent = location.name;
    const type = document.createElement('p');
    type.textContent = 'Type : ' + location.location_type;
    const danger = document.createElement('p');
    danger.textContent = ['Danger I — Faible', 'Danger II — Modéré', 'Danger III — Élevé'][location.danger_level - 1];
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Fermer';
    close.addEventListener('click', () => { locationPanel.hidden = true; marker.focus(); });
    locationPanel.append(title, type, danger);
    if (locationTargets.has(location.code)) {
      const prepare = document.createElement('button'); prepare.type = 'button';
      prepare.textContent = expeditionActive() ? 'Voir la mission active' : 'Préparer une expédition';
      prepare.addEventListener('click', () => openLocationPreparation(location, marker));
      locationPanel.append(prepare);
    }
    locationPanel.append(close);
    locationPanel.hidden = false;
    close.focus({ preventScroll: true });
  }
  async function loadWorldLocations(id, requestGeneration) {
    clearWorldLocations();
    const request = locationRequest;
    const current = () => request === locationRequest && generation === requestGeneration && userId === id;
    // Le chargement géographique existant garde intégralement son fonctionnement.
    await loadWorldDiscoveries(id, requestGeneration);
    if (!current() || !worldDiscoveries) return;
    try {
      const { data, error } = await supabase.rpc('get_my_discovered_locations');
      if (!current()) return;
      if (error || !Array.isArray(data)) throw new Error('locations');
      const { columns, rows, cells } = worldDiscoveries;
      const codes = new Set();
      for (const location of data) {
        if (!location || typeof location.code !== 'string' || !location.code || codes.has(location.code) ||
            typeof location.name !== 'string' || typeof location.location_type !== 'string' ||
            ![1, 2, 3].includes(location.danger_level) || location.region_code !== 'finistere' ||
            !Number.isInteger(location.column_index) || !Number.isInteger(location.row_index) ||
            location.column_index < 0 || location.column_index >= columns ||
            location.row_index < 0 || location.row_index >= rows ||
            !cells.has(location.column_index + ',' + location.row_index)) throw new Error('position');
        codes.add(location.code);
      }
      const fragment = document.createDocumentFragment();
      for (const location of data) {
        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'armorique-location-marker';
        marker.dataset.locationCode = location.code;
        marker.style.left = ((location.column_index + 0.5) * 100 / columns) + '%';
        marker.style.top = ((location.row_index + 0.5) * 100 / rows) + '%';
        marker.textContent = '◇';
        marker.setAttribute('aria-label', location.name);
        marker.title = location.name;
        marker.addEventListener('click', () => showLocationDetails(location, marker));
        fragment.append(marker);
      }
      locationNames = new Map(data.map(location => [location.code, location]));
      locationLayer.replaceChildren(fragment);
      const choice = element('armorique-location-choice');
      for (const location of data) choice.add(new Option(location.name, location.code));
      choice.disabled = data.length === 0;
    } catch {
      if (current()) locationMessage.textContent = 'Lieux découverts indisponibles pour le moment.';
    }
  }
  element('armorique-map').addEventListener('error', clearWorldLocations);
  function selectMapView(world) {
    domainView.hidden = world;
    armoriqueView.hidden = !world;
    element('show-domain-view').setAttribute('aria-pressed', String(!world));
    element('show-armorique-view').setAttribute('aria-pressed', String(world));
    if (world && userId && domainId) { void refreshExpeditionMap(); void synchronizeExpedition(); }
  }
  element('show-domain-view').addEventListener('click', () => selectMapView(false));
  element('show-armorique-view').addEventListener('click', () => selectMapView(true));
  element('armorique-map').addEventListener('error', () => {
    element('armorique-image-message').hidden = false;
    armoriqueMarker.hidden = true;
  });
  element('armorique-map').addEventListener('load', () => {
    element('armorique-image-message').hidden = true;
    updateWorldMarkerVisibility();
  });
  // Une image déjà en échec avant l’installation des listeners doit aussi être signalée.
  if (element('armorique-map').complete && element('armorique-map').naturalWidth === 0) {
    element('armorique-image-message').hidden = false;
  }
  async function loadWorldPosition(id, requestGeneration) {
    const current = () => generation === requestGeneration && userId === id;
    try {
      const { data, error } = await supabase.rpc('get_my_world_position');
      if (!current()) return;
      if (error) throw error;
      if (!data) {
        element('armorique-message').textContent = 'Votre domaine ne possède pas encore de position mondiale.';
        return;
      }
      const { x, y } = data;
      if (data.region_code !== 'finistere' || x === null || y === null ||
          !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) ||
          Number(x) < 0 || Number(x) > 100 || Number(y) < 0 || Number(y) > 100) throw new Error('position');
      armoriqueMarker.style.left = Number(x) + '%';
      armoriqueMarker.style.top = Number(y) + '%';
      element('armorique-domain-label').textContent = data.domain_name ?? 'Votre domaine';
      armoriqueMarker.dataset.positionReady = 'true';
      updateWorldMarkerVisibility();
      element('armorique-message').textContent = '';
    } catch {
      if (current()) element('armorique-message').textContent = 'Position mondiale indisponible. Vérifiez que la RPC de lecture est installée puis rechargez la page.';
    }
  }

  // E1 : destinations exclusivement fournies par la RPC personnelle de frontière.
  const expeditionDialog = element('expedition-dialog');
  const expeditionContent = element('expedition-content');
  const expeditionMessage = element('expedition-message');
  const expeditionMapMessage = element('expedition-map-message');
  let e1Preparation = null, e1PreparationKey = '', e1PreparationTimer = null, e1PreparationRequest = 0;
  function resetE1Preparation() {
    clearTimeout(e1PreparationTimer); e1PreparationTimer = null; e1PreparationRequest++;
    e1Preparation = null; e1PreparationKey = '';
  }
  function requestE1Preparation(scouts) {
    if (!selectedDestination || scouts < 1) return;
    const key = selectedDestination.cell_id + ':' + scouts;
    if (key === e1PreparationKey) return;
    resetE1Preparation(); e1PreparationKey = key;
    const request = e1PreparationRequest, id = userId, gen = generation, target = selectedDestination.cell_id;
    const current = () => userId === id && generation === gen && request === e1PreparationRequest &&
      expeditionPanelMode === 'prepare' && selectedDestination?.cell_id === target;
    e1PreparationTimer = setTimeout(async () => {
      e1PreparationTimer = null;
      if (!current()) return;
      try {
        const { data, error } = await supabase.rpc('get_exploration_preparation', { p_target_cell_id: target, p_scout_qty: scouts });
        if (!current()) return;
        if (error || data?.rules_version !== 2 || data.scouts !== scouts || !Number.isSafeInteger(data.max_cells) ||
          data.max_cells < 1 || data.max_cells > 4 || !Number.isSafeInteger(data.travel_seconds) || data.travel_seconds < 45 ||
          data.total_seconds !== data.travel_seconds * 2 || typeof data.can_start !== 'boolean' || data.losses !== 0 || data.resource_cost !== 0) throw new Error('preparation');
        e1Preparation = data;
      } catch {
        if (!current()) return;
        e1Preparation = { unavailable: true };
      }
      if (current()) updateExpeditionControls();
    }, 180);
  }
  const frontierLayer = document.createElement('div');
  frontierLayer.className = 'expedition-frontier-layer';
  locationLayer.before(frontierLayer);
  // Les domaines connus doivent intercepter les clics avant les frontières transparentes.
  frontierLayer.after(worldDomainLayer);
  const destinationMarker = document.createElement('span');
  destinationMarker.className = 'expedition-destination-marker';
  destinationMarker.textContent = '⚑';
  destinationMarker.setAttribute('aria-hidden', 'true');
  destinationMarker.hidden = true;
  element('armorique-map').parentElement.append(destinationMarker);
  const expeditionUnits = [
    { type: 'scout', name: 'Éclaireurs', role: 'Exploration et reconnaissance', min: 1 },
    { type: 'infantry', name: 'Fantassins', role: 'Protection de l’expédition', min: 0 },
    { type: 'archer', name: 'Archers', role: 'Soutien à distance', min: 0 }
  ];
  let explorationFrontier = new Map();
  let frontierRequest = 0;
  let expeditionMapRequest = 0;
  let selectedDestination = null;
  let expeditionQuantities = new Map();
  let expeditionRecord = null;
  let expeditionReady = false;
  let expeditionSending = false;
  let expeditionSync = null;
  let expeditionPoll = null;
  let expeditionTicker = null;
  let expeditionNeedsArmy = false;
  let expeditionNeedsMap = false;
  let expeditionNewLand = false;
  let expeditionFirstRead = true;
  let expeditionPanelMode = null;
  let expeditionFocus = null;
  const expeditionActive = () => (expeditionRecord && expeditionRecord.status !== 'completed') || locationIsActive() || locationUncertain() || locationStorageError || locationConfirming;
  const expeditionNode = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function availableExpeditionUnit(type) {
    if (armyStale || !armyState()?.units) return null;
    const unit = armyState().units.find(row => row.unit_type === type);
    const available = Number(unit?.available);
    return unit?.available != null && Number.isSafeInteger(available) && available >= 0 ? available : null;
  }
  function updateExpeditionNotice() {
    element('expedition-notice-text').textContent = !expeditionReady
      ? 'État des expéditions indisponible. Nouvelle tentative automatique.'
      : locationUncertain() || locationStorageError ? 'Un départ doit être vérifié avant une nouvelle mission.'
      : locationIsActive() ? 'Une expédition vers un lieu est en cours.'
      : expeditionActive() ? 'Une expédition d’exploration est actuellement en cours.'
      : expeditionRecord ? 'Les éclaireurs sont revenus au domaine.'
      : 'Choisissez une zone inconnue à la frontière de vos terres découvertes.';
    element('expedition-view').hidden = !expeditionRecord && !locationRecord && !locationUncertain() && !locationStorageError;
    element('expedition-view').textContent = expeditionActive() ? 'Voir la mission' : 'Voir le dernier rapport';
    renderFrontierTargets();
  }
  function renderFrontierTargets() {
    const choice = resetMapChoice('armorique-frontier-choice', 'Choisir une zone autorisée');
    updateExpeditionControls();
    frontierLayer.replaceChildren();
    const map = element('armorique-map');
    if (!worldDiscoveries || !map.complete || !map.naturalWidth || !expeditionReady ||
        expeditionActive() || expeditionSending || expeditionNeedsArmy) return;
    const { columns, rows, cells } = worldDiscoveries;
    for (const [key, cell] of explorationFrontier) {
      if (cells.has(key)) continue;
      const button = expeditionNode('button', null, 'expedition-frontier-cell');
      button.type = 'button';
      button.dataset.frontierKey = key;
      button.dataset.column = cell.column_index;
      button.dataset.row = cell.row_index;
      button.setAttribute('aria-label', 'Explorer la zone inconnue, colonne ' + cell.column_index + ', ligne ' + cell.row_index);
      button.style.left = cell.column_index * 100 / columns + '%';
      button.style.top = cell.row_index * 100 / rows + '%';
      button.style.width = 100 / columns + '%';
      button.style.height = 100 / rows + '%';
      button.addEventListener('click', event => { event.stopPropagation(); prepareExpedition(cell, button); });
      frontierLayer.append(button);
      choice.add(new Option('Colonne ' + cell.column_index + ', ligne ' + cell.row_index, key));
    }
    choice.disabled = frontierLayer.children.length === 0;
  }
  async function loadExplorationFrontier() {
    const id = userId, gen = generation, request = ++frontierRequest;
    explorationFrontier.clear();
    renderFrontierTargets();
    if (!id || !domainId || !worldDiscoveries) return;
    try {
      const { data, error } = await supabase.rpc('get_my_exploration_frontier');
      if (userId !== id || generation !== gen || frontierRequest !== request) return;
      if (error || !Array.isArray(data) || !worldDiscoveries || data.length > worldDiscoveries.columns * worldDiscoveries.rows) throw new Error('frontier');
      const next = new Map(), ids = new Set();
      for (const cell of data) {
        const idValid = typeof cell?.cell_id === 'number' ? Number.isSafeInteger(cell.cell_id) && cell.cell_id > 0
          : typeof cell?.cell_id === 'string' && /^[1-9][0-9]*$/.test(cell.cell_id);
        if (!idValid || !Number.isInteger(cell.column_index) || !Number.isInteger(cell.row_index) ||
            cell.column_index < 0 || cell.column_index >= worldDiscoveries.columns ||
            cell.row_index < 0 || cell.row_index >= worldDiscoveries.rows) throw new Error('frontier');
        const key = cell.column_index + ',' + cell.row_index;
        if (next.has(key) || ids.has(String(cell.cell_id))) throw new Error('frontier');
        next.set(key, cell); ids.add(String(cell.cell_id));
      }
      explorationFrontier = next;
      expeditionMapMessage.textContent = '';
      renderFrontierTargets();
    } catch {
      if (userId === id && generation === gen && frontierRequest === request) {
        explorationFrontier.clear(); renderFrontierTargets();
        expeditionMapMessage.textContent = 'Destinations indisponibles pour le moment. Revenez sur la carte pour réessayer.';
      }
    }
  }
  async function refreshExpeditionMap() {
    const id = userId, gen = generation, request = ++expeditionMapRequest;
    explorationFrontier.clear(); renderFrontierTargets();
    if (!id || !domainId) return false;
    const before = worldDiscoveries?.cells.size;
    await loadWorldLocations(id, gen);
    if (userId !== id || generation !== gen || request !== expeditionMapRequest) return false;
    await loadWorldDomains(id, gen);
    await loadLocationTargets(id, gen);
    if (userId !== id || generation !== gen || request !== expeditionMapRequest) return false;
    if (worldDiscoveries && before != null && worldDiscoveries.cells.size > before) expeditionNewLand = true;
    await loadExplorationFrontier();
    return !!worldDiscoveries && !locationMessage.textContent;
  }
  function showExpeditionDialog(mode, focus) {
    expeditionPanelMode = mode;
    expeditionFocus = focus || document.activeElement;
    expeditionMessage.textContent = '';
    renderExpeditionPanel();
    if (!expeditionDialog.open) expeditionDialog.showModal();
  }
  function prepareExpedition(cell, focus) {
    if (!expeditionReady || expeditionActive() || expeditionSending || expeditionNeedsArmy || !worldDiscoveries ||
        worldDiscoveries.cells.has(cell.column_index + ',' + cell.row_index) ||
        explorationFrontier.get(cell.column_index + ',' + cell.row_index) !== cell) return;
    selectedDestination = cell;
    resetE1Preparation();
    destinationMarker.style.left = (cell.column_index + .5) * 100 / worldDiscoveries.columns + '%';
    destinationMarker.style.top = (cell.row_index + .5) * 100 / worldDiscoveries.rows + '%';
    destinationMarker.hidden = false;
    expeditionQuantities = new Map(expeditionUnits.map(unit => [unit.type, unit.type === 'scout' && availableExpeditionUnit('scout') > 0 ? 1 : 0]));
    showExpeditionDialog('prepare', focus);
  }
  function renderExpeditionPanel() {
    if (expeditionPanelMode?.startsWith('location-')) { renderLocationPanel(); return; }
    expeditionContent.replaceChildren();
    if (expeditionPanelMode === 'prepare' && !expeditionActive()) {
      element('expedition-title').textContent = 'Préparer l’expédition';
      const destination = expeditionNode('section', null, 'expedition-destination');
      destination.append(expeditionNode('p', 'Destination', 'expedition-eyebrow'), expeditionNode('h3', 'Terres inconnues'),
        expeditionNode('p', 'Zone inexplorée · Colonne ' + selectedDestination.column_index + ' / ligne ' + selectedDestination.row_index));
      const grid = expeditionNode('div', null, 'expedition-unit-grid');
      for (const unit of expeditionUnits) {
        const card = expeditionNode('article', null, 'expedition-unit'); card.dataset.expeditionUnit = unit.type;
        const available = expeditionNode('p'); available.append('Disponibles : ', expeditionNode('strong', '—')); available.lastChild.dataset.expeditionAvailable = unit.type;
        const selector = expeditionNode('div', null, 'expedition-quantity');
        const quantity = expeditionNode('output', '0'); quantity.dataset.expeditionQuantity = unit.type;
        quantity.setAttribute('aria-label', unit.name + ' envoyés');
        for (const delta of [-1, 1]) {
          const button = expeditionNode('button', delta < 0 ? '−' : '+'); button.type = 'button';
          button.dataset.expeditionStep = delta; button.dataset.unitType = unit.type;
          button.setAttribute('aria-label', (delta < 0 ? 'Retirer un ' : 'Ajouter un ') + ({ scout: 'éclaireur', infantry: 'fantassin', archer: 'archer' })[unit.type]);
          button.addEventListener('click', () => {
            const max = availableExpeditionUnit(unit.type);
            if (max == null || expeditionSending) return;
            expeditionQuantities.set(unit.type, Math.max(Math.min(unit.min, max), Math.min(max, expeditionQuantities.get(unit.type) + delta)));
            updateExpeditionControls();
          });
          selector.append(button);
          if (delta === -1) selector.append(quantity);
        }
        card.append(expeditionNode('h4', unit.name), expeditionNode('p', unit.role, 'expedition-unit-role'), available,
          expeditionNode('p', 'Quantité envoyée'), selector); grid.append(card);
      }
      const scope = expeditionNode('section', null, 'expedition-scope');
      scope.append(expeditionNode('p', 'Portée d’exploration'), expeditionNode('p', '', 'expedition-scope-dots'), expeditionNode('p'));
      scope.lastChild.id = 'expedition-scope-text';
      const send = expeditionNode('button', 'ENVOYER L’EXPÉDITION', 'expedition-send'); send.id = 'expedition-send'; send.type = 'button';
      send.addEventListener('click', sendExplorationExpedition);
      expeditionContent.append(destination, expeditionNode('h3', 'Composition de l’expédition', 'expedition-section-title'), grid, scope,
        Object.assign(expeditionNode('p', 'Calcul de la durée…', 'expedition-footnote'), { id: 'e1-preparation-duration' }),
        expeditionNode('p', 'Exploration géographique : aucune perte, aucun coût de départ. Une exploration accomplie offre 25 % de chance de rapporter une potion, au maximum une. Les troupes restent réservées jusqu’au retour.', 'expedition-footnote'), send);
      updateExpeditionControls();
    } else if (expeditionRecord) {
      expeditionPanelMode = 'tracking';
      const record = expeditionRecord;
      element('expedition-title').textContent = record.status === 'completed' ? 'Expédition terminée' : 'Expédition en cours';
      const destination = expeditionNode('section', null, 'expedition-destination');
      destination.append(expeditionNode('p', 'Destination', 'expedition-eyebrow'), expeditionNode('h3', 'Terres inconnues'),
        expeditionNode('p', 'Colonne ' + record.column_index + ' / ligne ' + record.row_index));
      const composition = expeditionNode('ul', null, 'expedition-composition');
      for (const [name, count] of [['Éclaireurs', record.scouts_sent], ['Fantassins', record.infantry_sent], ['Archers', record.archers_sent]]) composition.append(expeditionNode('li', count + ' ' + name.toLowerCase()));
      const status = expeditionNode('p', { outbound: 'En route vers les terres inconnues', returning: 'Retour vers le domaine', completed: 'Expédition terminée' }[record.status], 'expedition-status');
      const timeline = expeditionNode('section', null, 'expedition-timeline');
      const progress = document.createElement('progress'); progress.id = 'expedition-progress'; progress.max = 100; progress.setAttribute('aria-label', 'Progression du trajet');
      const stops = expeditionNode('div', null, 'expedition-stops');
      for (const [name, timestamp] of [['Départ', record.departed_at], ['Exploration', record.arrives_at], ['Retour', record.returns_at]]) {
        const time = expeditionNode('time', new Date(timestamp).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })); time.dateTime = timestamp;
        const stop = expeditionNode('div'); stop.append(expeditionNode('span', name), time); stops.append(stop);
      }
      const countdown = expeditionNode('p', '', 'expedition-footnote'); countdown.id = 'expedition-countdown';
      timeline.append(progress, stops, countdown);
      expeditionContent.append(destination, composition, status, timeline);
      if (record.status === 'completed') {
        const result = expeditionNode('section', null, 'expedition-result'); result.append(expeditionNode('p', 'Les éclaireurs sont revenus au domaine.'));
        if (record.exploration_rules_version === 2) {
          result.append(expeditionNode('p', record.new_cells_count + ' nouvelle' + (record.new_cells_count === 1 ? '' : 's') + ' cellule' + (record.new_cells_count === 1 ? '' : 's') + ' découverte' + (record.new_cells_count === 1 ? '' : 's') + '.'));
          result.append(expeditionNode('p', record.new_locations.length ? 'Lieux découverts : ' + record.new_locations.map(l => l.name).join(', ') + '.' : 'Aucun nouveau lieu découvert.'));
          result.append(expeditionNode('p', record.new_domains.length ? 'Domaines révélés : ' + record.new_domains.map(d => d.domain_name + ' · ' + d.player_name).join(', ') + '.' : 'Aucun nouveau domaine révélé.'));
        } else if (expeditionNewLand) result.append(expeditionNode('p', 'Nouvelles terres cartographiées.'));
        expeditionContent.append(result);
        void window.arvor.potionRewards?.renderFor(record.id, result);
      }
      updateExpeditionTimeline();
    }
  }
  function updateExpeditionControls() {
    updateLocationControls();
    if (expeditionPanelMode !== 'prepare' || !element('expedition-send')) return;
    let ready = true;
    for (const unit of expeditionUnits) {
      const available = availableExpeditionUnit(unit.type);
      if (available == null) ready = false;
      const requested = expeditionQuantities.get(unit.type) ?? 0;
      const value = available == null ? requested : Math.max(Math.min(unit.min, available), Math.min(available, requested));
      expeditionQuantities.set(unit.type, value);
      expeditionContent.querySelector('[data-expedition-available="' + unit.type + '"]').textContent = available ?? '—';
      expeditionContent.querySelector('[data-expedition-quantity="' + unit.type + '"]').textContent = value;
      for (const button of expeditionContent.querySelectorAll('[data-unit-type="' + unit.type + '"]')) button.disabled = expeditionSending || available == null ||
        (Number(button.dataset.expeditionStep) < 0 ? value <= unit.min : value >= available);
    }
    const scouts = expeditionQuantities.get('scout');
    requestE1Preparation(scouts);
    const count = e1Preparation?.max_cells ?? 0;
    element('expedition-scope-text').textContent = count ? scouts + ' éclaireur' + (scouts === 1 ? '' : 's') + ' · Jusqu’à ' + count + ' cellule' + (count === 1 ? '' : 's') + ' contiguë' + (count === 1 ? '' : 's') + '.'
      : scouts < 1 ? 'Un éclaireur au minimum est nécessaire.' : e1Preparation?.unavailable ? 'Préparation indisponible. Vérifiez l’installation de la migration E1 015, puis rouvrez la préparation.' : 'Calcul de la portée par le serveur…';
    element('e1-preparation-duration').textContent = count ? 'Durée totale estimée : ' + formatUpgradeDuration(e1Preparation.total_seconds) + ' · ' + formatUpgradeDuration(e1Preparation.travel_seconds) + ' par trajet. Confirmée au départ.' : 'Durée en attente du serveur.';
    expeditionContent.querySelector('.expedition-scope-dots').textContent = '●'.repeat(count) + '○'.repeat(4 - count);
    const selectedKey = selectedDestination && selectedDestination.column_index + ',' + selectedDestination.row_index;
    const destinationReady = selectedKey && worldDiscoveries && !worldDiscoveries.cells.has(selectedKey) &&
      explorationFrontier.get(selectedKey)?.cell_id === selectedDestination.cell_id;
    element('expedition-send').disabled = !ready || scouts < 1 || !destinationReady || !expeditionReady || !e1Preparation?.can_start ||
      expeditionSending || expeditionActive() || expeditionNeedsArmy || busy || loading || populationRefreshing || militaryChanging;
    element('expedition-send').textContent = expeditionSending ? 'DÉPART EN COURS…' : 'ENVOYER L’EXPÉDITION';
  }
  function updateExpeditionTimeline() {
    updateLocationTimeline();
    if (document.hidden) return;
    if (!expeditionRecord || !element('expedition-progress')) return;
    const record = expeditionRecord, now = Date.now();
    const departed = Date.parse(record.departed_at), arrival = Date.parse(record.arrives_at), returned = Date.parse(record.returns_at);
    const phaseStart = record.status === 'outbound' ? departed : arrival;
    const phaseEnd = record.status === 'outbound' ? arrival : returned;
    // Progression visuelle seulement : aucun changement d’état ni RPC à l’échéance locale.
    element('expedition-progress').value = record.status === 'completed' ? 100 :
      Math.max(record.status === 'returning' ? 50 : 0, Math.min(record.status === 'outbound' ? 50 : 100,
        (record.status === 'returning' ? 50 : 0) + 50 * (now - phaseStart) / (phaseEnd - phaseStart)));
    const seconds = Math.max(0, Math.ceil((phaseEnd - now) / 1000));
    element('expedition-countdown').textContent = record.status === 'completed' ? '' : seconds > 0
      ? (record.status === 'outbound' ? 'Arrivée dans ' : 'Retour dans ') + formatUpgradeDuration(seconds)
      : 'En attente de confirmation du serveur…';
  }
  function scheduleExpeditionPoll() {
    clearTimeout(expeditionPoll); expeditionPoll = null;
    if (userId && domainId && !document.hidden && (expeditionActive() || !expeditionReady || expeditionNeedsArmy || expeditionNeedsMap)) {
      expeditionPoll = setTimeout(() => { expeditionPoll = null; void synchronizeExpedition(); }, 15000);
    }
  }
  async function synchronizeExpedition() {
    if (!userId || !domainId || document.hidden || expeditionSending) return;
    if (expeditionSync) return expeditionSync;
    const id = userId, gen = generation;
    const current = () => userId === id && generation === gen;
    const task = (async () => {
      try {
        const { data, error } = await supabase.rpc('get_my_expedition');
        if (!current()) return;
        if (error) throw new Error('expedition');
        if (data && (!['outbound', 'returning', 'completed'].includes(data.status) || data.region_code !== 'finistere' ||
          ![data.departed_at, data.arrives_at, data.returns_at].every(t => typeof t === 'string' && Number.isFinite(Date.parse(t))) ||
          Date.parse(data.departed_at) >= Date.parse(data.arrives_at) || Date.parse(data.arrives_at) >= Date.parse(data.returns_at) ||
          ![data.scouts_sent, data.infantry_sent, data.archers_sent, data.column_index, data.row_index].every(n => Number.isSafeInteger(n) && n >= 0) || data.scouts_sent < 1)) throw new Error('expedition');
        if (data?.exploration_rules_version === 2 && (!Number.isSafeInteger(data.max_cells) || data.max_cells < 1 || data.max_cells > 4 ||
          (data.status !== 'outbound' && (!Number.isSafeInteger(data.new_cells_count) || data.new_cells_count < 0 || data.new_cells_count > data.max_cells)) ||
          !Array.isArray(data.new_locations) || !data.new_locations.every(l => typeof l.name === 'string' && typeof l.code === 'string') ||
          !Array.isArray(data.new_domains) || !data.new_domains.every(d => typeof d.domain_name === 'string' && typeof d.player_name === 'string'))) throw new Error('expedition');
        restoreLocationAttempt();
        await readLocationMission(current);
        if (!current()) return;
        const previous = expeditionRecord;
        const first = expeditionFirstRead;
        expeditionFirstRead = false;
        if (data && (!previous || previous.id !== data.id || previous.status !== data.status)) {
          expeditionNeedsArmy = true;
          if (data.status !== 'outbound') expeditionNeedsMap = true;
          if (previous?.id !== data.id) expeditionNewLand = false;
        }
        expeditionRecord = data;
        expeditionReady = true;
        if (expeditionMapMessage.textContent === 'Suivi indisponible pour le moment. Nouvelle tentative automatique.') expeditionMapMessage.textContent = '';
        if (expeditionActive()) { selectedDestination = null; destinationMarker.hidden = true; }
        if (expeditionNeedsMap) {
          const refreshed = await refreshExpeditionMap(); if (!current()) return;
          if (refreshed) expeditionNeedsMap = false;
        }
        if (expeditionNeedsArmy) {
          const refreshed = await refreshPopulation(); if (!current()) return;
          if (refreshed) expeditionNeedsArmy = false;
        }
        updateExpeditionNotice();
        updateExpeditionControls();
        if (expeditionDialog.open) {
          if (locationUncertain() || locationStorageError) expeditionPanelMode = 'location-pending';
          else if (locationIsActive()) expeditionPanelMode = 'location-tracking';
          else if (expeditionRecord?.status !== 'completed' && expeditionRecord) expeditionPanelMode = 'tracking';
          if (expeditionPanelMode !== 'prepare' && expeditionPanelMode !== 'location-prepare') renderExpeditionPanel();
          updateLocationControls();
        }
        if (first && data?.status === 'completed' && !armoriqueView.hidden && !locationRecord) showExpeditionDialog('tracking');
      } catch {
        if (current()) {
          expeditionReady = false;
          expeditionMapMessage.textContent = 'Suivi indisponible pour le moment. Nouvelle tentative automatique.';
          updateExpeditionNotice(); updateExpeditionControls();
        }
      } finally {
        if (current()) { expeditionSync = null; scheduleExpeditionPoll(); }
      }
    })();
    expeditionSync = task;
    return task;
  }
  function expeditionError(error) {
    const code = String(error?.message ?? '');
    for (const [key, text] of [
      ['TARGET_ALREADY_KNOWN', 'Cette zone est déjà découverte. Choisissez une autre destination.'],
      ['TARGET_NOT_ADJACENT', 'Cette destination est trop éloignée de vos terres découvertes.'],
      ['TARGET_WRONG_REGION', 'Cette destination n’est pas valide pour votre domaine.'],
      ['COMPOSITION_INVALID', 'Un éclaireur au minimum est nécessaire. Vérifiez la composition.'],
      ['NOT_ENOUGH_AVAILABLE_SOLDIERS', 'Vous ne disposez pas d’assez de soldats disponibles.'],
      ['ALREADY_ACTIVE', 'Une expédition est déjà en cours. Consultez son suivi.'],
      ['AUTH_REQUIRED', 'Votre session a expiré. Reconnectez-vous.'],
      ['GEOMETRY_NOT_READY', 'Les destinations ne sont pas disponibles pour le moment.'],
      ['REQUIRES_POSITION', 'Votre domaine ne possède pas encore de position sur la carte.']
    ]) if (code.includes(key)) return text;
    return 'Le départ n’a pas pu être confirmé. Le suivi sera resynchronisé avant toute nouvelle tentative.';
  }
  async function sendExplorationExpedition() {
    updateExpeditionControls();
    if (!element('expedition-send') || element('expedition-send').disabled) return;
    const id = userId, gen = generation, cell = selectedDestination;
    expeditionSending = true; updateExpeditionControls(); renderFrontierTargets();
    expeditionMessage.textContent = 'Préparation du départ…';
    try {
      const { data, error } = await supabase.rpc('start_exploration_expedition', {
        p_target_cell_id: cell.cell_id,
        p_infantry_qty: expeditionQuantities.get('infantry'),
        p_archer_qty: expeditionQuantities.get('archer'),
        p_scout_qty: expeditionQuantities.get('scout')
      });
      if (userId !== id || generation !== gen) return;
      if (error) throw error;
      if (!data?.expedition_id) throw new Error('response');
      expeditionPanelMode = 'tracking';
      expeditionNeedsArmy = true;
      expeditionMessage.textContent = 'Départ confirmé. Chargement du suivi…';
    } catch (error) {
      if (userId !== id || generation !== gen) return;
      expeditionMessage.textContent = expeditionError(error);
    } finally {
      if (userId === id && generation === gen) {
        expeditionSending = false;
        // Toute réponse incertaine impose une lecture serveur avant un nouveau départ.
        expeditionReady = false; updateExpeditionControls();
        await synchronizeExpedition();
        if (userId === id && generation === gen && expeditionRecord && expeditionActive()) {
          expeditionMessage.textContent = ''; renderExpeditionPanel();
        } else if (userId === id && generation === gen && expeditionPanelMode === 'tracking' && !expeditionRecord) {
          expeditionPanelMode = 'prepare'; renderExpeditionPanel();
          expeditionMessage.textContent = 'Le départ reste non confirmé. Veuillez réessayer après synchronisation.';
        }
        if (userId === id && generation === gen) updateExpeditionControls();
      }
    }
  }
  function clearExpedition() {
    resetE1Preparation();
    resetMapChoice('armorique-frontier-choice', 'Choisir une zone autorisée');
    clearLocationMission();
    frontierRequest++; expeditionMapRequest++;
    clearTimeout(expeditionPoll); clearInterval(expeditionTicker);
    expeditionPoll = null; expeditionTicker = null; expeditionSync = null;
    explorationFrontier.clear(); frontierLayer.replaceChildren();
    selectedDestination = null; destinationMarker.hidden = true;
    expeditionQuantities.clear(); expeditionRecord = null; expeditionReady = false;
    expeditionSending = false; expeditionNeedsArmy = false; expeditionNeedsMap = false;
    expeditionNewLand = false; expeditionFirstRead = true; expeditionPanelMode = null;
    if (expeditionDialog.open) expeditionDialog.close();
    expeditionContent.replaceChildren(); expeditionMessage.textContent = ''; expeditionMapMessage.textContent = '';
    element('expedition-view').hidden = true;
    element('expedition-notice-text').textContent = 'État des expéditions en cours de chargement…';
  }
  element('expedition-close').addEventListener('click', () => expeditionDialog.close());
  expeditionDialog.addEventListener('close', () => { if (expeditionFocus?.isConnected) expeditionFocus.focus({ preventScroll: true }); });
  element('expedition-view').addEventListener('click', () => openMissionReport());
  element('armorique-map').parentElement.addEventListener('click', event => {
    if (event.target.closest('.armorique-location-marker, .expedition-frontier-cell')) return;
    if (!worldDiscoveries || !expeditionReady || expeditionActive() || expeditionSending) return;
    const rect = element('armorique-map').getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / rect.width * worldDiscoveries.columns);
    const row = Math.floor((event.clientY - rect.top) / rect.height * worldDiscoveries.rows);
    const key = col + ',' + row, cell = explorationFrontier.get(key);
    if (cell) prepareExpedition(cell);
    else expeditionMapMessage.textContent = worldDiscoveries.cells.has(key) ? 'Cette zone est déjà découverte.' : 'Choisissez une zone inconnue à la frontière de vos terres découvertes.';
  });
  element('armorique-map').addEventListener('error', () => { explorationFrontier.clear(); frontierLayer.replaceChildren(); resetMapChoice('armorique-frontier-choice', 'Choisir une zone autorisée'); destinationMarker.hidden = true; });
  window.addEventListener('focus', () => { if (userId && domainId) { void synchronizeExpedition(); if (!armoriqueView.hidden) void loadExplorationFrontier(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(expeditionPoll); expeditionPoll = null; }
    else { void synchronizeExpedition(); if (!armoriqueView.hidden) void loadExplorationFrontier(); }
  });

  // E2 : lecture publique des cibles, préparation serveur et tentative durable.
  let locationTargets = new Map(), locationNames = new Map();
  let locationTargetsRequest = 0, locationPreparationRequest = 0, locationPreparationTimer = null;
  let locationSelected = null, locationPreparation = null, locationAvailability = null, locationPending = false;
  let locationQuantities = { infantry: 0, archers: 0, scouts: 1 };
  let locationRecord = null, locationAttempt = null, locationRestored = false;
  let locationConfirming = false, locationStorageError = false, locationDismissed = null;
  const locationUnits = [
    { key: 'infantry', name: 'Fantassins', min: 0 },
    { key: 'archers', name: 'Archers', min: 0 },
    { key: 'scouts', name: 'Éclaireurs', min: 1 }
  ];
  const locationIsActive = () => locationRecord && !['completed', 'destroyed'].includes(locationRecord.status);
  const locationUncertain = () => locationAttempt && ['pending', 'uncertain'].includes(locationAttempt.state);
  const locationAttemptKey = () => 'arvor:location-departure:v1:' + userId + ':' + domainId;
  const locationReportKey = () => locationAttemptKey() + ':closed-report';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function persistLocationAttempt(attempt) {
    // Ne pas envoyer si la sauvegarde durable échoue.
    localStorage.setItem(locationAttemptKey(), JSON.stringify(attempt));
    locationAttempt = attempt;
  }
  function restoreLocationAttempt() {
    if (locationRestored) return;
    locationRestored = true;
    try {
      locationDismissed = localStorage.getItem(locationReportKey());
      const raw = localStorage.getItem(locationAttemptKey());
      if (!raw) return;
      const a = JSON.parse(raw);
      if (a.user_id !== userId || a.domain_id !== domainId || !uuidPattern.test(a.request_id) ||
          !uuidPattern.test(a.location_id) || typeof a.code !== 'string' ||
          !['pending', 'uncertain', 'confirmed', 'rejected'].includes(a.state) ||
          !locationUnits.every(u => Number.isSafeInteger(a.composition?.[u.key]) &&
            a.composition[u.key] >= u.min && a.composition[u.key] <= 1000000)) throw new Error('attempt');
      locationAttempt = a;
    } catch { locationStorageError = true; }
  }
  async function loadLocationTargets(id, gen) {
    const request = ++locationTargetsRequest;
    locationTargets.clear();
    try {
      const { data, error } = await supabase.rpc('get_my_location_expedition_targets');
      if (userId !== id || generation !== gen || request !== locationTargetsRequest) return;
      if (error || !Array.isArray(data)) throw new Error('targets');
      const next = new Map();
      for (const row of data) {
        if (!row || typeof row.code !== 'string' || !row.code || !uuidPattern.test(row.location_id) ||
            next.has(row.code) || Object.keys(row).some(k => !['code', 'location_id'].includes(k))) throw new Error('target');
        next.set(row.code, row.location_id);
      }
      locationTargets = next;
    } catch {
      if (userId === id && generation === gen && request === locationTargetsRequest)
        locationMessage.textContent = 'Préparation des expéditions vers les lieux indisponible.';
    }
  }
  function openLocationPreparation(location, focus) {
    if (locationUncertain() || locationStorageError) { showExpeditionDialog('location-pending', focus); return; }
    if (!expeditionReady || expeditionActive() || expeditionSending) { openMissionReport(focus); return; }
    if (!locationTargets.has(location.code)) return;
    locationSelected = { ...location, location_id: locationTargets.get(location.code) };
    locationAvailability = null;
    locationQuantities = { infantry: 0, archers: 0, scouts: 1 };
    locationPreparation = null;
    showExpeditionDialog('location-prepare', focus);
    queueLocationPreparation();
  }
  function locationBlockingText(p) {
    const labels = {
      EXPEDITION_ACTIVE: 'Une mission est déjà active.',
      DEPARTURE_COOLDOWN: 'Délai entre deux départs en cours.',
      LOCATION_COOLDOWN: 'Ce lieu doit encore attendre avant une nouvelle tentative.',
      NOT_ENOUGH_AVAILABLE_SOLDIERS: 'Soldats disponibles insuffisants.',
      COMPOSITION_REQUIRED: 'Choisissez une composition.'
    };
    let text = labels[p?.blocking_reason] || (p?.can_start ? 'Départ autorisé par le serveur.' : 'Départ indisponible.');
    if (p?.blocking_reason?.includes('COOLDOWN')) {
      const at = p.blocking_reason === 'LOCATION_COOLDOWN' ? p.next_location_attempt_at : p.next_departure_at;
      if (Number.isFinite(Date.parse(at))) text += ' Disponible le ' + new Date(at).toLocaleString('fr-FR') + '.';
    }
    return text;
  }
  function queueLocationPreparation() {
    clearTimeout(locationPreparationTimer);
    const request = ++locationPreparationRequest, id = userId, gen = generation;
    const selected = locationSelected, composition = { ...locationQuantities };
    locationPreparation = null; locationPending = true;
    renderLocationPanel();
    locationPreparationTimer = setTimeout(async () => {
      locationPreparationTimer = null;
      try {
        const { data, error } = await supabase.rpc('get_location_expedition_preparation', {
          p_location_id: selected.location_id, p_infantry_qty: composition.infantry,
          p_archer_qty: composition.archers, p_scout_qty: composition.scouts
        });
        if (request !== locationPreparationRequest || userId !== id || generation !== gen) return;
        if (error || data?.location_id !== selected.location_id ||
            !locationUnits.every(u => Number.isSafeInteger(data.available?.[u.key]) && data.available[u.key] >= 0) ||
            !['INSUFFISANTE', 'RISQUÉE', 'ADAPTÉE', 'SUPÉRIEURE'].includes(data.assessment) ||
            ![data.travel_seconds, data.stay_seconds, data.total_seconds].every(n => Number.isFinite(n) && n >= 0) ||
            typeof data.can_start !== 'boolean') throw new Error('preparation');
        locationPreparation = data;
        locationAvailability = { ...data.available };
        expeditionMessage.textContent = '';
      } catch {
        if (request === locationPreparationRequest && userId === id && generation === gen)
          expeditionMessage.textContent = 'Préparation indisponible. Réessayez sans lancer de départ.';
      } finally {
        if (request === locationPreparationRequest && userId === id && generation === gen) {
          locationPending = false;
          if (expeditionPanelMode === 'location-prepare') renderLocationPanel();
        }
      }
    }, 300);
  }
  function locationCanSend() {
    return locationPreparation?.can_start === true && !locationPending && !locationConfirming &&
      !expeditionSending && expeditionReady && !expeditionActive() && !locationUncertain() &&
      !locationStorageError && !busy && !loading && !populationRefreshing && !militaryChanging &&
      locationUnits.every(u => locationQuantities[u.key] >= u.min &&
        locationQuantities[u.key] <= locationPreparation.available[u.key]);
  }
  function updateLocationControls() {
    const button = element('location-send');
    if (button) button.disabled = !locationCanSend();
  }
  function openMissionReport(focus) {
    if (!expeditionReady && !locationUncertain() && !locationStorageError && !locationRecord && !expeditionRecord) {
      expeditionMapMessage.textContent = 'Suivi indisponible. Nouvelle tentative automatique.';
      void synchronizeExpedition(); return;
    }
    showExpeditionDialog(locationUncertain() || locationStorageError ? 'location-pending'
      : locationIsActive() || (locationRecord && (!expeditionRecord ||
        Date.parse(locationRecord.departed_at) >= Date.parse(expeditionRecord.departed_at))) ? 'location-tracking' : 'tracking', focus);
  }
  function renderLocationPanel() {
    expeditionContent.replaceChildren();
    const add = (tag, text, cls) => expeditionNode(tag, text, cls);
    if (expeditionPanelMode === 'location-pending') {
      element('expedition-title').textContent = 'Vérifier le départ';
      expeditionContent.append(add('p', locationStorageError
        ? 'La sauvegarde locale de la tentative est illisible ou indisponible. Aucun nouveau départ ne sera envoyé.'
        : 'Le départ reste incertain. La reprise utilise exactement la même demande et la même composition.'));
      if (locationAttempt) {
        expeditionContent.append(add('h3', locationAttempt.name || locationAttempt.code));
        const retry = add('button', 'Vérifier / reprendre le même départ');
        retry.id = 'location-retry'; retry.type = 'button'; retry.disabled = expeditionSending || locationStorageError || !locationUncertain();
        retry.addEventListener('click', () => void sendLocationAttempt());
        expeditionContent.append(retry);
      }
      const read = add('button', 'Actualiser le suivi'); read.type = 'button';
      read.addEventListener('click', () => void synchronizeExpedition()); expeditionContent.append(read);
      return;
    }
    if (expeditionPanelMode === 'location-prepare' && locationSelected) {
      element('expedition-title').textContent = 'Expédition vers un lieu';
      const destination = add('section', null, 'expedition-destination');
      destination.append(add('p', 'Lieu déjà découvert', 'expedition-eyebrow'),
        add('h3', locationSelected.name), add('p', locationSelected.location_type + ' · Danger ' +
          ['I', 'II', 'III'][locationSelected.danger_level - 1]));
      const grid = add('div', null, 'expedition-unit-grid');
      for (const unit of locationUnits) {
        const card = add('article', null, 'expedition-unit');
        const available = locationPreparation?.available[unit.key] ?? locationAvailability?.[unit.key] ??
          availableExpeditionUnit({ infantry: 'infantry', archers: 'archer', scouts: 'scout' }[unit.key]);
        card.append(add('h4', unit.name), add('p', 'Disponibles : ' + (available ?? '—')));
        const selector = add('div', null, 'expedition-quantity');
        const output = add('output', String(locationQuantities[unit.key]));
        output.dataset.locationQuantity = unit.key;
        for (const delta of [-1, 1]) {
          const b = add('button', delta < 0 ? '−' : '+'); b.type = 'button';
          b.dataset.locationUnit = unit.key; b.dataset.step = delta;
          b.setAttribute('aria-label', (delta < 0 ? 'Réduire les ' : 'Ajouter des ') + unit.name.toLowerCase());
          b.disabled = locationConfirming || expeditionSending || available == null ||
            (delta < 0 ? locationQuantities[unit.key] <= unit.min : locationQuantities[unit.key] >= Math.min(available, 1000000));
          b.addEventListener('click', () => {
            locationQuantities[unit.key] = Math.max(unit.min, Math.min(available, 1000000, locationQuantities[unit.key] + delta));
            queueLocationPreparation();
          });
          selector.append(b); if (delta < 0) selector.append(output);
        }
        card.append(selector); grid.append(card);
      }
      expeditionContent.append(destination, grid, add('p', 'Un éclaireur au minimum est requis.', 'expedition-footnote'));
      const p = locationPreparation;
      const assessment = add('p', locationPending ? 'Évaluation serveur en cours…' : p?.assessment || 'Évaluation indisponible', 'expedition-status');
      assessment.id = 'location-assessment'; expeditionContent.append(assessment);
      if (p) expeditionContent.append(add('p', 'Trajet : ' + formatUpgradeDuration(p.travel_seconds) +
        ' · Séjour : ' + formatUpgradeDuration(p.stay_seconds) + ' · Durée totale : ' + formatUpgradeDuration(p.total_seconds)),
        add('p', locationBlockingText(p), 'expedition-footnote'));
      const retry = add('button', 'Actualiser la préparation'); retry.type = 'button';
      retry.disabled = locationConfirming || expeditionSending;
      retry.addEventListener('click', queueLocationPreparation);
      const send = add('button', 'Lancer l’expédition', 'expedition-send'); send.id = 'location-send'; send.type = 'button';
      send.addEventListener('click', () => void confirmLocationDeparture());
      expeditionContent.append(add('p', 'Une victoire offre 50 % de chance de rapporter une potion, au maximum une, en plus du butin existant.', 'expedition-footnote'), retry, send); updateLocationControls(); return;
    }
    const r = locationRecord;
    if (!r) { expeditionContent.append(add('p', 'Suivi en cours de chargement…')); return; }
    element('expedition-title').textContent = 'Expédition vers un lieu';
    const name = [...locationTargets].find(([, id]) => id === r.location_id)?.[0];
    expeditionContent.append(add('h3', locationNames.get(name)?.name ||
      (locationAttempt?.location_id === r.location_id ? locationAttempt.name : null) || 'Lieu découvert'));
    const composition = add('ul', null, 'expedition-composition');
    for (const u of locationUnits) composition.append(add('li', (r.composition?.[u.key] ?? '—') + ' ' + u.name.toLowerCase()));
    const status = { outbound: 'EN ROUTE', on_site: 'SUR PLACE', returning: 'RETOUR', completed: 'TERMINÉE', destroyed: 'EXPÉDITION PERDUE' };
    expeditionContent.append(composition, add('p', status[r.status], 'expedition-status'));
    const counter = add('p', '', 'expedition-footnote'); counter.id = 'location-countdown'; expeditionContent.append(counter);
    if (r.outcome) expeditionContent.append(add('h4', { success: 'VICTOIRE', failure: 'ÉCHEC', retreat: 'RETRAITE', destroyed: 'DESTRUCTION' }[r.outcome] || 'Résultat confirmé'));
    if (r.resolved_at) {
      const result = add('section', null, 'expedition-result');
      for (const u of locationUnits) result.append(add('p', u.name + ' — Pertes : ' +
        (r.losses?.[u.key] ?? '—') + ' · Survivants : ' + (r.survivors?.[u.key] ?? '—')));
      result.append(add('p', 'Prestige attribué : ' + (r.prestige_awarded ?? 0)));
      const returned = r.status === 'completed';
      result.append(add('p', returned ? 'Butin au retour' : r.status === 'destroyed'
        ? 'Aucun retour : expédition perdue.' : 'Butin transporté — ressources non créditées'));
      for (const [key, label] of [['food', 'Vivres'], ['wood', 'Bois'], ['stone', 'Pierre'], ['iron', 'Fer'], ['coins', 'Pièces']]) {
        const loot = r.loot?.[key]; if (!loot) continue;
        result.append(add('p', label + ' — Obtenu : ' + loot.obtained +
          (returned ? ' · Stocké : ' + (loot.stored ?? '—') + ' · Excédent : ' + (loot.excess ?? '—') : '')));
      }
      expeditionContent.append(result);
      void window.arvor.potionRewards?.renderFor(r.expedition_id, result);
    }
    if (!locationIsActive()) {
      const close = add('button', 'Fermer le rapport'); close.type = 'button';
      close.addEventListener('click', () => {
        locationDismissed = r.expedition_id;
        try { localStorage.setItem(locationReportKey(), locationDismissed); } catch { /* Le rapport reste consultable. */ }
        expeditionDialog.close(); updateExpeditionNotice();
      }); expeditionContent.append(close);
    }
    updateLocationTimeline();
  }
  function updateLocationTimeline() {
    if (document.hidden || !locationRecord || !element('location-countdown')) return;
    const r = locationRecord, next = { outbound: r.arrives_at, on_site: r.planned_resolution_at, returning: r.returns_at }[r.status];
    const seconds = Math.max(0, Math.ceil((Date.parse(next) - Date.now()) / 1000));
    element('location-countdown').textContent = !locationIsActive() ? '' : seconds > 0
      ? ({ outbound: 'Arrivée dans ', on_site: 'Résolution dans ', returning: 'Retour dans ' }[r.status]) + formatUpgradeDuration(seconds)
      : 'En attente de confirmation du serveur…';
  }
  async function confirmLocationDeparture() {
    if (!locationCanSend()) return;
    const id = userId, gen = generation, selected = { ...locationSelected };
    const composition = { ...locationQuantities }, p = locationPreparation;
    locationConfirming = true; renderLocationPanel();
    try {
      const accepted = await requestConfirmation({
        title: 'Lancer l’expédition vers ' + selected.name + ' ?',
        text: composition.infantry + ' Fantassins · ' + composition.archers + ' Archers · ' +
          composition.scouts + ' Éclaireurs. Évaluation serveur : ' + p.assessment + '.',
        confirmLabel: 'Lancer l’expédition'
      });
      if (!accepted || userId !== id || generation !== gen || locationIsActive() ||
          (expeditionRecord && expeditionRecord.status !== 'completed') || locationUncertain()) return;
      persistLocationAttempt({ user_id: id, domain_id: domainId, request_id: crypto.randomUUID(),
        location_id: selected.location_id, code: selected.code, name: selected.name, composition,
        state: 'pending', created_at: new Date().toISOString(), expedition_id: null });
      await sendLocationAttempt();
    } catch {
      if (userId === id && generation === gen) expeditionMessage.textContent = 'Sauvegarde de la tentative impossible. Aucun départ supplémentaire envoyé.';
    } finally {
      if (userId === id && generation === gen) {
        locationConfirming = false;
        if (expeditionPanelMode === 'location-prepare') renderLocationPanel();
        updateExpeditionNotice(); updateLocationControls();
      }
    }
  }
  async function sendLocationAttempt() {
    if (!locationAttempt || expeditionSending || locationStorageError) return;
    const id = userId, gen = generation, a = locationAttempt;
    expeditionSending = true; renderFrontierTargets(); renderLocationPanel();
    expeditionMessage.textContent = 'Vérification du départ…';
    try {
      const { data, error } = await supabase.rpc('start_location_expedition', {
        p_location_id: a.location_id, p_infantry_qty: a.composition.infantry,
        p_archer_qty: a.composition.archers, p_scout_qty: a.composition.scouts, p_request_id: a.request_id
      });
      if (userId !== id || generation !== gen) return;
      if (error) {
        // Seul un refus explicite serveur est certain ; transport/5xx reste incertain.
        const rejected = error.code === 'P0001' && /^ARVOR_/.test(error.message || '');
        persistLocationAttempt({ ...a, state: rejected ? 'rejected' : 'uncertain' });
        locationPreparation = null;
        expeditionPanelMode = rejected && locationSelected ? 'location-prepare' : 'location-pending';
        expeditionMessage.textContent = rejected ? expeditionError(error) : 'Réponse incertaine. Reprenez le même départ pour le vérifier.';
      } else {
        if (!uuidPattern.test(data?.expedition_id) || data.location_id !== a.location_id ||
            !locationUnits.every(u => data.composition?.[u.key] === a.composition[u.key])) throw new Error('response');
        persistLocationAttempt({ ...a, state: 'confirmed', expedition_id: data.expedition_id,
          departed_at: data.departed_at, arrives_at: data.arrives_at, planned_resolution_at: data.planned_resolution_at,
          planned_returns_at: data.planned_returns_at });
        expeditionPanelMode = 'location-tracking';
        expeditionNeedsArmy = true;
        expeditionMessage.textContent = 'Départ confirmé. Chargement du suivi…';
      }
    } catch {
      if (userId === id && generation === gen) {
        try { persistLocationAttempt({ ...a, state: 'uncertain' }); } catch { locationStorageError = true; }
        expeditionPanelMode = 'location-pending';
        expeditionMessage.textContent = 'Réponse incertaine. Aucun nouveau départ ne sera créé automatiquement.';
      }
    } finally {
      if (userId === id && generation === gen) {
        expeditionSending = false; expeditionReady = false;
        renderLocationPanel(); await synchronizeExpedition(); updateLocationControls();
      }
    }
  }
  async function readLocationMission(current) {
    const { data, error } = await supabase.rpc('get_my_location_expedition');
    if (!current()) return;
    if (error || (data && (!uuidPattern.test(data.expedition_id) ||
        !['outbound', 'on_site', 'returning', 'completed', 'destroyed'].includes(data.status) ||
        data.expedition_type !== 'location' || !uuidPattern.test(data.location_id) ||
        !locationUnits.every(u => Number.isSafeInteger(data.composition?.[u.key]) && data.composition[u.key] >= u.min) ||
        ![data.departed_at, data.arrives_at, data.planned_resolution_at, data.returns_at].every(t => Number.isFinite(Date.parse(t))))))
      throw new Error('location-mission');
    const previous = locationRecord;
    if (data && (!previous || previous.expedition_id !== data.expedition_id ||
        previous.status !== data.status || previous.outcome !== data.outcome)) expeditionNeedsArmy = true;
    locationRecord = data;
    // Une lecture seule ne confirme jamais une tentative incertaine par ressemblance.
  }
  function clearLocationMission() {
    locationTargetsRequest++; locationPreparationRequest++;
    clearTimeout(locationPreparationTimer); locationPreparationTimer = null;
    locationTargets.clear(); locationNames.clear(); locationSelected = null; locationPreparation = null; locationAvailability = null;
    locationRecord = null; locationAttempt = null; locationRestored = false; locationPending = false;
    locationConfirming = false; locationStorageError = false; locationDismissed = null;
  }
  let userId = null;
  let busy = true;
  let loading = false;
  let generation = 0;

  // SOCIAL 2A : lectures publiques minimales, aucune donnée Auth dans le panneau.
  const socialDialog = element('player-profile-dialog');
  let socialProfileRequest = 0;
  let socialSearchRequest = 0;
  function clearSocial() {
    socialProfileRequest++;
    socialSearchRequest++;
    if (socialDialog.open) socialDialog.close();
    element('player-search-input').value = '';
    element('player-search-results').replaceChildren();
    element('player-search-message').textContent = '';
    element('player-profile-message').textContent = '';
    element('player-profile-details').hidden = true;
    element('public-title').textContent = '';
    element('public-title').hidden = true;
    for (const id of ['public-username', 'public-domain', 'public-stage', 'public-power', 'public-joined'])
      element(id).textContent = '';
    element('player-search-submit').disabled = false;
  }
  async function loadSocialProfile(playerId) {
    if (!userId || !socialDialog.open) return;
    const id = userId, gen = generation, request = ++socialProfileRequest;
    const current = () => userId === id && generation === gen &&
      request === socialProfileRequest && socialDialog.open;
    element('player-profile-details').hidden = true;
    element('public-title').textContent = '';
    element('public-title').hidden = true;
    element('player-profile-message').textContent = 'Profil en cours de chargement…';
    try {
      const { data, error } = await supabase.rpc('get_player_profile', { p_player_id: playerId });
      if (!current()) return;
      if (error || !Array.isArray(data) || data.length > 1) throw new Error('profile');
      if (!data.length) {
        element('player-profile-message').textContent = 'Joueur introuvable.';
        return;
      }
      const profile = data[0];
      if (profile.player_id !== playerId || typeof profile.username !== 'string') throw new Error('profile');
      const stages = { hamlet: 'Hameau', village: 'Village', bourg: 'Bourg', town: 'Ville', city: 'Cité' };
      element('public-username').textContent = profile.username;
      const publicTitle = typeof profile.public_title === 'string' ? profile.public_title.trim() : '';
      element('public-title').textContent = publicTitle;
      element('public-title').hidden = !publicTitle;
      element('public-domain').textContent = profile.domain_name ?? 'Aucun domaine';
      element('public-stage').textContent = stages[profile.stage] ?? '—';
      element('public-power').textContent = profile.power == null ? '—' : Number(profile.power).toLocaleString('fr-FR');
      const date = /^\d{4}-\d{2}-\d{2}$/.test(profile.joined_on)
        ? new Date(profile.joined_on + 'T00:00:00Z') : null;
      element('public-joined').textContent = date && Number.isFinite(date.getTime())
        ? 'Arrivé en Armorique le ' + date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        : 'Date d’arrivée indisponible';
      element('player-profile-message').textContent = '';
      element('player-profile-details').hidden = false;
    } catch {
      if (current()) element('player-profile-message').textContent = 'Profil indisponible pour le moment. Réessayez.';
    }
  }
  function openOwnProfile() {
    if (!userId || !supabase) return;
    if (!socialDialog.open) { clearSocial(); socialDialog.showModal(); }
    loadSocialProfile(userId);
  }
  async function searchPlayers(event) {
    event.preventDefault();
    if (!userId || !supabase || !socialDialog.open) return;
    const query = element('player-search-input').value.trim();
    const id = userId, gen = generation, request = ++socialSearchRequest;
    const current = () => userId === id && generation === gen &&
      request === socialSearchRequest && socialDialog.open;
    element('player-search-results').replaceChildren();
    element('player-search-message').textContent = '';
    if (!query) return;
    element('player-search-submit').disabled = true;
    element('player-search-message').textContent = 'Recherche en cours…';
    try {
      const { data, error } = await supabase.rpc('search_players', { p_query: query });
      if (!current()) return;
      if (error) {
        if (String(error.message).includes('ARVOR_SEARCH_RATE_LIMIT')) {
          element('player-search-message').textContent = 'Trop de recherches rapprochées. Patientez une minute avant de réessayer.';
          return;
        }
        throw new Error('search');
      }
      if (!Array.isArray(data) || data.length > 10 ||
          data.some(p => typeof p.player_id !== 'string' || typeof p.username !== 'string')) throw new Error('search');
      for (const player of data) {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = player.username;
        button.addEventListener('click', () => loadSocialProfile(player.player_id));
        item.append(button);
        element('player-search-results').append(item);
      }
      element('player-search-message').textContent = data.length ? '' : 'Aucun joueur trouvé.';
    } catch {
      if (current()) element('player-search-message').textContent = 'Recherche indisponible pour le moment. Réessayez.';
    } finally {
      if (current()) element('player-search-submit').disabled = false;
    }
  }
  element('show-player-profile').addEventListener('click', openOwnProfile);
  element('show-own-profile').addEventListener('click', () => loadSocialProfile(userId));
  element('player-profile-close').addEventListener('click', () => socialDialog.close());
  socialDialog.addEventListener('close', () => { if (!socialDialog.open) clearSocial(); });
  element('player-search-form').addEventListener('submit', searchPlayers);
  element('player-search-input').addEventListener('input', () => {
    // Une réponse pour un ancien texte ne doit jamais repeupler les résultats.
    socialSearchRequest++;
    element('player-search-results').replaceChildren();
    element('player-search-message').textContent = '';
    element('player-search-submit').disabled = false;
  });

  const buildingList = element('building-list');
  const buildingMessage = element('building-message');
  // Ces valeurs servent uniquement à l’affichage, jamais au débit des ressources.
  const buildingCatalog = [
    { type: 'farm', name: 'Ferme', cost: [[100, 'bois'], [50, 'pierre']], production: 60, resource: 'vivres' },
    { type: 'sawmill', name: 'Scierie', cost: [[100, 'vivres'], [50, 'pierre']], production: 50, resource: 'bois' },
    { type: 'quarry', name: 'Carrière', cost: [[100, 'vivres'], [75, 'bois']], production: 40, resource: 'pierre' },
    { type: 'mine', name: 'Mine', cost: [[150, 'vivres'], [100, 'bois'], [100, 'pierre']], production: 20, resource: 'fer' },
    { type: 'granary', name: 'Grenier', cost: [[100, 'bois'], [75, 'pierre']], description: 'Augmente la capacité de stockage des vivres.' },
    { type: 'warehouse', name: 'Entrepôt', cost: [[150, 'bois'], [100, 'pierre']], description: 'Augmente la capacité de stockage du bois, de la pierre et du fer.' }
  ];
  let domainId = null;
  let builtLevels = new Map();
  let buildingsReady = false;
  let constructing = false;
  let upgradeJobs = new Map();
  let constructionJobs = new Map();
  let upgradeTimer = null;
  let countdownNodes = new Map();
  let completing = false;
  let completionRetryAt = 0;
  let populationState = null;
  let developmentState = null;
  let populationTimer = null;
  let populationRefreshing = false;
  let potionPopulationRefreshPending = false;
  let marketPopulationRefreshPending = false;
  let workersChanging = false;
  let workforceStale = false;
  const armyList = element('army-list');
  const armyMessage = element('army-message');
  const recruitmentList = element('recruitment-list');
  let militaryChanging = false;
  let armyStale = false;
  let armyTimer = null;
  let armyRetryAt = 0;
  let armyClockOffset = 0;
  let armyCountdownNodes = [];
  const armyQuantities = new Map();

  const confirmationDialog = element('confirmation-dialog');
  let confirmationResolve = null;
  // Confirmation générique : contenu textuel, résultat asynchrone, aucun effet métier.
  function requestConfirmation({ title, text, confirmLabel = 'Confirmer' }) {
    if (confirmationResolve) return Promise.resolve(false);
    element('confirmation-title').textContent = title;
    element('confirmation-text').textContent = text;
    element('confirmation-accept').textContent = confirmLabel;
    confirmationDialog.returnValue = '';
    return new Promise(resolve => {
      confirmationResolve = resolve;
      confirmationDialog.showModal();
    });
  }
  element('confirmation-cancel').addEventListener('click', () => confirmationDialog.close('cancel'));
  element('confirmation-accept').addEventListener('click', () => confirmationDialog.close('confirm'));
  confirmationDialog.addEventListener('close', () => {
    const resolve = confirmationResolve;
    confirmationResolve = null;
    resolve?.(confirmationDialog.returnValue === 'confirm');
  });

  function armyState() { return populationState?.army ?? null; }
  function stopArmyTimer() {
    if (armyTimer !== null) clearInterval(armyTimer);
    armyTimer = null;
  }
  function renderArmy() {
    stopArmyTimer();
    armyCountdownNodes = [];
    armyList.replaceChildren();
    recruitmentList.replaceChildren();
    const army = armyState();
    element('army-soldiers').textContent = army?.soldiers ?? '—';
    element('army-recruits').textContent = army?.recruits ?? '—';
    element('army-available').textContent = populationState?.population_available ?? '—';
    for (const type of ['infantry', 'archer', 'scout']) {
      const unit = army?.units?.find(row => row.unit_type === type);
      element(`army-count-${type}`).textContent = unit?.quantity ?? (army ? 0 : '—');
    }
    if (!army || !Array.isArray(army.units) || !Array.isArray(army.recruitment_queue)) {
      armyMessage.textContent = 'État de l’armée indisponible.';
      return;
    }
    if (armyMessage.textContent === 'État de l’armée indisponible.') armyMessage.textContent = '';
    const serverNow = Date.parse(army.server_now);
    window.arvor?.domainAmbience?.syncServerTime(army.server_now);
    armyClockOffset = Number.isFinite(serverNow) ? serverNow - Date.now() : 0;
    for (const unit of army.units) {
      const type = unit.unit_type;
      const card = document.createElement('article');
      card.className = 'building-card army-card';
      card.dataset.unitType = type;
      const title = document.createElement('h4');
      title.textContent = unit.display_name;
      const owned = document.createElement('p');
      owned.textContent = `${unit.quantity} ${Number(unit.quantity) > 1 ? 'soldats' : 'soldat'}`;
      const stats = document.createElement('p');
      stats.textContent = `Attaque : ${unit.attack}`;
      const defense = document.createElement('p');
      defense.textContent = `Défense : ${unit.defense}`;
      const costs = document.createElement('p');
      costs.textContent = 'Coût :';
      for (const [key, name] of [['food', 'nourriture'], ['wood', 'bois'], ['stone', 'pierre'], ['iron', 'fer']]) {
        if (Number(unit[`cost_${key}`]) > 0) costs.append(document.createElement('br'), `${unit[`cost_${key}`]} ${name}`);
      }
      const duration = document.createElement('p');
      duration.textContent = `Formation : ${formatUpgradeDuration(Number(unit.training_seconds))}`;
      const label = document.createElement('label');
      label.htmlFor = `army-quantity-${type}`;
      label.textContent = 'Quantité';
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.type = 'number'; input.min = '1'; input.max = '100'; input.step = '1';
      input.inputMode = 'numeric';
      input.value = String(Math.max(1, Math.min(100, Number(armyQuantities.get(type) ?? 1))));
      input.addEventListener('input', () => {
        armyQuantities.set(type, input.value);
        updateControls();
      });
      const selector = document.createElement('div');
      selector.className = 'workforce-controls army-quantity';
      const steps = [-1, 1].map(delta => {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = delta < 0 ? '−' : '+';
        button.dataset.militaryAction = 'quantity'; button.dataset.unitType = type;
        button.dataset.delta = String(delta);
        button.setAttribute('aria-label', `${delta < 0 ? 'Diminuer' : 'Augmenter'} la quantité : ${unit.display_name}`);
        button.addEventListener('click', () => {
          if (input.disabled) return;
          const value = Number(input.value);
          input.value = String(Math.max(1, Math.min(100, (Number.isInteger(value) ? value : 1) + delta)));
          input.dispatchEvent(new Event('input'));
        });
        return button;
      });
      selector.append(steps[0], input, steps[1]);
      const recruit = document.createElement('button');
      recruit.type = 'button'; recruit.textContent = 'Recruter';
      recruit.dataset.militaryAction = 'recruit'; recruit.dataset.unitType = type;
      recruit.setAttribute('aria-label', `Recruter : ${unit.display_name}`);
      recruit.addEventListener('click', () => changeMilitary(type, false));
      card.append(title, owned, stats, defense, costs, duration, label, selector, recruit);
      if (Number(unit.quantity) > 0) {
        const demobilize = document.createElement('button');
        demobilize.type = 'button'; demobilize.textContent = 'Démobiliser';
        demobilize.dataset.militaryAction = 'demobilize'; demobilize.dataset.unitType = type;
        demobilize.setAttribute('aria-label', `Démobiliser : ${unit.display_name}`);
        demobilize.addEventListener('click', () => changeMilitary(type, true));
        card.append(demobilize);
      }
      armyList.append(card);
    }
    for (const entry of army.recruitment_queue) {
      const row = document.createElement('li');
      const label = document.createElement('span'); label.textContent = entry.display_name;
      const countdown = document.createElement('span');
      armyCountdownNodes.push({ node: countdown, finishesAt: Date.parse(entry.finishes_at) });
      row.append(label, countdown); recruitmentList.append(row);
    }
    if (!army.recruitment_queue.length) {
      const empty = document.createElement('li'); empty.textContent = 'Aucune formation en cours.';
      recruitmentList.append(empty);
    } else armyTimer = setInterval(updateArmyCountdowns, 1000);
    updateArmyCountdowns();
  }
  function formatArmyCountdown(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, '0');
    return `${String(minutes).padStart(2, '0')}:${remainder}`;
  }
  function updateArmyCountdowns() {
    const now = Date.now();
    let due = false;
    for (const { node, finishesAt } of armyCountdownNodes) {
      if (!Number.isFinite(finishesAt)) { node.textContent = 'Échéance indisponible'; continue; }
      const seconds = Math.max(0, Math.ceil((finishesAt - now - armyClockOffset) / 1000));
      node.textContent = seconds ? formatArmyCountdown(seconds) : 'Finalisation en cours…';
      if (!seconds) due = true;
    }
    if (due && now >= armyRetryAt && !busy && !loading && !constructing && !completing &&
        !populationRefreshing && !workersChanging && !militaryChanging && !document.hidden) {
      armyRetryAt = now + 30000;
      // Le même moteur que la population confirme les soldats ; aucun ajout local.
      refreshPopulation();
    }
  }
  async function changeMilitary(type, demobilize) {
    if (!userId || !domainId || busy || loading || constructing || completing ||
        populationRefreshing || workersChanging || militaryChanging || armyStale || workforceStale) return;
    const army = armyState();
    const unit = army?.units?.find(row => row.unit_type === type);
    const quantity = Number(element(`army-quantity-${type}`)?.value);
    if (!unit || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || quantity > Number(demobilize ? unit.quantity : army.max_recruit_quantity)) return;
    const id = domainId;
    const requestGeneration = generation;
    const current = () => generation === requestGeneration && domainId === id;
    if (demobilize) {
      const names = { infantry: ['Fantassin', 'Fantassins'], archer: ['Archer', 'Archers'], scout: ['Éclaireur', 'Éclaireurs'] };
      const name = names[type]?.[quantity === 1 ? 0 : 1] ?? unit.display_name;
      const accepted = await requestConfirmation({
        title: `Démobiliser ${quantity === 1 ? 'un' : quantity} ${name} ?`,
        text: `${quantity === 1 ? 'Le soldat rejoindra' : 'Les soldats rejoindront'} la population disponible.\nLes ressources utilisées pour ${quantity === 1 ? 'son' : 'leur'} recrutement ne seront pas récupérées.`,
        confirmLabel: 'Démobiliser'
      });
      if (!accepted || !current() || busy || loading || constructing || completing ||
          populationRefreshing || workersChanging || militaryChanging || armyStale || workforceStale) return;
    }
    militaryChanging = true;
    armyStale = true;
    workforceStale = true;
    updateControls();
    armyMessage.textContent = demobilize ? 'Démobilisation en cours…' : 'Recrutement en cours…';
    try {
      const { error } = await supabase.rpc(demobilize ? 'demobilize_units' : 'recruit_units', {
        p_unit_type: type, p_quantity: quantity
      });
      if (!current()) return;
      if (error) {
        armyStale = false; workforceStale = false;
        const code = error.message || '';
        armyMessage.textContent = /ARVOR_NO_AVAILABLE_POPULATION/.test(code) ? 'Habitants disponibles insuffisants.'
          : /ARVOR_INSUFFICIENT_RESOURCES/.test(code) ? 'Ressources insuffisantes pour ce recrutement.'
          : /ARVOR_NOT_ENOUGH_SOLDIERS/.test(code) ? 'Soldats formés insuffisants pour cette démobilisation.'
          : /ARVOR_QUANTITY_INVALID/.test(code) ? 'Quantité invalide.'
          : 'Opération impossible. Actualisez puis réessayez.';
        return;
      }
      if (!await refreshBuildingData(id, requestGeneration)) return;
      armyMessage.textContent = demobilize ? 'Démobilisation confirmée, sans remboursement.' : 'Recrutement ajouté à la file.';
    } catch {
      if (current()) armyMessage.textContent = 'Opération non confirmée à l’écran. Une actualisation automatique vérifiera l’état serveur.';
    } finally {
      if (current()) { militaryChanging = false; updateControls(); }
    }
  }


  function workforceBuilding(type) {
    return Array.isArray(populationState?.workforce_buildings)
      ? populationState.workforce_buildings.find(row => row.building_type === type) : null;
  }
  function workforceNumber(value) {
    return Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }
  function appendWorkforceControls(card, building, info) {
    if (!info) return;
    const label = document.createElement('p');
    label.textContent = 'Travailleurs';
    const controls = document.createElement('div');
    controls.className = 'workforce-controls';
    const count = document.createElement('span');
    count.textContent = `${info.workers_assigned} / ${info.workers_required}`;
    const buttons = [-1, 1].map(delta => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = delta < 0 ? '−' : '+';
      button.dataset.action = 'workers';
      button.dataset.buildingType = building.type;
      button.dataset.delta = String(delta);
      button.setAttribute('aria-label', `${delta < 0 ? 'Retirer' : 'Ajouter'} un travailleur : ${building.name}`);
      button.addEventListener('click', () => changeWorkers(building.type, delta));
      return button;
    });
    controls.append(buttons[0], count, buttons[1]);
    const efficiency = document.createElement('p');
    efficiency.textContent = `Rendement : ${workforceNumber(Number(info.efficiency) * 100)} %`;
    card.append(label, controls, efficiency);
  }
  async function changeWorkers(type, delta) {
    if (busy || loading || constructing || completing || populationRefreshing || workersChanging || militaryChanging ||
        workforceStale || !userId || !domainId || !buildingsReady || !builtLevels.has(type) ||
        !workforceBuilding(type) || ![-1, 1].includes(delta)) return;
    const id = domainId;
    const requestGeneration = generation;
    const current = () => generation === requestGeneration && domainId === id;
    workersChanging = true;
    workforceStale = true;
    updateControls();
    buildingMessage.textContent = 'Actualisation de la main-d’œuvre…';
    try {
      const { error } = await supabase.rpc('set_building_workers', { p_building_type: type, p_delta: delta });
      if (!current()) return;
      if (error) {
        workforceStale = false;
        const code = error.message || '';
        buildingMessage.textContent = /ARVOR_NO_AVAILABLE_POPULATION/.test(code)
          ? 'Aucun habitant disponible pour cette affectation.'
          : /ARVOR_WORKER_LIMIT/.test(code) ? 'Limite de travailleurs atteinte.'
          : /ARVOR_WORKFORCE_INCONSISTENT/.test(code) ? 'Affectation impossible : état de main-d’œuvre incohérent.'
          : 'Affectation impossible. Veuillez réessayer après actualisation.';
        return;
      }
      if (!await refreshBuildingData(id, requestGeneration)) return;
      buildingMessage.textContent = 'Affectation des travailleurs actualisée.';
    } catch {
      if (current()) buildingMessage.textContent =
        'Affectation non confirmée à l’écran. Une actualisation automatique vérifiera l’état serveur.';
    } finally {
      if (current()) { workersChanging = false; updateControls(); }
    }
  }


  function displayPopulation(fallback = null) {
    if (!populationState) {
      element('domain-population').textContent = `${fallback ?? '—'} / —`;
      element('population-rates').textContent = '';
      element('population-workers').textContent = '—';
      element('population-available').textContent = '—';
      element('population-recruits').textContent = '—';
      element('population-soldiers').textContent = '—';
      element('population-status').textContent = 'État de population indisponible.';
      return;
    }
    const { population, capacity, food_consumption_per_hour, growth_suspended,
      growth_interval_seconds } = populationState;
    element('domain-population').textContent = `${population} / ${capacity}`;
    element('population-workers').textContent = populationState.workers_assigned ?? '—';
    element('population-available').textContent = populationState.population_available ?? '—';
    element('population-recruits').textContent = populationState.army?.recruits ?? '—';
    element('population-soldiers').textContent = populationState.army?.soldiers ?? '—';
    const consumption = Number(food_consumption_per_hour).toLocaleString('fr-FR', {
      maximumFractionDigits: 1
    });
    element('population-rates').textContent =
      `Croissance : +1 / ${Number(growth_interval_seconds) / 60} min · Nourriture : -${consumption} / h`;
    element('population-status').textContent = Number(population) >= Number(capacity)
      ? 'Capacité maximale atteinte'
      : growth_suspended ? 'Croissance suspendue — nourriture insuffisante' : '';
  }
  // Traduction uniquement : puissance et progression sont fournies par le serveur.
  function displayDevelopment(domain = null) {
    const labels = { hamlet: 'Hameau', village: 'Village', bourg: 'Bourg',
      town: 'Ville', city: 'Cité' };
    const state = populationState?.power != null && populationState?.stage
      ? populationState : domain ?? developmentState;
    developmentState = state;
    const power = state?.power;
    const stage = state?.stage;
    element('domain-power').textContent = power == null ? '—' :
      Number(power).toLocaleString('fr-FR');
    element('domain-stage').textContent = labels[stage] ?? '—';
    const next = state?.next_stage;
    const remaining = state?.power_to_next_stage;
    element('development-progress').textContent = stage === 'city' ? '' :
      next && remaining != null && labels[next]
        ? `${Number(remaining).toLocaleString('fr-FR')} puissance avant ${labels[next]}`
        : '';
  }
  async function refreshPopulation() {
    if (!userId || !domainId || busy || loading || constructing || completing ||
        populationRefreshing || workersChanging || militaryChanging || document.hidden) return;
    const id = domainId;
    const requestGeneration = generation;
    populationRefreshing = true;
    updateControls();
    try {
      return await refreshBuildingData(id, requestGeneration);
    } catch {
      if (generation === requestGeneration && domainId === id) {
        element('population-status').textContent =
          'Actualisation indisponible. Nouvelle tentative automatique.';
      }
    } finally {
      if (generation === requestGeneration) {
        populationRefreshing = false;
        updateControls();
        if (potionPopulationRefreshPending) {
          potionPopulationRefreshPending = false;
          void refreshPopulation();
        }
        if (marketPopulationRefreshPending) {
          marketPopulationRefreshPending = false;
          void refreshPopulation();
        }
      }
    }
  }
  function startPopulationRefresh() {
    if (populationTimer !== null) clearInterval(populationTimer);
    populationTimer = setInterval(refreshPopulation, 60000);
  }

  function hasActiveJob() {
    return constructionJobs.size > 0 || upgradeJobs.size > 0;
  }
  function stopUpgradeTimer() {
    if (upgradeTimer !== null) clearInterval(upgradeTimer);
    upgradeTimer = null;
  }
  function setBuildingData(rows) {
    // Une ligne niveau 1 ne devient opérationnelle qu'après retrait des marqueurs serveur.
    const operational = rows.filter(row => row.construction_finishes_at == null);
    builtLevels = new Map(operational.map(row => [row.building_type, Number(row.level)]));
    constructionJobs = new Map(rows.filter(row => row.construction_finishes_at != null)
      .map(row => [row.building_type, {
        startedAt: row.construction_started_at,
        finishesAt: Date.parse(row.construction_finishes_at)
      }]));
    upgradeJobs = new Map(operational.filter(row => row.upgrade_target_level != null && row.upgrade_finishes_at != null)
      .map(row => [row.building_type, {
        target: Number(row.upgrade_target_level),
        startedAt: row.upgrade_started_at,
        finishesAt: Date.parse(row.upgrade_finishes_at)
      }]));
    buildingsReady = true;
    completionRetryAt = 0;
    stopUpgradeTimer();
    if (hasActiveJob()) upgradeTimer = setInterval(updateUpgradeCountdowns, 1000);
  }
  async function refreshBuildingData(id, requestGeneration) {
    // Une transaction serveur commune : chantiers, production, consommation, population.
    const population = await supabase.rpc('update_population');
    if (generation !== requestGeneration || domainId !== id) return false;
    if (population.error || !population.data) throw new Error('population');
    const [resources, buildings] = await Promise.all([
      supabase.from('resources').select('food, wood, stone, iron, coins, last_production_at')
        .eq('domain_id', id).maybeSingle(),
      readBuildings(id)
    ]);
    if (generation !== requestGeneration || domainId !== id) return false;
    if (resources.error || !resources.data || buildings.error || !Array.isArray(buildings.data)) throw new Error('refresh');
    populationState = population.data;
    workforceStale = false;
    armyStale = false;
    setBuildingData(buildings.data);
    displayPopulation();
    displayDevelopment();
    displayResources(resources.data);
    renderBuildings();
    renderArmy();
    return true;
  }
  // Appelé uniquement après acceptation serveur d'un futur raid, jamais pendant la préparation.
  window.arvor.refreshAfterRaid = async playerId => {
    if (!playerId || playerId !== userId || !domainId) return;
    await refreshBuildingData(domainId, generation);
  };
  // Rafraîchissement des données existantes après confirmation serveur.
  window.arvor.refreshAfterMailTransfer = async playerId => {
    if (!playerId || playerId !== userId || !domainId) return;
    await refreshBuildingData(domainId, generation);
  };
  window.arvor.refreshAfterQuest = async playerId => {
    if (!playerId || playerId !== userId || !domainId) return;
    await refreshBuildingData(domainId, generation);
  };
  function updateUpgradeCountdowns() {
    const now = Date.now();
    let due = false;
    for (const [type, job] of [...constructionJobs, ...upgradeJobs]) {
      const node = countdownNodes.get(type);
      if (!Number.isFinite(job.finishesAt)) {
        if (node) node.textContent = 'Échéance indisponible. Rechargez la page.';
        continue;
      }
      const seconds = Math.max(0, Math.ceil((job.finishesAt - now) / 1000));
      if (node) node.textContent = seconds === 0 ? 'Finalisation en cours…' :
        `Temps restant : ${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min ${seconds % 60} s`;
      if (seconds === 0) due = true;
    }
    if (due && !busy && !loading && !constructing && !completing && !populationRefreshing && !workersChanging && !militaryChanging && now >= completionRetryAt) {
      completeDueJobs();
    }
  }
  async function completeDueJobs() {
    if (!domainId || !userId || completing) return;
    const id = domainId;
    const requestGeneration = generation;
    const current = () => generation === requestGeneration && domainId === id;
    completing = true;
    updateControls();
    try {
      const now = Date.now();
      const constructionDue = [...constructionJobs.values()].some(job => job.finishesAt <= now);
      const upgradeDue = [...upgradeJobs.values()].some(job => job.finishesAt <= now);
      for (const rpc of [
        ...(constructionDue ? ['complete_building_constructions'] : []),
        ...(upgradeDue ? ['complete_building_upgrades'] : [])
      ]) {
        const { error } = await supabase.rpc(rpc);
        if (!current()) return;
        if (error) throw error;
      }
      if (!await refreshBuildingData(id, requestGeneration)) return;
      buildingMessage.textContent = hasActiveJob() ? 'Chantier en attente de confirmation serveur.' :
        (constructionDue ? 'Construction terminée.' : 'Amélioration terminée.');
    } catch {
      if (current()) buildingMessage.textContent = 'Finalisation impossible pour le moment. Nouvelle tentative dans 30 secondes.';
    } finally {
      if (current()) {
        completionRetryAt = Date.now() + 30000;
        completing = false;
        updateControls();
      }
    }
  }



  // Positions proportionnelles indépendantes pour chaque décor.
  const domainBuildingPositions = {
    domain_01: {
      farm: { left: '21.5%', top: '72.5%', width: '10%' },
      sawmill: { left: '15.5%', top: '53%', width: '10%' },
      quarry: { left: '21.5%', top: '27%', width: '10%' },
      mine: { left: '61%', top: '21.5%', width: '10%' },
      granary: { left: '46.5%', top: '80.5%', width: '10%' },
      warehouse: { left: '74.5%', top: '53.5%', width: '10%' }
    },
    domain_02: {
      farm: { left: '22%', top: '72%', width: '10%' },
      sawmill: { left: '17%', top: '53%', width: '10%' },
      quarry: { left: '23%', top: '28%', width: '10%' },
      mine: { left: '60%', top: '23%', width: '10%' },
      granary: { left: '47%', top: '81%', width: '10%' },
      warehouse: { left: '74%', top: '55%', width: '10%' }
    },
    domain_03: {
      farm: { left: '21%', top: '73%', width: '10%' },
      sawmill: { left: '17%', top: '53%', width: '10%' },
      quarry: { left: '23%', top: '28%', width: '10%' },
      mine: { left: '60%', top: '23%', width: '10%' },
      granary: { left: '47%', top: '81%', width: '10%' },
      warehouse: { left: '74%', top: '55%', width: '10%' }
    },
    domain_04: {
      farm: { left: '22%', top: '74%', width: '10%' },
      sawmill: { left: '17%', top: '53%', width: '10%' },
      quarry: { left: '23%', top: '28%', width: '10%' },
      mine: { left: '60%', top: '23%', width: '10%' },
      granary: { left: '47%', top: '80%', width: '10%' },
      warehouse: { left: '74%', top: '53%', width: '10%' }
    },
  };

  // Correspondance visuelle commune, indépendante du type de bâtiment.
  function getBuildingVisualState(level) {
    if (!Number.isInteger(level) || level < 1 || level > 50) return null;
    if (level <= 5) return '00';
    if (level <= 15) return '01';
    if (level <= 27) return '02';
    if (level <= 39) return '03';
    return '04';
  }
  // Diagnostic temporaire : uniquement l’état visuel de la ferme, aucun identifiant de compte.
  function reportFarmRender(container, level, state) {
    const image = container.querySelector('.domain-building-farm');
    const style = image ? getComputedStyle(image) : null;
    const rect = image?.getBoundingClientRect();
    const snapshot = {
      buildingsReady,
      farmPresent: builtLevels.has('farm'),
      farmLevel: level ?? null,
      visualState: state,
      imageInContainer: Boolean(image),
      src: image?.getAttribute('src') ?? null,
      complete: image?.complete ?? false,
      naturalWidth: image?.naturalWidth ?? 0,
      display: style?.display ?? null,
      visibility: style?.visibility ?? null,
      opacity: style?.opacity ?? null,
      zIndex: style?.zIndex ?? null,
      position: style?.position ?? null,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      playerScreenHidden: screen.hidden
    };
    window.arvor.farmDiagnostic = snapshot;
    console.info('[ARVOR ferme]', JSON.stringify(snapshot));
  }
  function renderDomainBuildings() {
    const container = document.querySelector('.domain-map-container');
    const mapPath = container.querySelector('.domain-map').getAttribute('src');
    const mapKey = mapPath.split('/').pop().replace('.png', '');
    const positions = domainBuildingPositions[mapKey] ?? domainBuildingPositions.domain_01;
    for (const [type, name] of [['farm', 'Ferme'], ['sawmill', 'Scierie'], ['quarry', 'Carrière'], ['mine', 'Mine'], ['granary', 'Grenier'], ['warehouse', 'Entrepôt']]) {
      const className = `domain-building-${type}`;
      const existing = container.querySelector(`[data-domain-building="${type}"]`) ||
        container.querySelector(`.${className}`);
      const level = builtLevels.get(type);
      const underConstruction = constructionJobs.has(type);
      const state = buildingsReady && builtLevels.has(type) ? getBuildingVisualState(level) : null;
      if (!underConstruction && state === null) {
        existing?.remove();
        if (type === 'farm') reportFarmRender(container, level, state);
        continue;
      }
      const image = existing || document.createElement('img');
      const path = underConstruction ? 'assets/buildings/construction.png' :
        `assets/buildings/${type}/${type}_${state}.png`;
      image.dataset.domainBuilding = type;
      image.className = underConstruction ? 'domain-construction-site' : className;
      const position = positions[type];
      image.style.left = position.left;
      image.style.top = position.top;
      image.style.width = position.width;
      image.alt = underConstruction ? `${name} — construction en cours` : `${name} — niveau ${level}`;
      image.width = 1536;
      image.height = 1024;
      image.decoding = 'async';
      if (type === 'farm') {
        image.onload = () => reportFarmRender(container, level, state);
        image.onerror = () => reportFarmRender(container, level, state);
      }
      if (image.getAttribute('src') !== path) image.setAttribute('src', path);
      if (!existing) container.append(image);
      if (type === 'farm') {
        reportFarmRender(container, level, state);
        requestAnimationFrame(() => {
          if (container.contains(image)) reportFarmRender(container, level, state);
        });
      }
    }
    window.arvor?.domainAmbience?.update();
  }
  function getDomainMapForLevels(levels) {
    const types = ['farm', 'sawmill', 'quarry', 'mine', 'granary', 'warehouse'];
    const globalLevel = types.reduce((total, type) => total + (levels.get(type) ?? 0), 0) / 6;
    const stage = globalLevel < 10 ? '01' : globalLevel < 20 ? '02' : globalLevel < 35 ? '03' : '04';
    return `assets/images/domain_${stage}.png`;
  }
  function renderDomainMap() {
    if (!buildingsReady) return;
    const image = document.querySelector('.domain-map');
    const path = getDomainMapForLevels(builtLevels);
    if (image.getAttribute('src') !== path) image.setAttribute('src', path);
  }
  // Une seule requête par niveau cible, partagée entre toutes les cartes.
  const upgradeDurationCache = new Map();
  function formatUpgradeDuration(seconds) {
    let remaining = Math.floor(seconds);
    const parts = [];
    for (const [unit, size] of [['j', 86400], ['h', 3600], ['min', 60], ['s', 1]]) {
      const amount = Math.floor(remaining / size);
      if (amount) parts.push(`${amount} ${unit}`);
      remaining %= size;
    }
    return parts.join(' ') || '0 s';
  }
  function getUpgradeDuration(targetLevel) {
    if (!upgradeDurationCache.has(targetLevel)) {
      const request = (async () => {
        try {
          const { data, error } = await supabase.rpc('building_upgrade_duration_seconds', {
            target_level: targetLevel
          });
          if (error || data === null || data === undefined || data === '') return null;
          const seconds = Number(data);
          return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
        } catch {
          return null;
        }
      })();
      // Mémoriser également un échec jusqu'au prochain chargement de la page.
      upgradeDurationCache.set(targetLevel, request);
    }
    return upgradeDurationCache.get(targetLevel);
  }
  async function displayUpgradeDuration(node, targetLevel) {
    const requestGeneration = generation;
    node.textContent = 'Temps d’amélioration : chargement…';
    const seconds = await getUpgradeDuration(targetLevel);
    if (generation !== requestGeneration || !buildingList.contains(node)) return;
    node.textContent = seconds === null ? 'Temps d’amélioration : indisponible' :
      `Temps d’amélioration : ${formatUpgradeDuration(seconds)}`;
  }

  function renderBuildings() {
    renderDomainMap();
    renderDomainBuildings();
    buildingList.replaceChildren();
    countdownNodes.clear();
    for (const building of buildingCatalog) {
      const card = document.createElement('article');
      card.className = 'building-card';
      const title = document.createElement('h4');
      title.textContent = building.name;
      const built = builtLevels.has(building.type);
      const level = builtLevels.get(building.type);
      const validLevel = Number.isInteger(level) && level >= 1;
      const workforce = workforceBuilding(building.type);
      const description = document.createElement('p');
      description.textContent = building.production
        ? ((built || constructionJobs.has(building.type)) && workforce ? `Production réelle : ${workforceNumber(workforce.production_per_hour)} ${building.resource}/h`
          : built && !validLevel ? 'Production indisponible' : `Production : ${building.production * (built ? level : 1)} ${building.resource}/h`)
        : building.description;
      card.append(title, description);
      const status = document.createElement('p');
      if (!buildingsReady) {
        status.textContent = 'État des bâtiments indisponible';
        card.append(status);
      } else {
        if (built) {
          status.textContent = validLevel ? `Niveau ${level} — Construit` : 'Niveau indisponible';
          card.append(status);
          if (building.production && validLevel) appendWorkforceControls(card, building, workforce);
        }
        const construction = constructionJobs.get(building.type);
        const job = upgradeJobs.get(building.type);
        if (construction) {
          const progress = document.createElement('p');
          progress.textContent = 'Construction en cours';
          const countdown = document.createElement('p');
          countdownNodes.set(building.type, countdown);
          card.append(progress, countdown);
        } else if (built && job) {
          const progress = document.createElement('p');
          progress.textContent = `Amélioration vers niveau ${job.target}`;
          const countdown = document.createElement('p');
          countdownNodes.set(building.type, countdown);
          card.append(progress, countdown);
        } else if (built && (!validLevel || level >= 50)) {
          if (validLevel) {
            const maximum = document.createElement('p');
            maximum.textContent = 'Niveau maximum';
            card.append(maximum);
          }
        } else {
          const cost = document.createElement('p');
          const targetLevel = built ? level + 1 : 1;
          cost.textContent = `${built ? `Coût du niveau ${targetLevel}` : 'Coût'} : ` +
            building.cost.map(([baseCost, resource]) => `${built ? Math.ceil(baseCost * Math.pow(targetLevel, 1.5)) : baseCost} ${resource}`).join(' + ');
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = built ? 'Améliorer' : 'Construire';
          button.setAttribute('aria-label', `${button.textContent} : ${building.name}`);
          button.dataset.action = built ? 'upgrade' : 'construct';
          button.disabled = busy || loading || constructing || completing || hasActiveJob();
          button.addEventListener('click', () => changeBuilding(building.type, built));
          card.append(cost);
          if (built) {
            const duration = document.createElement('p');
            card.append(duration);
            // Attendre l'ajout de la carte au DOM avant d'appliquer le résultat.
            queueMicrotask(() => displayUpgradeDuration(duration, targetLevel));
          }
          card.append(button);
        }
      }
      buildingList.append(card);
    }
    updateUpgradeCountdowns();
  }
  function readBuildings(id) {
    return supabase.from('buildings').select('building_type, level, upgrade_started_at, upgrade_finishes_at, upgrade_target_level, construction_started_at, construction_finishes_at').eq('domain_id', id);
  }
  let attachmentResources = null;
  window.arvor.getAttachmentResources = playerId =>
    userId && playerId === userId && attachmentResources ? { ...attachmentResources } : null;
  function displayResources(resources) {
    attachmentResources = Object.fromEntries(['food', 'wood', 'stone', 'iron', 'coins'].map(key => [key, resources[key]]));
    // Capacités indicatives uniquement : aucun changement des stocks ou de la production.
    function storageLevel(type) {
      if (!buildingsReady) return null;
      if (!builtLevels.has(type)) return 0;
      const level = builtLevels.get(type);
      return Number.isInteger(level) && level >= 1 ? level : null;
    }
    const granary = storageLevel('granary');
    const warehouse = storageLevel('warehouse');
    const capacities = {
      food: granary === null ? null : 1000 + 2000 * granary,
      wood: warehouse === null ? null : 1000 + 2000 * warehouse,
      stone: warehouse === null ? null : 1000 + 2000 * warehouse,
      iron: warehouse === null ? null : 500 + 1000 * warehouse
    };
    for (const field of ['food', 'wood', 'stone', 'iron']) {
      const quantity = resources[field];
      const capacity = capacities[field];
      const full = quantity != null && capacity !== null && Number(quantity) >= capacity;
      element(`resource-${field}`).textContent = `${quantity ?? '—'} / ${capacity ?? '—'}` +
        (full ? ' — Stockage plein' : '');
    }
    element('resource-coins').textContent = resources.coins ?? '—';
  }
  async function changeBuilding(type, upgrade) {
    if (busy || loading || constructing || completing || populationRefreshing || workersChanging || militaryChanging || !userId || !domainId || !buildingsReady ||
        !buildingCatalog.some(building => building.type === type)) return;
    const level = builtLevels.get(type);
    if (hasActiveJob()) return;
    if (upgrade ? (!Number.isInteger(level) || level < 1 || level >= 50) : builtLevels.has(type)) return;
    const requestGeneration = generation;
    const id = domainId;
    const current = () => generation === requestGeneration && domainId === id;
    constructing = true;
    updateControls();
    buildingMessage.textContent = upgrade ? 'Amélioration en cours…' : 'Construction en cours…';
    let succeeded = false;
    try {
      const { error } = await supabase.rpc(upgrade ? 'upgrade_building' : 'construct_building', { p_building_type: type });
      if (!current()) return;
      if (error) {
        // Ne pas afficher le message brut de la base : il peut contenir des détails internes.
        const insufficient = /insufficient|not enough|insuffisant|manque de ressources/i.test(error.message || '');
        buildingMessage.textContent = insufficient
          ? (upgrade ? 'Ressources insuffisantes pour améliorer ce bâtiment.' : 'Ressources insuffisantes pour construire ce bâtiment.')
          : (upgrade ? 'Amélioration impossible. Vérifiez vos ressources et le niveau du bâtiment, puis réessayez.' : 'Construction impossible. Vérifiez vos ressources puis réessayez.');
        return;
      }
      succeeded = true;
      // Relire niveaux confirmés, chantiers et stocks depuis Supabase.
      if (!await refreshBuildingData(id, requestGeneration)) return;
      buildingMessage.textContent = upgrade ? 'Chantier d’amélioration démarré.' : 'Chantier de construction démarré.';
    } catch {
      if (!current()) return;
      if (succeeded) {
        // Ne pas proposer une seconde construction quand la relecture a échoué.
        buildingsReady = false;
        builtLevels.clear();
        upgradeJobs.clear();
        constructionJobs.clear();
        stopUpgradeTimer();
        renderBuildings();
        buildingMessage.textContent = (upgrade ? 'Chantier d’amélioration démarré' : 'Chantier de construction démarré') + ', mais les données n’ont pas pu être actualisées. Rechargez la page.';
      } else {
        buildingMessage.textContent = upgrade ? 'Amélioration impossible pour le moment. Veuillez réessayer.' : 'Construction impossible pour le moment. Veuillez réessayer.';
      }
    } finally {
      if (current()) { constructing = false; updateControls(); }
    }
  }

  function showMessage(text) { message.textContent = text; }
  function updateControls() {
    loginButton.disabled = busy || Boolean(userId) || !supabase || Boolean(window.arvor?.registration?.isBusy());
    logoutButton.hidden = !userId;
    logoutButton.disabled = busy;
    email.disabled = password.disabled = busy || Boolean(userId) || !supabase;
    form.setAttribute('aria-busy', String(busy));
    screen.setAttribute('aria-busy', String(loading));
    for (const button of buildingList.querySelectorAll('button')) {
      const locked = busy || loading || constructing || completing || populationRefreshing || workersChanging || militaryChanging || !buildingsReady;
      if (button.dataset.action === 'workers') {
        const info = workforceBuilding(button.dataset.buildingType);
        const plus = Number(button.dataset.delta) > 0;
        button.disabled = locked || workforceStale || !info ||
          (plus ? Number(info.workers_assigned) >= Number(info.workers_required) ||
            Number(populationState?.population_available ?? 0) <= 0 : Number(info.workers_assigned) <= 0);
      } else button.disabled = locked || hasActiveJob();
    }
    const army = armyState();
    const armyLocked = busy || loading || constructing || completing || populationRefreshing ||
      workersChanging || militaryChanging || workforceStale || armyStale || !army;
    for (const input of armyList.querySelectorAll('input')) input.disabled = armyLocked;
    for (const button of armyList.querySelectorAll('button')) {
      const type = button.dataset.unitType;
      const unit = army?.units?.find(row => row.unit_type === type);
      const quantity = Number(element(`army-quantity-${type}`)?.value);
      if (button.dataset.militaryAction === 'quantity') {
        button.disabled = armyLocked || (Number(button.dataset.delta) < 0 ? quantity <= 1 : quantity >= 100);
        continue;
      }
      const available = button.dataset.militaryAction === 'demobilize' ? unit?.quantity : populationState?.population_available;
      button.disabled = armyLocked || !unit || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
        (button.dataset.militaryAction === 'recruit' && quantity > Number(army?.max_recruit_quantity)) || quantity > Number(available ?? 0);
    }
    updateExpeditionControls();
  }
  function clearPlayer() {
    attachmentResources = null;
    window.arvor?.domainAmbience?.setUser(null);
    window.arvor?.raids?.setUser(null);
    clearSocial();
    clearExpedition();
    clearWorldLocations();
    discoveryRequest++;
    resetWorldFog();
    element('armorique-fog-message').textContent = 'Découvertes en cours de chargement…';
    selectMapView(false);
    armoriqueMarker.hidden = true;
    delete armoriqueMarker.dataset.positionReady;
    armoriqueMarker.removeAttribute('style');
    element('armorique-domain-label').textContent = '';
    element('armorique-message').textContent = '';
    if (confirmationDialog.open) confirmationDialog.close('cancel');
    if (populationTimer !== null) clearInterval(populationTimer);
    populationTimer = null;
    stopArmyTimer();
    armyCountdownNodes = [];
    armyQuantities.clear();
    armyList.replaceChildren();
    recruitmentList.replaceChildren();
    armyMessage.textContent = '';
    militaryChanging = false;
    armyStale = false;
    armyRetryAt = 0;
    armyClockOffset = 0;
    populationState = null;
    developmentState = null;
    populationRefreshing = false;
    potionPopulationRefreshPending = false;
    marketPopulationRefreshPending = false;
    workersChanging = false;
    workforceStale = false;
    stopUpgradeTimer();
    upgradeJobs.clear();
    constructionJobs.clear();
    countdownNodes.clear();
    completing = false;
    completionRetryAt = 0;
    domainId = null;
    builtLevels.clear();
    buildingsReady = false;
    renderDomainBuildings();
    constructing = false;
    buildingList.replaceChildren();
    buildingMessage.textContent = '';
    screen.hidden = true;
    panel.hidden = false;
    for (const id of ['player-welcome', 'domain-name', 'domain-stage',
      'domain-population', 'population-workers', 'population-available', 'population-recruits', 'population-soldiers', 'army-soldiers', 'army-count-infantry', 'army-count-archer', 'army-count-scout', 'army-recruits', 'army-available', 'population-rates', 'population-status', 'development-progress', 'domain-power', 'resource-food', 'resource-wood',
      'resource-stone', 'resource-iron', 'resource-coins']) element(id).textContent = '';
  }
  function displayPlayer(profile, domain, resources) {
    // textContent empêche l’interprétation HTML des valeurs provenant de la base.
    element('player-welcome').textContent = `Bienvenue, ${profile.username ?? 'joueur'}`;
    element('domain-name').textContent = domain.name ?? 'Votre domaine';
    displayDevelopment(domain);
    displayPopulation(domain.population);
    displayResources(resources);
    panel.hidden = true;
    screen.hidden = false;
    renderArmy();
    startPopulationRefresh();
  }
  async function loadPlayer(id, requestGeneration) {
    const current = () => generation === requestGeneration && userId === id;
    let productionWarning = '';
    try {
      if (window.arvor?.registration && !await window.arvor.registration.ensure(current)) return;
      if (!current()) return;
      // La RPC traite les échéances dans l'ordre réel avant de retourner l'état frais.
      try {
        const { data, error } = await supabase.rpc('update_population');
        if (!current()) return;
        if (error || !data) throw new Error('population');
        populationState = data;
      } catch {
        if (!current()) return;
        productionWarning = 'La production et la population n’ont pas pu être actualisées. Les données affichées peuvent ne pas être à jour.';
      }
      if (!current()) return;

      const profileResult = await supabase.from('Profils')
        .select('id, username, role').eq('id', id).maybeSingle();
      if (!current()) return;
      if (profileResult.error) throw profileResult.error;
      if (!profileResult.data) { showMessage('Profil introuvable pour le joueur connecté.'); return; }

      const domainResult = await supabase.from('domains')
        .select('id, name, stage, population, power, owner_id')
        .eq('owner_id', id).maybeSingle();
      if (!current()) return;
      if (domainResult.error) throw domainResult.error;
      if (!domainResult.data) { showMessage('Domaine introuvable pour le joueur connecté.'); return; }

      const resourceResult = await supabase.from('resources')
        .select('food, wood, stone, iron, coins, last_production_at')
        .eq('domain_id', domainResult.data.id).maybeSingle();
      if (!current()) return;
      if (resourceResult.error) throw resourceResult.error;
      if (!resourceResult.data) { showMessage('Ressources introuvables pour votre domaine.'); return; }

      let buildings;
      try {
        buildings = await readBuildings(domainResult.data.id);
      } catch {
        buildings = { data: null, error: true };
      }
      if (!current()) return;
      domainId = domainResult.data.id;
      window.arvor?.domainAmbience?.setUser(id);
      window.arvor?.raids?.setUser(id, domainId);
      buildingsReady = !buildings.error && Array.isArray(buildings.data);
      if (buildingsReady) setBuildingData(buildings.data);
      else {
        builtLevels.clear();
        upgradeJobs.clear();
        constructionJobs.clear();
        stopUpgradeTimer();
      }
      renderBuildings();
      buildingMessage.textContent = buildingsReady ? '' : 'Impossible de charger les bâtiments. Rechargez la page.';
      displayPlayer(profileResult.data, domainResult.data, resourceResult.data);
      showMessage(productionWarning);
      void loadWorldPosition(id, requestGeneration);
      // Un seul parcours géographique : découvertes puis lieux/domaines, sans lecture isolée concurrente.
      void refreshExpeditionMap();
      expeditionTicker = setInterval(updateExpeditionTimeline, 1000);
      void synchronizeExpedition();
    } catch {
      if (current()) showMessage('Impossible de charger les données du joueur. Veuillez réessayer en rechargeant la page.');
    } finally {
      if (current()) { loading = false; updateControls(); }
    }
  }
  function applySession(session) {
    const nextId = session?.user?.id ?? null;
    if (nextId === userId) return;
    userId = nextId;
    const requestGeneration = ++generation;
    clearPlayer();
    element('social-navigation').hidden = !userId;
    window.arvor?.messaging?.setUser(userId);
    window.arvor?.tavern?.setUser(userId);
    window.arvor?.inventory?.setUser(userId);
    window.arvor?.potionRewards?.setUser(userId);
    window.arvor?.quests?.setUser(userId);
    window.arvor?.market?.setUser(userId);
    window.arvor?.registration?.setSession(session);
    password.value = '';
    loading = Boolean(userId);
    updateControls();
    if (!userId) { showMessage('Vous êtes déconnecté.'); return; }
    showMessage('Chargement des données du joueur…');
    // Hors du callback Auth pour éviter de bloquer le verrou de session du SDK.
    setTimeout(() => {
      if (generation === requestGeneration) loadPlayer(nextId, requestGeneration);
    }, 0);
  }
  async function handleLogin(event) {
    event.preventDefault();
    if (busy || userId || !supabase || window.arvor?.registration?.isBusy()) return;
    busy = true;
    updateControls();
    showMessage('Connexion en cours…');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.value.trim(), password: password.value
      });
      if (error || !data.session) {
        showMessage('Connexion impossible. Vérifiez vos identifiants et votre connexion Internet.');
        return;
      }
      applySession(data.session);
    } catch {
      showMessage('Connexion impossible pour le moment. Veuillez réessayer.');
    } finally {
      password.value = '';
      busy = false;
      updateControls();
    }
  }
  async function handleLogout() {
    if (busy || !supabase) return;
    busy = true;
    updateControls();
    showMessage('Déconnexion en cours…');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) { showMessage('Déconnexion impossible pour le moment. Veuillez réessayer.'); return; }
      applySession(null);
      showMessage('Vous êtes déconnecté.');
    } catch {
      showMessage('Déconnexion impossible pour le moment. Veuillez réessayer.');
    } finally {
      busy = false;
      updateControls();
    }
  }
  async function initializeAuth() {
    updateControls();
    if (!supabase) {
      busy = false;
      updateControls();
      showMessage('Le service de connexion n’a pas pu être chargé. Rechargez la page.');
      return;
    }
    supabase.auth.onAuthStateChange((_event, session) => applySession(session));
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) showMessage('Impossible de vérifier la session. Veuillez recharger la page.');
      else applySession(data.session);
    } catch {
      showMessage('Impossible de vérifier la session. Veuillez recharger la page.');
    } finally {
      busy = false;
      updateControls();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      updateUpgradeCountdowns();
      updateArmyCountdowns();
      refreshPopulation();
    }
  });
  window.addEventListener('arvor:auth-session', event => applySession(event.detail));
  window.addEventListener('arvor:auth-controls', updateControls);
  window.addEventListener('arvor:market-updated', event => {
    if (!userId || event.detail?.playerId !== userId || !domainId) return;
    if (populationRefreshing) marketPopulationRefreshPending = true;
    else void refreshPopulation();
  });

  window.addEventListener('arvor:potion-used', event => {
    if (event.detail?.playerId !== userId) return;
    if (populationRefreshing) potionPopulationRefreshPending = true;
    else void refreshPopulation();
  });
  window.addEventListener('arvor:registration-ready', () => {
    if (!userId) return;
    loading = true; updateControls();
    void loadPlayer(userId, generation);
  });
  form.addEventListener('submit', handleLogin);
  logoutButton.addEventListener('click', handleLogout);
  initializeAuth();
})();
