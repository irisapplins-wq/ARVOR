/* AUTH 1 : Auth uniquement pour les identifiants ; initialisation atomique par RPC. */
(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const client = window.arvor?.supabase;
  const form = get('registration-form'), login = get('login-form');
  const choices = get('auth-choices'), status = get('login-message');
  const username = get('registration-username'), domain = get('registration-domain');
  const email = get('registration-email'), password = get('registration-password');
  const confirmation = get('registration-confirmation'), submit = get('registration-button');
  const resendForm = get('confirmation-resend-form'), resendEmail = get('confirmation-resend-email');
  const resendOption = get('show-confirmation-resend');
  let userId = null, busy = false, revision = 0;
  const trim = value => value.replace(/^[\s\u00a0\u202f]+|[\s\u00a0\u202f]+$/gu, '');
  const validName = (value, max) => value.length >= 3 && value.length <= max &&
    /^[\p{L}\p{Nd} _'’\-]+$/u.test(value) && /[\p{L}\p{Nd}]/u.test(value);
  const say = text => { status.textContent = text; };
  function errorMessage(error) {
    const text = String(error?.message ?? '');
    if (text.includes('USERNAME_TAKEN')) return 'Ce pseudo est déjà utilisé. Choisissez-en un autre.';
    if (text.includes('DOMAIN_TAKEN')) return 'Ce nom de domaine est déjà utilisé. Choisissez-en un autre.';
    if (text.includes('USERNAME_INVALID')) return 'Le pseudo doit contenir entre 3 et 32 caractères autorisés.';
    if (text.includes('DOMAIN_INVALID')) return 'Le nom du domaine doit contenir entre 3 et 60 caractères autorisés.';
    if (text.includes('NO_WORLD_CAPACITY')) return 'Aucune place n’est disponible pour votre domaine pour le moment. Votre compte est conservé ; réessayez plus tard.';
    if (text.includes('CONFIRMED_AUTH')) return 'Confirmez votre adresse e-mail, puis connectez-vous.';
    if (error?.code === 'weak_password') return 'Le mot de passe est trop faible. Choisissez un mot de passe plus long et plus varié.';
    if (error?.code === 'user_already_exists') return 'Cette adresse est déjà utilisée. Connectez-vous avec votre compte.';
    if (['email_address_invalid', 'validation_failed'].includes(error?.code)) return 'Vérifiez l’adresse e-mail et les informations saisies.';
    if (['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error?.code)) return 'Veuillez patienter avant de réessayer.';
    return userId ? 'Votre compte est conservé, mais votre entrée dans ARVOR n’a pas pu être terminée. Réessayez ici ou reconnectez-vous.' :
      'L’inscription n’a pas pu être confirmée. Si un compte a été créé, confirmez votre e-mail puis connectez-vous avant de réessayer.';
  }
  function controls() {
    for (const field of form.elements) field.disabled = busy || !client;
    for (const field of resendForm.elements) field.disabled = busy || Boolean(userId) || !client;
    resendOption.disabled = busy || Boolean(userId) || !client;
    resendForm.setAttribute('aria-busy', String(busy));
    for (const button of choices.querySelectorAll('button')) button.disabled = busy || Boolean(userId);
    if (busy) get('login-button').disabled = true;
    form.setAttribute('aria-busy', String(busy));
  }
  function mode(register) {
    resendForm.hidden = true;
    resendEmail.value = '';
    login.hidden = register;
    form.hidden = !register;
    get('choose-login').setAttribute('aria-pressed', String(!register));
    get('choose-registration').setAttribute('aria-pressed', String(register));
    get('login-title').textContent = register ? 'Créez votre compte' : 'Entrez en Armorique';
    password.value = confirmation.value = get('password').value = '';
  }
  function recovery() {
    mode(true);
    choices.hidden = true;
    get('registration-auth-fields').hidden = true;
    get('login-title').textContent = 'Terminez votre arrivée en Armorique';
    get('registration-help').textContent = 'Votre compte est conservé. Choisissez votre pseudo et votre domaine pour terminer votre arrivée.';
    submit.textContent = 'Entrer en Armorique';
    // Les champs Auth ne participent pas à la validation de la reprise.
    email.required = password.required = confirmation.required = false;
    controls();
  }
  async function ensure(current = () => true) {
    const result = await client.rpc('ensure_my_player_registration');
    if (!current()) return false;
    if (result.error || result.data?.ready !== true) {
      recovery(); say(errorMessage(result.error)); return false;
    }
    return true;
  }
  function setSession(session) {
    const next = session?.user?.id ?? null;
    if (next === userId) return;
    userId = next; revision++;
    resendForm.hidden = true; resendEmail.value = '';
    password.value = confirmation.value = '';
    if (!userId) {
      email.value = username.value = domain.value = '';
      choices.hidden = false;
      get('registration-auth-fields').hidden = false;
      email.required = password.required = confirmation.required = true;
      submit.textContent = 'Créer mon compte';
      get('registration-help').textContent = 'Votre adresse e-mail reste privée. Lettres, chiffres, espaces, apostrophes, tirets et underscores sont autorisés dans les noms.';
      mode(false);
    }
    controls();
  }
  async function register(event) {
    event.preventDefault();
    if (busy || !client || login.getAttribute('aria-busy') === 'true') return;
    if (!form.checkValidity()) {
      if (!userId && !email.validity.valid) say('Saisissez une adresse e-mail valide.');
      else if (!userId && (!password.validity.valid || !confirmation.validity.valid))
        say('Saisissez et confirmez un mot de passe d’au moins 8 caractères.');
      else say('Complétez le pseudo (3 à 32 caractères) et le nom du domaine (3 à 60 caractères).');
      form.querySelector(':invalid')?.focus();
      return;
    }
    const name = trim(username.value), domainName = trim(domain.value);
    if (!validName(name,32) || !validName(domainName,60)) {
      say('Pseudo : 3 à 32 caractères. Domaine : 3 à 60 caractères. Utilisez des lettres, chiffres, espaces, apostrophes, tirets ou underscores.');
      return;
    }
    if (!userId && (password.value.length < 8 || password.value !== confirmation.value)) {
      say(password.value !== confirmation.value ? 'Les mots de passe ne correspondent pas.' : 'Utilisez un mot de passe d’au moins 8 caractères.');
      return;
    }
    busy = true; controls();
    const attempt = revision, initialUser = userId;
    say(userId ? 'Préparation de votre domaine…' : 'Création du compte…');
    try {
      if (initialUser) {
        const { data, error } = await client.rpc('ensure_my_player_registration', {
          p_username: name, p_domain_name: domainName
        });
        if (revision !== attempt) return;
        if (error || data?.ready !== true) { say(errorMessage(error)); return; }
        form.hidden = true;
        window.dispatchEvent(new Event('arvor:registration-ready'));
      } else {
        const { data, error } = await client.auth.signUp({
          email: email.value.trim(), password: password.value,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname,
            data: { arvor_username: name, arvor_domain_name: domainName }
          }
        });
        // signUp peut lui-même déclencher SIGNED_IN ; aucune RPC dans son callback Auth.
        if (error) { if (!userId) say(errorMessage(error)); return; }
        if (data?.session) {
          if (revision !== attempt && userId !== data.session.user.id) return;
          if (!userId || userId === data.session.user.id)
            window.dispatchEvent(new CustomEvent('arvor:auth-session', { detail: data.session }));
        } else if (!userId) {
          say('Si cette adresse peut être inscrite, un e-mail de confirmation vous sera envoyé. Confirmez-la puis connectez-vous. Si vous avez déjà un compte, connectez-vous directement.');
          mode(false);
        }
      }
    } catch (error) {
      if (revision === attempt) { if (userId) recovery(); say(errorMessage(error)); }
    } finally {
      password.value = confirmation.value = '';
      busy = false; controls();
      window.dispatchEvent(new Event('arvor:auth-controls'));
    }
  }
  async function resendConfirmation(event) {
    event.preventDefault();
    if (busy || userId || !client || login.getAttribute('aria-busy') === 'true') return;
    if (!resendEmail.checkValidity()) {
      say('Saisissez une adresse e-mail valide.');
      resendEmail.focus();
      return;
    }
    const attempt = revision;
    busy = true; controls();
    say('Demande de renvoi en cours…');
    try {
      // Même message pour tous les retours Auth : aucune existence de compte révélée.
      await client.auth.resend({
        type: 'signup',
        email: resendEmail.value.trim(),
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (revision === attempt && !userId)
        say('Si cette adresse correspond à un compte en attente de confirmation, un nouvel e-mail vous sera envoyé si le renvoi est autorisé. Consultez votre boîte de réception et vos courriers indésirables ; si nécessaire, patientez avant de réessayer.');
    } catch {
      if (revision === attempt && !userId)
        say('La demande n’a pas pu être confirmée. Vérifiez votre connexion puis réessayez plus tard.');
    } finally {
      busy = false; controls();
      window.dispatchEvent(new Event('arvor:auth-controls'));
    }
  }
  resendOption.addEventListener('click', () => {
    if (busy || userId || !client || login.getAttribute('aria-busy') === 'true') return;
    mode(false);
    login.hidden = true; resendForm.hidden = false;
    resendEmail.value = get('email').value;
    get('login-title').textContent = 'Confirmez votre adresse e-mail';
    say(''); resendEmail.focus();
  });
  get('confirmation-resend-back').addEventListener('click', () => { mode(false); say(''); });
  resendForm.addEventListener('submit', resendConfirmation);
  get('choose-login').addEventListener('click', () => { mode(false); say(''); });
  get('choose-registration').addEventListener('click', () => { mode(true); say(''); });
  form.addEventListener('submit', register);
  window.arvor = window.arvor || {};
  window.arvor.registration = {
    setSession, isBusy: () => busy,
    async ensure(current) {
      try { return await ensure(current); }
      catch (error) { if (current()) { recovery(); say(errorMessage(error)); } return false; }
    }
  };
  controls();
})();
