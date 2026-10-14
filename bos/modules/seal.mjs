// The cloud copy is locked on the phone before it is sent. Supabase stores the locked
// bytes. The passphrase is never sent, and it is not written on the phone either.
const CHECK = 'war-chief-ok';
const ROUNDS = 210000;

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

let key = null;
let salt = null;

const derive = (phrase, saltBytes) => crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey'])
  .then((mat) => crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: ROUNDS, hash: 'SHA-256' },
    mat,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  ));

const enc = async (k, text) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text)));
  return b64(iv) + '.' + b64(ct);
};
const dec = async (k, packed) => {
  const [iv, ct] = String(packed).split('.');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, unb64(ct));
  return new TextDecoder().decode(plain);
};

export const cloudLocked = () => !key;

// A new passphrase locks a new salt. The same passphrase later must open the check
// already stored, or it is refused and nothing is sent.
export async function arm(phrase) {
  const words = String(phrase ?? '');
  if (words.length < 8) throw new Error('Use a passphrase of at least 8 characters. It stays on this phone.');
  const ls = localStorage;
  const had = ls.getItem('wc.cloud.salt');
  const saltBytes = had ? unb64(had) : crypto.getRandomValues(new Uint8Array(16));
  const next = await derive(words, saltBytes);
  const check = ls.getItem('wc.cloud.check');
  if (check) {
    try { if (await dec(next, check) !== CHECK) throw new Error('no'); }
    catch { throw new Error('That passphrase does not open the cloud copy.'); }
  } else {
    ls.setItem('wc.cloud.salt', b64(saltBytes));
    ls.setItem('wc.cloud.check', await enc(next, CHECK));
  }
  key = next;
  salt = saltBytes;
}

export async function seal(obj) {
  if (!key || !salt) throw new Error('The cloud is locked. Type the passphrase under Your company.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(obj)),
  ));
  return { wc: 'enc1', salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
