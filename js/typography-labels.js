/* Présentation uniquement : sépare les inscriptions des valeurs sans toucher
   aux modules métier, aux données, aux contrôles ni au texte accessible. */
(() => {
  'use strict';
  const targets = [
    '#army-list .army-card > p', '#army-list .army-card > label',
    '#building-list .building-card p',
    '#expedition-content p', '#expedition-content label',
    '.inventory-potion-detail > p',
    '#market-dialog label', '.market-fact > span',
  ].join(',');
  const inscription = /(^| · )((?:Production réelle|Production|Coût du niveau|Coût|Attaque|Défense|Formation|Quantité possédée|Quantité|Rendement|Travailleurs|Niveau|Amélioration vers niveau|Construction|Durée totale estimée|Durée totale|Durée|Trajet|Séjour|Destination|Récompenses?|Difficulté|Objectifs?|Conditions|Progression|Effet futur|Effet|Prix unitaire|Prix|Disponible|Ressource|Potion|Montant brut|Net estimé|Taxe|Vivres|Bois|Pierre|Fer|Pièces)(?=\s|:|$)(?:\s*:)?)/g;
  function decorate(element) {
    for (const node of [...element.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent;
      inscription.lastIndex = 0;
      let matches = [...text.matchAll(inscription)];
      if (!matches.length) continue;
      // Un libellé de formulaire en grille reste un seul élément : ne pas
      // créer une rangée supplémentaire pour les mots « en pièces ».
      if (element.matches('label, .market-fact > span') && !/\d/.test(text)) {
        matches = [{ index: 0, 1: '', 2: text }];
      }
      const fragment = document.createDocumentFragment();
      let position = 0;
      for (const match of matches) {
        const start = match.index + match[1].length;
        fragment.append(document.createTextNode(text.slice(position, start)));
        const label = document.createElement('span');
        label.className = 'typography-label';
        label.textContent = match[2];
        fragment.append(label);
        position = start + match[2].length;
      }
      fragment.append(document.createTextNode(text.slice(position)));
      node.replaceWith(fragment);
    }
  }
  function scan(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(targets)) decorate(root);
    root.querySelectorAll(targets).forEach(decorate);
  }
  scan(document.body);
  new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      const parent = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
      if (parent?.matches(targets)) changed.add(parent);
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains('typography-label')) changed.add(node);
      }
    }
    changed.forEach(scan);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
