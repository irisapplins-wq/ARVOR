/* Catalogue déclaratif partagé avec l’inventaire. Aucune attribution ni logique d’effet. */
(() => {
  'use strict';
  const definitions = [
    ['quest_letter_sealed', 'Lettre scellée', 'Une lettre fermée par un ancien sceau.'],
    ['quest_ancient_key', 'Clé ancienne', 'Une clé patinée aux motifs anciens.'],
    ['quest_celtic_ring', 'Anneau celtique', 'Un anneau orné d’entrelacs et d’une pierre verte.'],
    ['quest_coin_pouch', 'Bourse de pièces', 'Une bourse de cuir contenant des pièces à remettre.'],
    ['quest_ancient_grimoire', 'Grimoire ancien', 'Un livre ancien protégé par une reliure ouvragée.'],
    ['quest_mysterious_vial', 'Fiole mystérieuse', 'Une fiole scellée contenant un liquide mystérieux.'],
    ['quest_raven_feather', 'Plume de corbeau', 'Une plume sombre accompagnée d’un pendentif.'],
    ['quest_engraved_dagger', 'Dague gravée', 'Une dague cérémonielle couverte de gravures.'],
    ['quest_rune_stone', 'Pierre runique', 'Une pierre ancienne marquée de symboles.'],
    ['quest_ancient_relic', 'Relique ancienne', 'Un récipient patiné portant un signe ancien.'],
    ['quest_ancient_compass', 'Boussole ancienne', 'Une boussole ouvragée conservée dans son boîtier.'],
    ['quest_stag_medallion', 'Médaillon du cerf', 'Un médaillon représentant un cerf parmi des entrelacs.']
  ];
  const items = Object.freeze(definitions.map(([id, name, description]) => Object.freeze({
    id, name, description, type: 'quest_item', category: 'quest',
    image: 'assets/quests/items/' + id + '.png',
    equippable: false, consumable: false, tradable: false,
    transferable: false, craftable: false, bonuses: null, commercialValue: null
  })));
  const catalog = Object.freeze({ schemaVersion: 1, items });
  if (typeof module !== 'undefined' && module.exports) module.exports = catalog;
  else globalThis.ARVORQuestItems = catalog;
})();
