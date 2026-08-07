import { describe, expect, it } from 'vitest';
import { classifyLiveStatus, isStuckOnNoReadyMedia } from './fleet';

function device(overrides: Partial<Parameters<typeof classifyLiveStatus>[0]> = {}) {
  return {
    connection_status: 'online',
    player_state: 'playing_confirmed',
    current_campaign_id: null,
    last_geo_campaign_id: null,
    ...overrides,
  };
}

// MAX-016 item 29 / regression for the "reproduzindo agora" inconsistency:
// the dashboard used to filter on a literal 'playing' player_state that
// the Android app never actually reports (it reports 'playing_confirmed'),
// so the counter always showed 0 regardless of real playback.
describe('classifyLiveStatus', () => {
  it('classifies confirmed playback as playing', () => {
    expect(classifyLiveStatus(device({ player_state: 'playing_confirmed' }))).toBe(
      'playing',
    );
  });

  it('never classifies a literal "playing" player_state as playing (that value does not exist)', () => {
    expect(classifyLiveStatus(device({ player_state: 'playing' }))).not.toBe(
      'playing',
    );
  });

  it('classifies no_ready_media as fallback, never offline', () => {
    const result = classifyLiveStatus(
      device({ connection_status: 'online', player_state: 'no_ready_media' }),
    );
    expect(result).toBe('fallback');
    expect(result).not.toBe('offline');
  });

  it('classifies a device whose current campaign is its last GEO campaign as geo', () => {
    expect(
      classifyLiveStatus(
        device({
          current_campaign_id: 'geo-campaign-1',
          last_geo_campaign_id: 'geo-campaign-1',
          player_state: 'playing_confirmed',
        }),
      ),
    ).toBe('geo');
  });

  it('an offline connection always wins over player_state', () => {
    expect(
      classifyLiveStatus(
        device({ connection_status: 'offline', player_state: 'playing_confirmed' }),
      ),
    ).toBe('offline');
  });

  it('classifies stalled/media_error as attention', () => {
    expect(classifyLiveStatus(device({ player_state: 'stalled' }))).toBe('attention');
    expect(classifyLiveStatus(device({ player_state: 'media_error' }))).toBe(
      'attention',
    );
  });

  it('a connection in the "attention" bucket is attention even mid-playback', () => {
    expect(
      classifyLiveStatus(
        device({ connection_status: 'attention', player_state: 'playing_confirmed' }),
      ),
    ).toBe('attention');
  });
});

describe('isStuckOnNoReadyMedia', () => {
  it('is true only for no_ready_media', () => {
    expect(isStuckOnNoReadyMedia('no_ready_media')).toBe(true);
    expect(isStuckOnNoReadyMedia('playing_confirmed')).toBe(false);
    expect(isStuckOnNoReadyMedia(null)).toBe(false);
  });
});
