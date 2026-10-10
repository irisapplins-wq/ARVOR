/* Décoration indépendante : aucun accès Supabase, aucune mutation d'état de jeu. */
(() => {
  'use strict';
  const solar = window.ARVORDomainSolar, container = document.querySelector('.domain-map-container');
  if (!solar || !container) return;
  const map = container.querySelector('.domain-map'), view = document.getElementById('domain-view');
  const screen = document.getElementById('player-screen');
  const profiles = Object.freeze({
    domain_01: { sky:[81,98,2,7], forest:[[8,73],[11,78],[87,39],[91,44]], smoke:[[54.43,37.30]] },
    domain_02: { sky:[81,98,2,7], forest:[[8,73],[11,78],[87,39],[91,44]], smoke:[] },
    domain_03: { sky:[81,98,2,7], forest:[[8,73],[11,78],[87,39],[91,44]], smoke:[] },
    domain_04: { sky:[81,98,2,7], forest:[[8,73],[11,78],[87,39],[91,44]], smoke:[] }
  });
  // Coordonnées internes aux images inspectées ; les autres variantes restent désactivées.
  const lanterns = Object.freeze({ 'mine_00.png':[.650,.379], 'sawmill_00.png':[.549,.457] });
  const make = (className, parent) => {
    const e = document.createElement('span'); e.className = className; e.setAttribute('aria-hidden','true');
    if (parent) parent.append(e); return e;
  };
  const root = document.createElement('div'); root.className = 'domain-ambience'; root.setAttribute('aria-hidden','true');
  const shade = make('domain-ambience-shade',root), warmth = make('domain-ambience-warmth',root);
  const lights = make('domain-ambience-lights',root), smoke = make('domain-ambience-smoke',root);
  const fauna = make('domain-ambience-fauna',root);
  container.append(root);
  const control = document.createElement('label'); control.className='domain-ambience-control';
  const toggle = document.createElement('input'); toggle.type='checkbox'; toggle.checked=true;
  control.append(toggle,document.createTextNode(' Animations d’ambiance'));
  const clockLabel = document.createElement('span'); clockLabel.className='domain-ambience-clock';
  view.append(control,clockLabel);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)'), mobile = window.matchMedia('(max-width: 600px)');
  let player = null, frame = 'domain_01', interval = null, inViewport = true, active = false;
  let anchor = null, lastServer = -Infinity, lastTick = null, nextBird = 0, lightKey = '';
  let solarDate = '', dailyEvents = null;
  const birds = [], monotonic = () => performance.now();
  function currentTime() {
    if (anchor) return anchor.utc + monotonic() - anchor.mono;
    return Date.now(); // Avant la première réponse : approximation explicitement signalée.
  }
  function syncServerTime(value) {
    const utc = Date.parse(value);
    if (!Number.isFinite(utc) || utc <= lastServer) return false;
    lastServer=utc; anchor={utc,mono:monotonic()}; tick(); return true;
  }
  function clearFauna() { fauna.replaceChildren(); birds.length=0; nextBird=0; }
  function place(e,x,y) { e.style.left=x+'%'; e.style.top=y+'%'; }
  function refreshEmitters() {
    const profile=profiles[frame];
    const images=[...container.querySelectorAll('[data-domain-building]')];
    const key=frame+images.map(e=>e.getAttribute('src')+e.style.left+e.style.top+e.style.width).join('|');
    if (key===lightKey) return;
    lightKey=key; lights.replaceChildren(); smoke.replaceChildren();
    if (!profile) return;
    for (const [x,y] of profile.smoke) {
      const emitter=make('domain-smoke-emitter',smoke);place(emitter,x,y);
      for(let i=0;i<2;i++){const puff=make('domain-smoke-puff',emitter);puff.style.animationDelay=(-i*4)+'s';}
    }
    for(const image of images) {
      const point=lanterns[image.getAttribute('src')?.split('/').pop()];
      if(!point || image.classList.contains('domain-construction-site'))continue;
      const glow=make('domain-lantern',lights);
      // Tous les assets bâtiment et le conteneur sont en 3:2 : leurs % ont la même échelle.
      const width=parseFloat(image.style.width), x=parseFloat(image.style.left), y=parseFloat(image.style.top);
      if(![width,x,y].every(Number.isFinite)){glow.remove();continue;}
      place(glow,x+width*(point[0]-.5),y+width*(point[1]-1));
      glow.dataset.building=image.dataset.domainBuilding;
    }
  }
  function spawnBirds(at, activity) {
    if(activity<=0){for(const bird of birds)bird.node.remove();birds.length=0;return;}
    for(let i=birds.length-1;i>=0;i--)if(birds[i].expires<=at){birds[i].node.remove();birds.splice(i,1);}
    if(at<nextBird)return;
    nextBird=at+(30000+Math.random()*50000)/Math.max(.2,activity);
    if(Math.random()>activity)return;
    const [x1,x2,y1,y2]=profiles[frame].sky, backwards=Math.random()<.5;
    const max=mobile.matches?1:3, count=Math.min(max-birds.length,Math.random()<.25?2:1);
    for(let i=0;i<count;i++) {
      const bird=make('domain-bird',fauna), image=document.createElement('img');
      image.src='assets/ambience/bird.svg';image.alt='';image.setAttribute('aria-hidden','true');bird.append(image);
      const seconds=9+Math.random()*6, size=mobile.matches?8:10+Math.random()*5;
      place(bird,backwards?x2:x1,y1+Math.random()*(y2-y1));
      bird.style.width=size+'px';bird.style.setProperty('--bird-distance',(backwards?-1:1)*(x2-x1)+'cqw');
      bird.style.animationDuration=seconds+'s';image.style.animationDelay=(-Math.random())+'s';
      birds.push({node:bird,expires:at+seconds*1000});
    }
  }
  function refreshFireflies(intensity) {
    const desired=intensity>0?(mobile.matches?3:6):0;
    const existing=[...fauna.querySelectorAll('.domain-firefly')];
    if(existing.length!==desired){
      existing.forEach(e=>e.remove());
      for(let i=0;i<desired;i++){
        const [x,y]=profiles[frame].forest[i%profiles[frame].forest.length];
        const fly=make('domain-firefly',fauna);place(fly,x+(Math.random()-.5)*2,y+(Math.random()-.5)*2);
        fly.style.animationDelay=(-Math.random()*12)+'s';fly.style.animationDuration=(9+Math.random()*8)+'s';
      }
    }
    fauna.style.setProperty('--firefly-intensity',String(intensity));
  }
  function tick() {
    const at=currentTime();
    if(!Number.isFinite(at)){shade.style.opacity='0';warmth.style.opacity='0';lights.style.opacity='0';clearFauna();clockLabel.textContent='Ambiance solaire indisponible';return;}
    const scene=solar.sample(at);lastTick=scene;
    root.dataset.phase=scene.phase;
    root.dataset.clock=anchor?(monotonic()-anchor.mono>3600000?'server-extrapolated':'server'):'device-approximate';
    shade.style.opacity=String(scene.night*.48);warmth.style.opacity=String(scene.warm*.12);
    lights.style.opacity=String(scene.lights*.75);
    clockLabel.textContent=anchor?'Heure solaire de Brest · Europe/Paris':'Heure solaire de Brest · horloge appareil non synchronisée';
    const date=solar.parisDate(at);
    if(date!==solarDate){solarDate=date;dailyEvents=solar.events(at);}
    const parisTime=value=>new Date(value).toLocaleTimeString('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'});
    clockLabel.title=`Lever : ${parisTime(dailyEvents.sunrise)} · Coucher : ${parisTime(dailyEvents.sunset)} (Brest, Europe/Paris). `
      +(root.dataset.clock==='server-extrapolated'?'Heure serveur extrapolée hors ligne.':'Cycle uniquement visuel.');
    refreshEmitters();
    const animate=active&&toggle.checked&&!reduced.matches;
    root.dataset.animate=String(animate);
    if(!animate){clearFauna();return;}
    spawnBirds(monotonic(),scene.birds);refreshFireflies(scene.fireflies);
  }
  function visibility() {
    const next=Boolean(player&&profiles[frame]&&!document.hidden&&!screen.hidden&&!view.hidden&&inViewport);
    root.hidden=!next;active=next;
    if(!next){clearFauna();clearInterval(interval);interval=null;return;}
    tick();if(interval===null)interval=setInterval(tick,10000);
  }
  function update() {
    const key=map.getAttribute('src')?.split('/').pop()?.replace('.png','');
    if(!profiles[key]){frame=key;root.hidden=true;active=false;clearInterval(interval);interval=null;clearFauna();return;}
    if(frame!==key){frame=key;lightKey='';clearFauna();}
    refreshEmitters();visibility();
  }
  toggle.addEventListener('change',()=>tick());
  reduced.addEventListener('change',()=>tick());mobile.addEventListener('change',()=>{clearFauna();tick();});
  document.addEventListener('visibilitychange',visibility);
  window.addEventListener('pageshow',visibility);window.addEventListener('pagehide',()=>{active=false;clearInterval(interval);interval=null;clearFauna();root.hidden=true;});
  const observer=new MutationObserver(update);
  observer.observe(map,{attributes:true,attributeFilter:['src']});
  observer.observe(view,{attributes:true,attributeFilter:['hidden']});
  observer.observe(screen,{attributes:true,attributeFilter:['hidden']});
  const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{inViewport=entries[0].isIntersecting;visibility();}):null;
  intersection?.observe(container);
  window.arvor=window.arvor||{};
  window.arvor.domainAmbience=Object.freeze({
    update,syncServerTime,
    setUser(id){if(player!==id){player=id||null;lightKey='';clearFauna();}update();},
    snapshot(){return {frame,active,timer:interval!==null,phase:lastTick?.phase,clock:root.dataset.clock,birds:birds.length,
      fireflies:fauna.querySelectorAll('.domain-firefly').length,smokeEmitters:smoke.children.length,lights:lights.children.length,
      reducedMotion:reduced.matches,animations:toggle.checked&&!reduced.matches};}
  });
  // Extension prévue : des sprites validés pourront utiliser des parcours propres à profiles[frame].
  // Aucun villageois, animal ou roue provisoire n'est créé.
  visibility();
})();
