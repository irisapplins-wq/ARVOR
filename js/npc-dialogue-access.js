/* Point d'entrée visuel, sans progression ni appels Supabase. */
(() => {
  'use strict';
  let instance = null, reason = null;
  window.arvor ||= {};
  window.arvor.npcDialogue = Object.freeze({
    async open(npcId, options = {}) {
      const base = window.arvorDialogueCharacters[npcId];
      if (!base) { reason = 'NPC_UNKNOWN'; return false; }
      const existing = document.querySelector('dialog[open]');
      if (existing && existing.id !== 'merlin-pilot') { reason = 'MODAL_ALREADY_OPEN'; return false; }
      const config = structuredClone(base);
      if (options.nodes) config.nodes = structuredClone(options.nodes);
      if (options.title !== undefined) config.title = options.title;
      config.onResponse = options.onResponse;
      config.onClose = options.onClose;
      config.note = options.note;
      config.headerLabel = options.headerLabel;
      const step = options.step || config.initial;
      if (!config.nodes[step]) { reason = 'STEP_UNKNOWN'; return false; }
      config.initial = step;
      const node = config.nodes[step];
      if (options.text !== undefined) node.paragraphs = Array.isArray(options.text) ? options.text : [String(options.text)];
      if (options.pose !== undefined) node.pose = options.pose;
      if (options.title !== undefined) node.title = options.title;
      if (options.buttons !== undefined) node.responses = options.buttons;
      instance ||= window.createArvorDialogue();
      try {
        const opened = await instance.open(config, options.trigger || document.activeElement);
        reason = opened ? null : 'IMAGE_UNAVAILABLE';
        return opened;
      } catch { reason = 'CONFIG_INVALID'; return false; }
    },
    close() { instance?.close(); },
    get lastReason() { return reason; }
  });
  // Un paramètre seul ne suffit pas : la page doit aussi être servie en boucle locale.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
      new URLSearchParams(location.search).get('npcPreview') !== '1') return;
  const screen = document.getElementById('player-screen');
  if (!screen) return;
  const panel = document.createElement('section');
  panel.id = 'npc-dialogue-preview';
  panel.setAttribute('aria-label', 'Prévisualisation locale des PNJ');
  const label = document.createElement('p');
  label.textContent = 'Développement local — dialogues démonstratifs, sans quête ni récompense';
  panel.append(label);
  for (const character of Object.values(window.arvorDialogueCharacters)) {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: character.name });
    button.dataset.npcPreview = character.id;
    button.addEventListener('click', async () => {
      const opened = await window.arvor.npcDialogue.open(character.id, { trigger: button });
      label.textContent = opened ? 'Développement local — aucune progression enregistrée.' :
        'Dialogue indisponible : fermez la fenêtre déjà ouverte ou vérifiez les fichiers locaux.';
    });
    panel.append(button);
  }
  screen.append(panel);
})();
