// api/spotify-auth.js — Vercel serverless function
// Redirects the user to Spotify's OAuth authorization page.

const REDIRECT_URI = 'https://apex-fitness-iim7.vercel.app/api/spotify-callback';

const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
].join(' ');

export default function handler(req, res) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;

  if (!clientId) {
    return res.status(500).json({ error: 'SPOTIFY_CLIENT_ID is not configured' });
  }

  // Random state value to guard against CSRF
  const state = Math.random().toString(36).slice(2, 18);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id:     clientId,
    scope:         SCOPES,
    redirect_uri:  REDIRECT_URI,
    state,
  });

  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
