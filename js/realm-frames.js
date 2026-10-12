/* Présentation seulement : aucun contenu déplacé, aucun appel serveur. */
(() => {
  'use strict';
  const attached = new WeakSet();
  const noble = new Set(['market-dialog', 'quest-dialog', 'expedition-dialog']);
  function fit(element) {
    const css = getComputedStyle(element);
    const width = parseFloat(css.width);
    element.classList.toggle('realm-frame-compact', width > 0 && width <= 480);
    let inset = Math.min(...['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(css['padding' + side]) || 0));
    if (element.id === 'market-dialog' && inset === 0) {
      const header = element.querySelector('.market-header');
      const headerStyle = header && getComputedStyle(header);
      inset = headerStyle ? Math.min(parseFloat(headerStyle.paddingTop), parseFloat(headerStyle.paddingLeft)) : 16;
    }
    const corner = Math.max(0, inset * 1.8) + 'px';
    const band = Math.max(0, inset * .7) + 'px';
    if (element.style.getPropertyValue('--frame-safe-corner') !== corner) element.style.setProperty('--frame-safe-corner', corner);
    if (element.style.getPropertyValue('--frame-safe-band') !== band) element.style.setProperty('--frame-safe-band', band);
  }
  const observer = new ResizeObserver(entries => entries.forEach(entry => fit(entry.target)));
  function attach(element) {
    if (element.id === 'player-profile-dialog' || attached.has(element)) return;
    const css = getComputedStyle(element);
    // Photographie du matériau existant, avant d'ajouter les couches décoratives.
    for (const [variable, property] of [['underlay', 'backgroundImage'], ['underlay-position', 'backgroundPosition'], ['underlay-size', 'backgroundSize'], ['underlay-repeat', 'backgroundRepeat'], ['underlay-origin', 'backgroundOrigin'], ['underlay-clip', 'backgroundClip']]) {
      element.style.setProperty('--frame-' + variable, css[property]);
    }
    if (element.id === 'market-dialog') {
      const header = element.querySelector('.market-header');
      if (header) {
        const headerStyle = getComputedStyle(header);
        for (const [variable, property] of [['image', 'backgroundImage'], ['position', 'backgroundPosition'], ['size', 'backgroundSize'], ['repeat', 'backgroundRepeat']]) {
          header.style.setProperty('--frame-header-' + variable, headerStyle[property]);
        }
      }
    }
    const isNoble = noble.has(element.id) || element.classList.contains('raid-dialog');
    element.classList.add('realm-frame', isNoble ? 'realm-frame-noble' : 'realm-frame-standard');
    attached.add(element);
    fit(element);
    element.querySelectorAll('.inventory-heading,.messaging-header,.tavern-heading,.expedition-header,.raid-header,.quest-heading').forEach(header => {
      if (getComputedStyle(header).position === 'sticky') header.classList.add('realm-frame-sticky-header');
    });
    observer.observe(element);
  }
  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches('dialog, .login')) attach(root);
    root.querySelectorAll('dialog, .login').forEach(attach);
  }
  scan(document.body);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(scan)))
    .observe(document.body, { childList: true, subtree: true });
})();
