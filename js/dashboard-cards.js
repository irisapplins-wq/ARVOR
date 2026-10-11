/* Présentation seulement : les textes déjà affichés restent la source des barres. */
(() => {
  'use strict';
  const number = text => {
    const normalized = text.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
    return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
  };
  for (const card of document.querySelectorAll('#player-screen .dashboard-storage')) {
    const value = card.querySelector('dd'), bar = card.querySelector('progress');
    let lastText = null;
    const update = () => {
      const text = value.textContent;
      if (text === lastText) return;
      lastText = text;
      const match = text.match(/^(.+?)\s*\/\s*(.+?)( — Stockage plein)?$/);
      const quantity = match ? number(match[1]) : NaN;
      const capacity = match ? number(match[2]) : NaN;
      const valid = Number.isFinite(quantity) && Number.isFinite(capacity) && capacity > 0;
      bar.hidden = !valid;
      card.classList.toggle('is-storage-full', valid && quantity >= capacity);
      bar.value = valid ? Math.max(0, Math.min(1, quantity / capacity)) : 0;
      bar.title = valid ? Math.round(bar.value * 100) + ' % du stockage' : '';
      if (match?.[3]) {
        const warning = document.createElement('span');
        warning.className = 'dashboard-stock-warning';
        warning.textContent = match[3];
        value.replaceChildren(document.createTextNode(text.slice(0, -match[3].length)), warning);
      }
    };
    new MutationObserver(update).observe(value, {childList:true, characterData:true, subtree:true});
    update();
  }
})();
