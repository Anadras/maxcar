/**
 * Parses geographic coordinates from whatever an operator happens to have
 * on their clipboard — a DMS string copied from a GPS device, a decimal
 * pair with a Brazilian comma, or a Google Maps link — into a validated
 * decimal latitude/longitude. Never guesses silently: an ambiguous or
 * out-of-range result comes back as a specific, translatable reason
 * instead of a best-effort number, so the UI can show the operator exactly
 * what went wrong instead of quietly saving the wrong point.
 *
 * Used anywhere this app takes a lat/lng pair from a human instead of a
 * database row: the establishment form (the actual source of a geofence's
 * point — see docs/admin/FLEET_LIFECYCLE.md's establishment/geofence
 * split) and the GEO simulator's vehicle position.
 */

export type CoordinateFormat =
  | 'google_maps_url'
  | 'dms'
  | 'degrees_decimal_minutes'
  | 'decimal_comma_separated'
  | 'decimal_semicolon_separated'
  | 'decimal_space_separated'
  | 'decimal_hemisphere';

export type ParseCoordinatesResult =
  | { ok: true; latitude: number; longitude: number; detectedFormat: CoordinateFormat }
  | { ok: false; reason: ParseFailureReason };

export type ParseFailureReason =
  | 'empty'
  | 'unrecognized'
  | 'unrecognized_link'
  | 'invalid_latitude'
  | 'invalid_longitude'
  | 'possible_inversion';

/** Exact copy for each failure reason — kept here, not duplicated in every
 * component that calls [parseCoordinates], so the wording only ever needs
 * to change in one place. */
export const COORDINATE_MESSAGES: Record<ParseFailureReason, string> = {
  empty: 'Cole as coordenadas ou um link do mapa.',
  unrecognized: 'Formato de coordenadas não reconhecido.',
  unrecognized_link: 'Não foi possível extrair coordenadas deste link.',
  invalid_latitude: 'Latitude deve estar entre -90 e 90.',
  invalid_longitude: 'Longitude deve estar entre -180 e 180.',
  possible_inversion: 'Confirme se latitude e longitude não estão invertidas.',
};

export const COORDINATES_RECOGNIZED_MESSAGE = 'Coordenadas reconhecidas.';

const NORTH_SOUTH = /^[NnSs]$/;
const EAST_WEST = /^[EeWwOo]$/;

interface Component {
  /** Signed decimal degrees, sign already applied from the hemisphere
   * letter (if any) or from a leading '-'. */
  value: number;
  /** 'lat' if the hemisphere letter was N/S, 'lon' if E/W/O, null if the
   * component had no hemisphere letter at all (a plain signed decimal). */
  axis: 'lat' | 'lon' | null;
}

function toNumber(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.');
  if (normalized === '' || normalized === '-' || normalized === '+') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function applyHemisphere(magnitude: number, hemisphere: string | undefined): Component | null {
  if (hemisphere === undefined) return { value: magnitude, axis: null };
  if (NORTH_SOUTH.test(hemisphere)) {
    return { value: hemisphere.toUpperCase() === 'S' ? -Math.abs(magnitude) : Math.abs(magnitude), axis: 'lat' };
  }
  if (EAST_WEST.test(hemisphere)) {
    const isWest = hemisphere.toUpperCase() === 'W' || hemisphere.toUpperCase() === 'O';
    return { value: isWest ? -Math.abs(magnitude) : Math.abs(magnitude), axis: 'lon' };
  }
  return null;
}

/** Matches one degrees[/minutes[/seconds]] component with an optional
 * trailing hemisphere letter — degrees-minutes-seconds, degrees-decimal-
 * minutes, and plain decimal-with-hemisphere all share this one shape,
 * differing only in which optional groups are present. */
const DMS_COMPONENT =
  /([+-]?\d{1,3}(?:[.,]\d+)?)\s*[°º]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["″]|'')\s*)?)?\s*([NSEWOnsewo])?\b/g;

/** Plain decimal degrees immediately followed by a hemisphere letter, with
 * no degree symbol at all (e.g. "20.405833S 54.637972W"). */
const DECIMAL_HEMISPHERE_COMPONENT = /([+-]?\d{1,3}(?:[.,]\d+)?)\s*([NSEWOnsewo])\b/g;

function componentsFromDegreeSymbolMatches(input: string): {
  components: Component[];
  format: CoordinateFormat;
} | null {
  const matches = [...input.matchAll(DMS_COMPONENT)];
  if (matches.length < 2) return null;

  const components: Component[] = [];
  let sawSeconds = false;
  let sawMinutes = false;
  for (const match of matches.slice(0, 2)) {
    const [, degreesRaw, minutesRaw, secondsRaw, hemisphere] = match;
    const degrees = toNumber(degreesRaw);
    if (degrees === null) return null;
    let magnitude = Math.abs(degrees);
    if (minutesRaw !== undefined) {
      sawMinutes = true;
      const minutes = toNumber(minutesRaw);
      if (minutes === null) return null;
      magnitude += minutes / 60;
    }
    if (secondsRaw !== undefined) {
      sawSeconds = true;
      const seconds = toNumber(secondsRaw);
      if (seconds === null) return null;
      magnitude += seconds / 3600;
    }
    if (degrees < 0) magnitude = -magnitude;
    const component = applyHemisphere(Math.abs(magnitude), hemisphere) ?? {
      value: magnitude,
      axis: null,
    };
    components.push(component);
  }
  return { components, format: sawSeconds || !sawMinutes ? 'dms' : 'degrees_decimal_minutes' };
}

function componentsFromDecimalHemisphere(input: string): Component[] | null {
  const matches = [...input.matchAll(DECIMAL_HEMISPHERE_COMPONENT)];
  if (matches.length < 2) return null;
  const components: Component[] = [];
  for (const match of matches.slice(0, 2)) {
    const [, magnitudeRaw, hemisphere] = match;
    const magnitude = toNumber(magnitudeRaw);
    if (magnitude === null) return null;
    const component = applyHemisphere(Math.abs(magnitude), hemisphere);
    if (component === null) return null;
    components.push(component);
  }
  return components;
}

/** Assigns the two parsed components to (latitude, longitude). If either
 * carries an explicit hemisphere letter, that letter decides its axis
 * regardless of the order it appeared in — "54°38'W 20°24'S" resolves
 * exactly the same as "20°24'S 54°38'W". Falls back to positional order
 * (first = latitude, second = longitude) only when neither component has
 * a hemisphere letter. */
function assignAxes(components: [Component, Component]): { latitude: number; longitude: number } | null {
  const [a, b] = components;
  if (a.axis === 'lat' && b.axis === 'lon') return { latitude: a.value, longitude: b.value };
  if (a.axis === 'lon' && b.axis === 'lat') return { latitude: b.value, longitude: a.value };
  if (a.axis === null && b.axis === null) return { latitude: a.value, longitude: b.value };
  // One has an axis and the other doesn't (shouldn't happen for input this
  // parser generates components from, since both go through the same
  // regex pass) — refuse rather than guess.
  return null;
}

const GOOGLE_MAPS_PATTERNS = [
  // ?q=lat,lng or &q=lat,lng
  /[?&]q=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
  // /@lat,lng,zoom
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),/,
  // ?ll=lat,lng or &ll=lat,lng
  /[?&]ll=(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
];

function looksLikeUrl(input: string): boolean {
  return /https?:\/\/|maps\.app\.goo\.gl|google\.\w+\/maps/i.test(input);
}

function tryGoogleMapsUrl(input: string): ParseCoordinatesResult | null {
  if (!looksLikeUrl(input)) return null;
  for (const pattern of GOOGLE_MAPS_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      const latitude = Number(match[1]);
      const longitude = Number(match[2]);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { ok: true, latitude, longitude, detectedFormat: 'google_maps_url' };
      }
    }
  }
  return { ok: false, reason: 'unrecognized_link' };
}

/** Splits a string that's expected to hold exactly two decimal numbers,
 * trying separators in order of how unambiguous they are: a semicolon can
 * only ever be the pair separator (so a Brazilian decimal comma inside
 * each half is safe); a comma is tried as the pair separator only when
 * both halves are already clean dot-decimals (otherwise a lone Brazilian
 * number like "20,405833" would wrongly split in two); whitespace is
 * tried last, with each half allowed to use either decimal separator. */
function tryDecimalPair(
  input: string,
): { latitude: number; longitude: number; detectedFormat: CoordinateFormat } | null {
  const trimmed = input.trim();

  if (trimmed.includes(';')) {
    const parts = trimmed.split(';').map((part) => part.trim());
    if (parts.length === 2) {
      const latitude = toNumber(parts[0]);
      const longitude = toNumber(parts[1]);
      if (latitude !== null && longitude !== null) {
        return { latitude, longitude, detectedFormat: 'decimal_semicolon_separated' };
      }
    }
    return null;
  }

  const commaParts = trimmed.split(',').map((part) => part.trim());
  if (commaParts.length === 2 && commaParts.every((part) => /^[+-]?\d+(\.\d+)?$/.test(part))) {
    return {
      latitude: Number(commaParts[0]),
      longitude: Number(commaParts[1]),
      detectedFormat: 'decimal_comma_separated',
    };
  }
  // "-20,405833,-54,637972": two Brazilian-decimal numbers joined by a
  // plain comma pair-separator — four comma-separated pieces, re-paired.
  if (commaParts.length === 4) {
    const latitude = toNumber(`${commaParts[0]}.${commaParts[1]}`);
    const longitude = toNumber(`${commaParts[2]}.${commaParts[3]}`);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, detectedFormat: 'decimal_comma_separated' };
    }
  }

  const spaceParts = trimmed.split(/\s+/).filter(Boolean);
  if (spaceParts.length === 2) {
    const latitude = toNumber(spaceParts[0]);
    const longitude = toNumber(spaceParts[1]);
    if (latitude !== null && longitude !== null) {
      return { latitude, longitude, detectedFormat: 'decimal_space_separated' };
    }
  }

  return null;
}

// MAXCAR operates a Brazil-only pilot fleet (every establishment/device in
// this codebase is addressed in Brazil, e.g. state defaults to "MS"). A
// generous bounding box around the whole country — not just the pilot's
// own state — is enough to catch the realistic "typed longitude first"
// mistake (both values individually valid as *some* latitude/longitude,
// e.g. -54.6/-20.4, so plain range-checking alone can't tell) without
// false-positiving on a real, correctly-ordered Brazilian point.
const BRAZIL_LATITUDE_RANGE = { min: -34, max: 6 };
const BRAZIL_LONGITUDE_RANGE = { min: -75, max: -30 };

function fitsBrazil(latitude: number, longitude: number): boolean {
  return (
    latitude >= BRAZIL_LATITUDE_RANGE.min &&
    latitude <= BRAZIL_LATITUDE_RANGE.max &&
    longitude >= BRAZIL_LONGITUDE_RANGE.min &&
    longitude <= BRAZIL_LONGITUDE_RANGE.max
  );
}

function validate(
  latitude: number,
  longitude: number,
  detectedFormat: CoordinateFormat,
): ParseCoordinatesResult {
  const latOk = latitude >= -90 && latitude <= 90;
  const lonOk = longitude >= -180 && longitude <= 180;
  if (latOk && lonOk) {
    // Both individually plausible, but do they look swapped? Only flagged
    // when the given order doesn't fit Brazil at all yet the swapped order
    // does — a real, correctly-ordered point outside that box is never
    // touched, and this never fires when the given order already fits.
    if (!fitsBrazil(latitude, longitude) && fitsBrazil(longitude, latitude)) {
      return { ok: false, reason: 'possible_inversion' };
    }
    return { ok: true, latitude, longitude, detectedFormat };
  }
  // What was parsed as latitude can't possibly be one at all (outside
  // -90..90), but swapping the two would make both structurally valid.
  // That's exactly a lat/lng-order mistake, not a bad coordinate — never
  // silently swapped, always surfaced for the operator to confirm.
  if (!latOk && longitude >= -90 && longitude <= 90 && latitude >= -180 && latitude <= 180) {
    return { ok: false, reason: 'possible_inversion' };
  }
  if (!latOk) return { ok: false, reason: 'invalid_latitude' };
  return { ok: false, reason: 'invalid_longitude' };
}

/** Parses one pasted string into a validated decimal latitude/longitude.
 * Never inverts silently: a plausible-looking but ambiguous order comes
 * back as `possible_inversion`, not a best guess. */
export function parseCoordinates(input: string | null | undefined): ParseCoordinatesResult {
  if (input === null || input === undefined || input.trim() === '') {
    return { ok: false, reason: 'empty' };
  }
  const trimmed = input.trim();

  const urlResult = tryGoogleMapsUrl(trimmed);
  if (urlResult) {
    if (!urlResult.ok) return urlResult;
    return validate(urlResult.latitude, urlResult.longitude, urlResult.detectedFormat);
  }

  const degreeSymbolResult = componentsFromDegreeSymbolMatches(trimmed);
  if (degreeSymbolResult) {
    const assigned = assignAxes(degreeSymbolResult.components as [Component, Component]);
    if (assigned) return validate(assigned.latitude, assigned.longitude, degreeSymbolResult.format);
  }

  const hemisphereComponents = componentsFromDecimalHemisphere(trimmed);
  if (hemisphereComponents) {
    const assigned = assignAxes(hemisphereComponents as [Component, Component]);
    if (assigned) return validate(assigned.latitude, assigned.longitude, 'decimal_hemisphere');
  }

  const decimalPair = tryDecimalPair(trimmed);
  if (decimalPair) {
    return validate(decimalPair.latitude, decimalPair.longitude, decimalPair.detectedFormat);
  }

  // Last resort for text copied from elsewhere with a decimal pair
  // embedded among other words (e.g. pasted straight from a Google Maps
  // share card) — unlike tryDecimalPair, this doesn't require the *whole*
  // input to be just the two numbers.
  const embedded = trimmed.match(/(-?\d{1,3}(?:[.,]\d+))\s*,\s*(-?\d{1,3}(?:[.,]\d+))/);
  if (embedded) {
    const latitude = toNumber(embedded[1]);
    const longitude = toNumber(embedded[2]);
    if (latitude !== null && longitude !== null) {
      return validate(latitude, longitude, 'decimal_comma_separated');
    }
  }

  return { ok: false, reason: 'unrecognized' };
}
