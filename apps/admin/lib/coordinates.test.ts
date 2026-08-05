import { describe, expect, it } from 'vitest';
import { parseCoordinates } from './coordinates';

function expectCoords(
  result: ReturnType<typeof parseCoordinates>,
  latitude: number,
  longitude: number,
  precision = 5,
) {
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.latitude).toBeCloseTo(latitude, precision);
  expect(result.longitude).toBeCloseTo(longitude, precision);
}

describe('parseCoordinates', () => {
  it('parses the exact real-world example from the DMS South/West format', () => {
    const result = parseCoordinates(`20°24'21.0"S 54°38'16.7"W`);
    expectCoords(result, -20.405833, -54.637972, 4);
    expect(result.ok && result.detectedFormat).toBe('dms');
  });

  it('parses DMS North/East as positive values', () => {
    const result = parseCoordinates(`20°24'21.0"N 54°38'16.7"E`);
    expectCoords(result, 20.405833, 54.637972, 4);
  });

  it('accepts "O" for oeste the same as "W"', () => {
    const withW = parseCoordinates(`20°24'21.0"S 54°38'16.7"W`);
    const withO = parseCoordinates(`20°24'21.0"S 54°38'16.7"O`);
    expect(withW.ok && withO.ok).toBe(true);
    if (withW.ok && withO.ok) {
      expect(withO.longitude).toBeCloseTo(withW.longitude, 6);
    }
  });

  it('accepts lowercase hemisphere letters', () => {
    const result = parseCoordinates(`20°24'21.0"s 54°38'16.7"w`);
    expectCoords(result, -20.405833, -54.637972, 4);
  });

  it('parses degrees and decimal minutes', () => {
    const result = parseCoordinates(`20°24.350'S 54°38.278'W`);
    expectCoords(result, -20.405833, -54.637967, 3);
    expect(result.ok && result.detectedFormat).toBe('degrees_decimal_minutes');
  });

  it('parses decimal degrees separated by a comma', () => {
    const result = parseCoordinates('-20.405833, -54.637972');
    expectCoords(result, -20.405833, -54.637972);
    expect(result.ok && result.detectedFormat).toBe('decimal_comma_separated');
  });

  it('parses decimal degrees separated by a space', () => {
    const result = parseCoordinates('-20.405833 -54.637972');
    expectCoords(result, -20.405833, -54.637972);
    expect(result.ok && result.detectedFormat).toBe('decimal_space_separated');
  });

  it('parses decimal degrees with a Brazilian comma and semicolon separator', () => {
    const result = parseCoordinates('-20,405833; -54,637972');
    expectCoords(result, -20.405833, -54.637972);
    expect(result.ok && result.detectedFormat).toBe('decimal_semicolon_separated');
  });

  it('extracts coordinates from a Google Maps "q=" URL', () => {
    const result = parseCoordinates('https://www.google.com/maps?q=-20.405833,-54.637972');
    expectCoords(result, -20.405833, -54.637972);
    expect(result.ok && result.detectedFormat).toBe('google_maps_url');
  });

  it('extracts coordinates from a Google Maps "@lat,lng,zoom" URL', () => {
    const result = parseCoordinates(
      'https://www.google.com/maps/place/Somewhere/@-20.405833,-54.637972,17z',
    );
    expectCoords(result, -20.405833, -54.637972);
  });

  it('reports a Google Maps link with no extractable coordinates distinctly', () => {
    const result = parseCoordinates('https://maps.app.goo.gl/abcXYZ123');
    expect(result).toEqual({ ok: false, reason: 'unrecognized_link' });
  });

  it('extracts a decimal pair embedded in text copied from elsewhere', () => {
    const result = parseCoordinates('Minha localização\n-20.405833, -54.637972\nCampo Grande, MS');
    expectCoords(result, -20.405833, -54.637972);
  });

  it('tolerates extra surrounding whitespace', () => {
    const result = parseCoordinates('   -20.405833,   -54.637972   ');
    expectCoords(result, -20.405833, -54.637972);
  });

  it('rejects a latitude that is invalid in either order', () => {
    // 95 can't be a latitude, and 300 can't be a longitude either — not an
    // inversion candidate, just genuinely out of range.
    const result = parseCoordinates('95.0, 300.0');
    expect(result).toEqual({ ok: false, reason: 'invalid_latitude' });
  });

  it('rejects an out-of-range longitude', () => {
    const result = parseCoordinates('20.405833, 200.0');
    expect(result).toEqual({ ok: false, reason: 'invalid_longitude' });
  });

  it('rejects empty input', () => {
    expect(parseCoordinates('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseCoordinates('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parseCoordinates(null)).toEqual({ ok: false, reason: 'empty' });
    expect(parseCoordinates(undefined)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects text with no recognizable coordinates', () => {
    const result = parseCoordinates('não tenho certeza de onde fica isso');
    expect(result).toEqual({ ok: false, reason: 'unrecognized' });
  });

  it('flags a likely lat/lng inversion instead of silently swapping', () => {
    // -54 can never be a latitude; -20 fits fine as either — swapping
    // would make both valid, which is exactly the "typed lng, lat by
    // mistake" case this must surface, never auto-correct.
    const result = parseCoordinates('-54.637972, -20.405833');
    expect(result).toEqual({ ok: false, reason: 'possible_inversion' });
  });

  it('resolves hemisphere letters by role regardless of which order they appear in', () => {
    const result = parseCoordinates(`54°38'16.7"W 20°24'21.0"S`);
    expectCoords(result, -20.405833, -54.637972, 4);
  });

  it('parses plain decimal degrees immediately followed by a hemisphere letter', () => {
    const result = parseCoordinates('20.405833S 54.637972W');
    expectCoords(result, -20.405833, -54.637972);
  });
});
