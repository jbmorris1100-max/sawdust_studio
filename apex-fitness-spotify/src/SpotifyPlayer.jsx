import { useState, useEffect, useRef } from 'react';

// ── SpotifyPlayer ─────────────────────────────────────────────
// Mini playback control bar. Loads the Spotify Web Playback SDK,
// shows album art + track info, and handles play/pause/skip.
//
// Props:
//   accessToken  — string  Spotify OAuth access token
//   onClose      — fn      called when the user dismisses the player

export default function SpotifyPlayer({ accessToken, onClose }) {
  const [player,      setPlayer]      = useState(null);
  const [deviceId,    setDeviceId]    = useState(null);
  const [track,       setTrack]       = useState(null);   // current track metadata
  const [isPaused,    setIsPaused]    = useState(true);
  const [sdkReady,    setSdkReady]    = useState(false);
  const [error,       setError]       = useState(null);
  const playerRef = useRef(null);

  // ── Load the Spotify Web Playback SDK script once ────────────
  useEffect(() => {
    if (window.Spotify) {
      setSdkReady(true);
      return;
    }

    window.onSpotifyWebPlaybackSDKReady = () => setSdkReady(true);

    const script = document.createElement('script');
    script.src   = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    document.body.appendChild(script);

    return () => {
      // Leave the script tag — removing it after SDK init causes issues
      window.onSpotifyWebPlaybackSDKReady = null;
    };
  }, []);

  // ── Initialise the player once the SDK + token are ready ─────
  useEffect(() => {
    if (!sdkReady || !accessToken) return;

    const instance = new window.Spotify.Player({
      name:          'Apex Fitness Player',
      getOAuthToken: (cb) => cb(accessToken),
      volume:        0.8,
    });

    // Error handlers
    instance.addListener('initialization_error', ({ message }) =>
      setError(`Init error: ${message}`)
    );
    instance.addListener('authentication_error', ({ message }) =>
      setError(`Auth error: ${message}`)
    );
    instance.addListener('account_error', ({ message }) =>
      setError(`Account error: ${message}`)
    );

    // Device ready — transfer playback here automatically
    instance.addListener('ready', ({ device_id }) => {
      setDeviceId(device_id);
      transferPlayback(device_id, accessToken);
    });

    // Track / playback state changes
    instance.addListener('player_state_changed', (state) => {
      if (!state) return;
      setTrack(state.track_window.current_track);
      setIsPaused(state.paused);
    });

    instance.connect();
    setPlayer(instance);
    playerRef.current = instance;

    return () => {
      instance.disconnect();
    };
  }, [sdkReady, accessToken]);

  // Transfer playback to this browser tab
  const transferPlayback = async (device_id, token) => {
    try {
      await fetch('https://api.spotify.com/v1/me/player', {
        method:  'PUT',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [device_id], play: false }),
      });
    } catch (err) {
      console.warn('[SpotifyPlayer] transferPlayback failed:', err);
    }
  };

  const handlePlayPause = () => playerRef.current?.togglePlay();
  const handlePrev      = () => playerRef.current?.previousTrack();
  const handleNext      = () => playerRef.current?.nextTrack();

  // ── Render ───────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      {/* Close */}
      <button style={styles.closeBtn} onClick={onClose} aria-label="Close player">
        ✕
      </button>

      {error ? (
        <p style={styles.errorText}>{error}</p>
      ) : !track ? (
        <p style={styles.loadingText}>
          {sdkReady ? 'Connecting to Spotify…' : 'Loading Spotify SDK…'}
        </p>
      ) : (
        <div style={styles.inner}>
          {/* Album art */}
          {track.album?.images?.[0]?.url && (
            <img
              src={track.album.images[0].url}
              alt={track.album.name}
              style={styles.albumArt}
            />
          )}

          {/* Track info */}
          <div style={styles.trackInfo}>
            <p style={styles.trackName}>{track.name}</p>
            <p style={styles.artistName}>
              {track.artists.map((a) => a.name).join(', ')}
            </p>
          </div>

          {/* Controls */}
          <div style={styles.controls}>
            <ControlBtn onClick={handlePrev} label="Previous">
              <PrevIcon />
            </ControlBtn>
            <ControlBtn onClick={handlePlayPause} label={isPaused ? 'Play' : 'Pause'} primary>
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </ControlBtn>
            <ControlBtn onClick={handleNext} label="Next">
              <NextIcon />
            </ControlBtn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────
function ControlBtn({ onClick, label, primary, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.controlBtn,
        ...(primary ? styles.controlBtnPrimary : {}),
        ...(hovered  ? (primary ? styles.controlBtnPrimaryHover : styles.controlBtnHover) : {}),
      }}
    >
      {children}
    </button>
  );
}

// Simple inline SVG icons — no icon lib dependency
const PlayIcon  = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);
const PrevIcon  = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
  </svg>
);
const NextIcon  = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 4V8l-5.5 4zM16 6h2v12h-2z" />
  </svg>
);

// ── Styles (plain objects — no CSS-in-JS lib needed) ──────────
const styles = {
  container: {
    position:        'fixed',
    bottom:          0,
    left:            0,
    right:           0,
    backgroundColor: '#0f0f0f',
    borderTop:       '1px solid #2a2a2a',
    padding:         '12px 20px',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    zIndex:          9999,
    fontFamily:      'system-ui, -apple-system, sans-serif',
  },
  closeBtn: {
    position:        'absolute',
    top:             10,
    right:           16,
    background:      'none',
    border:          'none',
    color:           '#555',
    fontSize:        14,
    cursor:          'pointer',
    lineHeight:      1,
    padding:         4,
  },
  inner: {
    display:     'flex',
    alignItems:  'center',
    gap:         16,
    width:       '100%',
    maxWidth:    600,
  },
  albumArt: {
    width:        52,
    height:       52,
    borderRadius: 6,
    objectFit:    'cover',
    flexShrink:   0,
    border:       '1px solid #2a2a2a',
  },
  trackInfo: {
    flex:     1,
    minWidth: 0,
  },
  trackName: {
    margin:       0,
    color:        '#e5e5e5',
    fontSize:     14,
    fontWeight:   700,
    whiteSpace:   'nowrap',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
  },
  artistName: {
    margin:       '3px 0 0',
    color:        '#888',
    fontSize:     12,
    whiteSpace:   'nowrap',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
  },
  controls: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    flexShrink: 0,
  },
  controlBtn: {
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    width:           36,
    height:          36,
    borderRadius:    '50%',
    border:          '1px solid #2a2a2a',
    backgroundColor: '#1a1a1a',
    color:           '#aaa',
    cursor:          'pointer',
    transition:      'background-color 0.15s, color 0.15s',
  },
  controlBtnHover: {
    backgroundColor: '#2a2a2a',
    color:           '#e5e5e5',
  },
  controlBtnPrimary: {
    width:           44,
    height:          44,
    backgroundColor: '#7c3aed',
    borderColor:     '#7c3aed',
    color:           '#fff',
  },
  controlBtnPrimaryHover: {
    backgroundColor: '#6d28d9',
    borderColor:     '#6d28d9',
  },
  loadingText: {
    color:    '#555',
    fontSize: 13,
    margin:   0,
  },
  errorText: {
    color:    '#ef4444',
    fontSize: 13,
    margin:   0,
  },
};
