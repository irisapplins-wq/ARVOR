/* Calcul solaire local pour Brest. Equations de position NOAA/Meeus, aucun service distant. */
(() => {
  'use strict';
  const rad = Math.PI / 180, latitude = 48.3904, longitude = -4.4861;
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
  function altitude(at) {
    if (!Number.isFinite(at)) throw new Error('Invalid solar instant');
    const t = (at / 86400000 + 2440587.5 - 2451545) / 36525;
    const meanLongitude = (280.46646 + t * (36000.76983 + t * .0003032)) % 360;
    const anomaly = (357.52911 + t * (35999.05029 - .0001537 * t)) * rad;
    const eccentricity = .016708634 - t * (.000042037 + .0000001267 * t);
    const center = Math.sin(anomaly) * (1.914602 - t * (.004817 + .000014 * t))
      + Math.sin(2 * anomaly) * (.019993 - .000101 * t) + Math.sin(3 * anomaly) * .000289;
    const omega = (125.04 - 1934.136 * t) * rad;
    const apparent = (meanLongitude + center - .00569 - .00478 * Math.sin(omega)) * rad;
    const obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (.00059 - t * .001813))) / 60) / 60 + .00256 * Math.cos(omega)) * rad;
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparent));
    const y = Math.tan(obliquity / 2) ** 2, l = meanLongitude * rad;
    const equation = 4 / rad * (y * Math.sin(2 * l) - 2 * eccentricity * Math.sin(anomaly)
      + 4 * eccentricity * y * Math.sin(anomaly) * Math.cos(2 * l) - .5 * y * y * Math.sin(4 * l)
      - 1.25 * eccentricity * eccentricity * Math.sin(2 * anomaly));
    const utcMinutes = ((at % 86400000) + 86400000) % 86400000 / 60000;
    const hourAngle = (((utcMinutes + equation + 4 * longitude) % 1440) / 4 - 180) * rad;
    const sine = Math.sin(latitude * rad) * Math.sin(declination) + Math.cos(latitude * rad) * Math.cos(declination) * Math.cos(hourAngle);
    return Math.asin(clamp(sine, -1, 1)) / rad;
  }
  function sample(at) {
    const elevation = altitude(at), rising = altitude(at + 60000) > elevation;
    const phase = elevation >= 6 ? 'jour' : elevation < -12 ? 'nuit'
      : rising ? (elevation < -6 ? 'transition' : 'aube') : elevation < -6 ? 'nuit' : 'crepuscule';
    const night = 1 - smooth((elevation + 8) / 14);
    const warm = Math.max(0, 1 - Math.abs(elevation + .833) / 7) * (1 - night * .65);
    return Object.freeze({ phase, elevation, rising, night, warm,
      birds: elevation <= -.833 ? 0 : smooth((elevation + .833) / 8),
      fireflies: elevation >= -4 || (rising && phase !== 'nuit') ? 0
        : rising ? smooth((-elevation - 12) / 2) : smooth((-elevation - 4) / 4),
      lights: smooth((3 - elevation) / 9) });
  }
  const parisDate = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(at));
  function events(at) {
    const date = parisDate(at), day = Math.floor(at / 86400000) * 86400000, result = { date, sunrise:null, sunset:null, dawn:null, dusk:null };
    // Recherche sur trois jours UTC, filtrée par date Paris : couvre les journées de 23/25 h.
    for (let a = day - 86400000; a < day + 2 * 86400000; a += 600000) {
      for (const [threshold, rise, fall] of [[-.833,'sunrise','sunset'],[-6,'dawn','dusk']]) {
        const first = altitude(a) - threshold, second = altitude(a + 600000) - threshold;
        if (first * second > 0) continue;
        let low = a, high = a + 600000;
        for (let i = 0; i < 22; i++) { const mid = (low + high) / 2; if ((altitude(mid) - threshold) * first > 0) low = mid; else high = mid; }
        const event = (low + high) / 2;
        if (parisDate(event) === date) result[second > first ? rise : fall] = new Date(event).toISOString();
      }
    }
    return Object.freeze(result);
  }
  window.ARVORDomainSolar = Object.freeze({ altitude, sample, events, parisDate, latitude, longitude });
})();
