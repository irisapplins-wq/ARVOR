/* Composant visuel local. Aucun moteur de quête, réseau métier ou stockage. */
(() => {
  'use strict';
  window.createArvorDialogue = () => {

    const host = document.createElement('div');
    host.innerHTML = window.arvorDialogueTemplate;
    const dialog = host.firstElementChild;
    document.body.append(dialog);
    // Laisser le décorateur commun capturer le matériau une seule fois.
    queueMicrotask(() => dialog.classList.add('realm-frame'));
    const el = id => dialog.querySelector('#' + id);
    const portrait = el('npc-portrait'), speech = el('npc-speech');
    const next = el('pilot-continue'), close = el('pilot-close');
    const actions = dialog.querySelector('.pilot-actions'), scroll = dialog.querySelector('.pilot-scroll');
    const mobileControls = dialog.querySelector('.pilot-mobile-controls');
    const position = document.createComment('Emplacement des réponses sur PC');
    actions.before(position);
    const mobile = matchMedia('(max-width: 430px)');
    function placeActions() {
      if (mobile.matches) mobileControls.append(actions); else position.after(actions);
      mobileControls.hidden = !mobile.matches;
    }
    mobile.addEventListener('change', placeActions); placeActions();
    let character = null, nodeId = null, revision = 0, opener = null, busy = false;
    const loaded = new Map();
    function image(url) {
      if (!loaded.has(url)) {
        const img = new Image(); img.src = url;
        const promise = img.decode().then(() => img);
        loaded.set(url, promise);
        promise.catch(() => loaded.delete(url));
      }
      return loaded.get(url);
    }
    function validate(config) {
      if (!config || !config.id || !config.nodes?.[config.initial]) throw Error('Configuration de dialogue invalide.');
      for (const node of Object.values(config.nodes)) {
        if (!config.portraits?.[node.pose] || !Array.isArray(node.paragraphs)) throw Error('Pose ou texte absent.');
        for (const answer of node.responses || []) if (!config.nodes[answer.next]) throw Error('Dialogue suivant absent.');
      }
    }
    async function render(animate) {
      const current = ++revision, data = character.nodes[nodeId];
      busy = true; actions.querySelectorAll('button').forEach(b => b.disabled = b !== close);
      const url = character.portraits[data.pose];
      const changing = animate && portrait.getAttribute('src') !== new URL(url, location.href).href;
      if (changing) portrait.classList.add('pose-changing');
      let img;
      try { img = await image(url); } catch {
        if (current !== revision) return;
        portrait.classList.remove('pose-changing'); busy = false;
        speech.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Illustration indisponible. Fermez puis réessayez après vérification des fichiers locaux.' }));
        close.disabled = false; next.disabled = true;
        return;
      }
      if (changing && !matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve, 160));
      if (current !== revision || !dialog.open) return;
      portrait.src = img.src; portrait.alt = data.alt || character.name;
      portrait.width = img.naturalWidth; portrait.height = img.naturalHeight;
      dialog.querySelector('.pilot-eyebrow').textContent = data.title ?? character.title ?? '';
      speech.replaceChildren(...data.paragraphs.map(text => Object.assign(document.createElement('p'), { textContent: text })));
      portrait.classList.remove('pose-changing');
      actions.querySelectorAll('[data-extra-response]').forEach(b => b.remove());
      const responses = data.responses || [];
      next.hidden = !responses.length;
      if (responses.length) next.textContent = responses[0].label;
      // Structure prête pour plusieurs réponses ; aucun choix supplémentaire configuré.
      for (const answer of responses.slice(1)) {
        const button = Object.assign(document.createElement('button'), { type: 'button', textContent: answer.label });
        button.dataset.extraResponse = answer.next;
        button.addEventListener('click', () => go(answer.next)); close.before(button);
      }
      actions.querySelectorAll('button').forEach(b => b.disabled = false); busy = false;
    }
    function go(target) {
      if (busy || !dialog.open || !character.nodes[target]) return;
      nodeId = target; render(true);
    }
    next.addEventListener('click', () => {
      const answer = character?.nodes[nodeId]?.responses?.[0];
      if (answer) go(answer.next);
    });
    for (const button of [close, el('pilot-close-top')]) button.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { revision++; busy = false; opener?.focus({ preventScroll: true }); });
    return Object.freeze({
      async open(config, trigger) {
        validate(config);
        const request = ++revision;
        // Vérifier la première image avant ouverture : jamais de portrait cassé affiché.
        try { await image(config.portraits[config.nodes[config.initial].pose]); } catch { return false; }
        if (request !== revision) return false;
        character = config; nodeId = config.initial; opener = trigger || document.activeElement;
        el('npc-name').textContent = config.name; el('npc-subtitle').textContent = config.subtitle;
        close.textContent = config.closeLabel || 'Fermer';
        portrait.classList.remove('pose-changing');
        if (!dialog.open) dialog.showModal();
        scroll.scrollTop = 0;
        await render(false);
        return dialog.open;
      },
      close() { revision++; if (dialog.open) dialog.close(); },
      destroy() { this.close(); mobile.removeEventListener('change', placeActions); dialog.remove(); }
    });
  };
})();
