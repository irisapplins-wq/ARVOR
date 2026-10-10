/* Transport PvP préparé ; le contrôleur du jeu est créé avec enabled:false. */
(() => {
  'use strict';
  const requestId = 'fe0f0ee3-2a90-4e84-a661-2c8b466dd38a';
  const messages = Object.freeze({
    ARVOR_PVP_DISABLED: 'Les verrous PvP du serveur sont fermés.',
    ARVOR_CONTROLLED_DEPARTURE_UNAVAILABLE: 'Permis absent, expiré ou cible/composition non autorisée. Aucun nouveau départ confirmé.',
    ARVOR_RAID_TARGET_PROTECTED: 'La cible bénéficie encore d’une protection débutant ou après défaite.',
    ARVOR_RAID_TARGET_UNAVAILABLE: 'Cible non découverte ou indisponible. Connaître son nom ne suffit pas.',
    ARVOR_NOT_ENOUGH_AVAILABLE_SOLDIERS: 'Soldats disponibles insuffisants.',
    ARVOR_AUTH_REQUIRED: 'Reconnectez-vous avant de préparer un départ.',
    ARVOR_RAID_REQUEST_MISMATCH: 'Cette requête correspond déjà à une autre composition. Ne créez pas un nouvel identifiant.',
    ARVOR_RAID_REQUEST_INVALID: 'Composition ou identifiant de requête invalide.',
    ARVOR_NOT_ENOUGH_RESOURCES: 'Ressources disponibles insuffisantes.'
  });
  function errorText(error) {
    return Object.entries(messages).find(([code]) => String(error?.message || '').includes(code))?.[1]
      || 'Départ non confirmé. Consultez les missions avant toute nouvelle tentative ; conservez le même identifiant.';
  }
  function create({ enabled, rpc }) {
    let state = 'idle';
    return Object.freeze({
      get state() { return state; },
      async send(context) {
        // Verrou vérifié AVANT tout appel, même si disabled est retiré du DOM.
        if (enabled !== true) return { kind: 'blocked', message: 'Départ désactivé localement. Aucun appel envoyé.' };
        if (state !== 'idle') return { kind: 'blocked', message: 'Départ déjà demandé. Consultez les missions ; aucun nouvel appel envoyé.' };
        const { player, ownDomain, target, prepared, composition } = context;
        if (player !== 'fc02552e-736a-48b4-805a-e54ca1bc0940' || ownDomain !== 'f6cd9340-4457-4795-af3e-e10d7cb08a85'
            || !target || target.domain_id === ownDomain || prepared?.target?.domain_id !== target.domain_id
            || target.player_name?.toUpperCase() !== 'ARTHUR' || target.domain_name?.toUpperCase() !== 'DAOULAS'
            || composition.infantry !== 10 || composition.archer !== 10 || composition.scout !== 0
            || prepared.composition_valid !== true || prepared.can_start !== true || prepared.protection?.protected !== false) {
          return { kind: 'blocked', message: 'Ce départ contrôlé exige une cible découverte, non protégée et exactement 10 fantassins, 10 archers, 0 éclaireur.' };
        }
        state = 'pending';
        try {
          const result = await rpc('start_raid', { p_target_domain_id: target.domain_id, p_infantry_qty: 10,
            p_archer_qty: 10, p_scout_qty: 0, p_request_id: requestId });
          if (result.error) {
            state = 'uncertain';
            return { kind: 'refused', message: errorText(result.error) };
          }
          const data = result.data;
          if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(data?.mission_id || '')
              || !['outbound', 'returning', 'completed', 'destroyed'].includes(data.status)
              || !Number.isFinite(Date.parse(data.departed_at)) || !Number.isFinite(Date.parse(data.arrives_at))) throw new Error('response');
          state = 'accepted';
          return { kind: 'accepted', data, message: 'Départ confirmé par le serveur. Les soldats sont réservés jusqu’au retour.' };
        } catch {
          state = 'uncertain';
          return { kind: 'uncertain', message: errorText(null) };
        }
      }
    });
  }
  window.ARVORRaidDeparture = Object.freeze({ create, errorText });
})();
