const crypto = require('crypto');
const axios = require('axios');

/**
 * Compute FRITZ!Box challenge-response (PBKDF2-HMAC-SHA256, AVM v2 protocol).
 * Challenge format: "2$iter1$salt1$iter2$salt2"
 * Response format:  "salt2$<hex>"
 */
function computeResponse(challenge, password) {
  const parts = challenge.split('$');
  if (parts.length !== 5 || parts[0] !== '2') {
    throw new Error(`Unsupported challenge format: ${challenge}`);
  }
  const iter1 = parseInt(parts[1], 10);
  const salt1 = Buffer.from(parts[2], 'hex');
  const iter2 = parseInt(parts[3], 10);
  const salt2 = Buffer.from(parts[4], 'hex');

  const hash1 = crypto.pbkdf2Sync(password, salt1, iter1, 32, 'sha256');
  const hash2 = crypto.pbkdf2Sync(hash1, salt2, iter2, 32, 'sha256');
  return `${parts[4]}$${hash2.toString('hex')}`;
}

function extract(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

class FritzboxSession {
  constructor({ host, user, password, httpClient }) {
    if (!host || !user || !password) {
      throw new Error('FritzboxSession requires host, user, password');
    }
    this.host = host;
    this.user = user;
    this.password = password;
    this.http = httpClient || axios;
    this.sid = null;
  }

  invalidate() {
    this.sid = null;
  }

  async getSid() {
    if (this.sid) return this.sid;
    return this._login();
  }

  async _login() {
    const challengeUrl = `http://${this.host}/login_sid.lua?version=2`;
    const challengeResp = await this.http.get(challengeUrl);
    const challenge = extract(challengeResp.data, 'Challenge');
    if (!challenge) throw new Error('No challenge in FRITZ!Box response');

    const response = computeResponse(challenge, this.password);
    const loginUrl = `http://${this.host}/login_sid.lua?version=2&username=${encodeURIComponent(this.user)}&response=${response}`;
    const loginResp = await this.http.get(loginUrl);
    const newSid = extract(loginResp.data, 'SID');
    if (!newSid || /^0+$/.test(newSid)) {
      throw new Error('FRITZ!Box login failed (invalid credentials?)');
    }
    this.sid = newSid;
    return this.sid;
  }

  /**
   * Wraps an operation that takes the SID. On HTTP 403, invalidate + retry once.
   * @param {(sid: string) => Promise<T>} fn
   */
  async withSid(fn) {
    const sid = await this.getSid();
    try {
      return await fn(sid);
    } catch (err) {
      if (err?.response?.status === 403) {
        this.invalidate();
        const newSid = await this.getSid();
        return await fn(newSid);
      }
      throw err;
    }
  }
}

// Singleton accessor (constructed from .env when first needed)
let _instance = null;
function getInstance() {
  if (_instance) return _instance;
  const host = process.env.FRITZBOX_HOST;
  const user = process.env.FRITZBOX_USER;
  const password = process.env.FRITZBOX_PASSWORD;
  if (!host || !user || !password) return null;
  _instance = new FritzboxSession({ host, user, password });
  return _instance;
}

function resetInstance() { _instance = null; }

module.exports = { FritzboxSession, computeResponse, getInstance, resetInstance };
