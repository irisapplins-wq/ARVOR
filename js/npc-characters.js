/* Textes démonstratifs uniquement : aucune action de quête ni récompense. */
(() => {
  const base = new URL('../assets/images/pnj/optimized/', document.currentScript.src).href;
  const response = [{ label: 'Continuer', next: 'suite' }];
  const make = (id, name, subtitle, portraits, first, second) => ({
    id, name, subtitle, title: { merlin: 'Un murmure entre les collines', tavernier: 'Les rumeurs de la taverne', forgeron: "Le feu et l'acier", herboriste: 'Les secrets de la forêt' }[id], closeLabel: 'Fermer', initial: 'accueil', portraits,
    nodes: { accueil: { ...first, responses: response }, suite: { ...second, responses: [] } }
  });
  window.arvorDialogueCharacters = Object.freeze({
    merlin: make('merlin', 'Merlin', 'Gardien des anciennes légendes', {
      accueil: base + 'merlin/merlin_accueil.webp',
      conseil: base + 'merlin/merlin_conseil_parchemin.webp',
      parchemin: base + 'merlin/merlin_remise_parchemin.webp'
    }, { pose: 'accueil', alt: 'Merlin, un bâton à la main, accueille le joueur', paragraphs: [
      'Te voilà enfin, jeune seigneur…',
      "Ces terres ont connu la gloire, mais les années ont effacé jusqu'au souvenir de leurs anciens maîtres.",
      'Pourtant, quelque chose s’éveille au-delà des collines. Les arbres murmurent, les pierres frémissent… et je crains que les vieilles légendes ne soient pas toutes des légendes.'
    ] }, { pose: 'parchemin', alt: 'Merlin tend un parchemin scellé et tient son bâton', paragraphs: [
      'Mais chaque grande destinée commence modestement.',
      'Avant de percer les secrets d’Armorique, assurons-nous que ton peuple ne manque de rien.'
    ] }),
    tavernier: make('tavernier', 'Tavernier', "Gardien des rumeurs d'Armorique", {
      accueil: base + 'tavernier/tavernier_accueil.webp',
      surprise: base + 'tavernier/tavernier_surpris.webp',
      mecontent: base + 'tavernier/tavernier_mecontent.webp',
      colis: base + 'tavernier/tavernier_remise_colis.webp',
      parchemin: base + 'tavernier/tavernier_remise_parchemin.webp'
    }, { pose: 'accueil', alt: 'Le tavernier souriant invite le voyageur à entrer', paragraphs: [
      'Ah ! Voilà un nouveau visage !',
      'Entre donc, seigneur, et prends place près du feu.',
      'Ici, les voyageurs échangent bien plus que des histoires...'
    ] }, { pose: 'surprise', alt: 'Le tavernier surpris lève les mains', paragraphs: [
      "Depuis quelques nuits, d'étranges lumières apparaissent dans les bois.",
      'Certains prétendent avoir aperçu de petites silhouettes près des anciennes pierres.',
      'Mais moi, je ne crois que ce que mes yeux ont vu !'
    ] }),
    forgeron: make('forgeron', 'Forgeron', "Maître des forges d'Armorique", {
      travail: base + 'forgeron/forgeron_travail.webp',
      colis: base + 'forgeron/forgeron_remise_colis.webp',
      parchemin: base + 'forgeron/forgeron_remise_parchemin.webp'
    }, { pose: 'travail', alt: 'Le forgeron tient son marteau et du métal incandescent', paragraphs: [
      'Bienvenue dans ma forge, seigneur !',
      "Le fer est chaud et mon marteau n'attend personne.",
      'Si tu cherches une bonne lame, tu es au bon endroit !'
    ] }, { pose: 'travail', alt: 'Le forgeron au travail explique les exigences de son métier', paragraphs: [
      'Mais une épée digne de ce nom ne se fabrique pas avec trois morceaux de métal rouillé !',
      'Apporte-moi du fer de qualité, et nous reparlerons de ton équipement.'
    ] }),
    herboriste: make('herboriste', 'Herboriste', 'Gardienne des plantes anciennes', {
      plantes: base + 'herboriste/herboriste_presentation_plantes.webp'
    }, { pose: 'plantes', alt: 'L’herboriste présente ses plantes et ses fleurs', paragraphs: [
      'Bienvenue, voyageur...',
      "Les forêts d'Armorique recèlent bien des secrets.",
      "Certaines plantes guérissent, d'autres protègent...",
      'Et quelques-unes feraient mieux de rester inconnues.'
    ] }, { pose: 'plantes', alt: 'L’herboriste présente ses plantes et ses fleurs', paragraphs: [
      "Si tu souhaites apprendre leurs propriétés, il te faudra d'abord observer la nature.",
      'Elle révèle ses secrets à ceux qui savent patienter.'
    ] })
  });
})();
