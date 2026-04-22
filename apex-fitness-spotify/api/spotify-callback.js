// api/spotify-callback.js — Vercel serverless function
// Receives the OAuth code from Spotify, exchanges it for access + refresh
// tokens, then redirects the browser back to the app with tokens in the hash.

const REDIRECT_URI = 'https://apex-fitness-iim7.vercel.app/api/spotify-callback';

export default async function handler(req, res) {
  const clientId     = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Spotify credentials are not configured' });
  }

  const { code, error } = req.query;

  // Spotify denied access or something went wrong on their side
  if (error) {
    return res.redirect(`/?spotify_error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  // Exchange authorization code for tokens
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let tokenData;
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('[spotify-callback] token exchange failed:', tokenRes.status, text);
      return res.redirect('/?spotify_error=token_exchange_failed');
    }

    tokenData = await tokenRes.json();
  } catch (err) {
    console.error('[spotify-callback] fetch error:', err);
    return res.redirect('/?spotify_error=network_error');
  }

  const { access_token, refresh_token, expires_in } = tokenData;

  // Pass tokens back to the SPA via the URL hash so they never hit the server log
  const hash = new URLSearchParams({
    access_token,
    refresh_token,
    expires_in: String(expires_in),
  });

  res.redirect(`/#${hash}`);
}
