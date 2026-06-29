// OAuth 2.0 Authorization Code flow with PKCE + state. Provider-agnostic.
// Ships with a local "mock" provider so the whole flow runs with `npm start`
// and no setup. Flip OAUTH_PROVIDER=google|github (+ client id/secret) for real.
const crypto = require('crypto');
const { b64url } = require('./session');

function randomUrlSafe(bytes) { return b64url(crypto.randomBytes(bytes || 32)); }
function pkceChallenge(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}

// Each provider: where to send the user, where to swap the code for a token,
// where to read the profile, and how to map that profile to our shape.
function providers(baseUrl) {
  return {
    mock: {
      label: 'Test account',
      authUrl: baseUrl + '/mockidp/authorize',
      tokenUrl: baseUrl + '/mockidp/token',
      userInfoUrl: baseUrl + '/mockidp/userinfo',
      clientId: 'onceover-local',
      clientSecret: 'onceover-local-secret',
      scope: 'openid email profile',
      map: function (j) { return { sub: j.sub, email: j.email, name: j.name, avatar: j.picture }; }
    },
    google: {
      label: 'Google',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      scope: 'openid email profile',
      map: function (j) { return { sub: j.sub, email: j.email, name: j.name, avatar: j.picture }; }
    },
    github: {
      label: 'GitHub',
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      userInfoUrl: 'https://api.github.com/user',
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      scope: 'read:user user:email',
      map: function (j) { return { sub: String(j.id), email: j.email, name: j.name || j.login, avatar: j.avatar_url }; }
    }
  };
}

function activeProviderName() {
  return process.env.OAUTH_PROVIDER || 'mock';
}
function getProvider(baseUrl, name) {
  const p = providers(baseUrl)[name || activeProviderName()];
  if (!p) throw new Error('Unknown OAuth provider: ' + name);
  return p;
}

// Build the URL we redirect the browser to, plus the secrets we must remember.
function buildAuthRequest(baseUrl) {
  const p = getProvider(baseUrl);
  const state = randomUrlSafe(24);
  const verifier = randomUrlSafe(32);
  const challenge = pkceChallenge(verifier);
  const redirectUri = baseUrl + '/auth/callback';
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId || '',
    redirect_uri: redirectUri,
    scope: p.scope,
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  return { url: p.authUrl + '?' + qs.toString(), state: state, verifier: verifier, redirectUri: redirectUri };
}

// Exchange the auth code for an access token (PKCE verifier proves it's us).
async function exchangeCode(baseUrl, code, verifier, redirectUri) {
  const p = getProvider(baseUrl);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: redirectUri,
    client_id: p.clientId || '',
    client_secret: p.clientSecret || '',
    code_verifier: verifier
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString()
  });
  if (!res.ok) throw new Error('token exchange failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  if (!json.access_token) throw new Error('no access_token in token response');
  return json.access_token;
}

// Read the user's profile and normalize it.
async function fetchProfile(baseUrl, accessToken) {
  const p = getProvider(baseUrl);
  const res = await fetch(p.userInfoUrl, {
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Accept': 'application/json', 'User-Agent': 'Onceover' }
  });
  if (!res.ok) throw new Error('userinfo failed: ' + res.status);
  const profile = p.map(await res.json());
  if (!profile.sub) throw new Error('profile has no subject id');
  return profile;
}

module.exports = {
  providers, activeProviderName, getProvider,
  buildAuthRequest, exchangeCode, fetchProfile, pkceChallenge, randomUrlSafe
};
