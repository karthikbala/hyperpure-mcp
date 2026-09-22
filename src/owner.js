let csrf = '',
  challengeId = '',
  reviewId = '';
const $ = (id) => document.getElementById(id),
  message = (text) => ($('message').textContent = text);
async function api(path, body) {
  const res = await fetch('/owner/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    $('signin').hidden = false;
    $('controls').hidden = true;
    $('review').hidden = true;
    $('verify').hidden = true;
    throw Error('Unlock your private controls to continue.');
  }
  const value = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(value.message || 'Could not complete the request. Please try later.');
  return value;
}
async function action(fn) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = true));
  try {
    message('');
    await fn();
  } catch (e) {
    message(e.message);
  } finally {
    document.querySelectorAll('button').forEach((b) => (b.disabled = false));
  }
}
function status(s) {
  if (s.loginChallenge) {
    challengeId = s.loginChallenge.id;
    $('verify').hidden = false;
  }
  if (s.state === 'READY') {
    $('verify').hidden = true;
    challengeId = '';
  }
  const labels = {
    READY: 'Connected',
    AUTH_REQUIRED: 'Login needed',
    OTP_PENDING: 'Waiting for your code',
    UNKNOWN: 'Checking connection',
    SITE_UNAVAILABLE: 'Hyperpure is temporarily unavailable',
    OUTLET_MISMATCH: 'Outlet needs attention',
    SETUP_REQUIRED: 'Initial setup is in progress',
    BROWSER_UNAVAILABLE: 'Browser is restarting',
  };
  $('state').textContent = labels[s.state] || s.state;
  $('verified').textContent = s.lastVerifiedAt
    ? 'Last verified: ' + new Date(s.lastVerifiedAt).toLocaleString()
    : 'Your account has not been verified yet.';
}
async function review() {
  const r = await api('api/review');
  $('review').hidden = !r;
  if (!r) return;
  reviewId = r.id;
  $('reviewTime').textContent = 'Valid until ' + new Date(r.expiresAt).toLocaleString();
  $('reviewDetails').textContent =
    r.snapshot.items.map((i) => `${i.quantity} × ${i.name}: ₹${i.lineTotal}`).join('\n') +
    '\n\n' +
    r.snapshot.checkoutText;
  $('approve').hidden = r.status !== 'PENDING' || r.expiresAt < Date.now();
  $('paymentLink').hidden = r.status !== 'AWAITING_MANUAL_PAYMENT';
}
$('access').onsubmit = (e) => {
  e.preventDefault();
  const key = e.target.key.value;
  e.target.reset();
  action(async () => {
    const s = await api('session', { key });
    csrf = s.csrf;
    $('signin').hidden = true;
    $('controls').hidden = false;
    status(await api('api/status'));
    await review();
  });
};
$('check').onclick = () =>
  action(async () => {
    status(await api('api/check', {}));
    await review();
  });
$('request').onclick = () =>
  action(async () => {
    const c = await api('api/request-otp', {});
    challengeId = c.challengeId;
    $('verify').hidden = false;
    message('Enter the code Hyperpure sends to your phone.');
  });
$('verify').onsubmit = (e) => {
  e.preventDefault();
  const otp = e.target.otp.value;
  e.target.reset();
  action(async () => {
    const s = await api('api/verify-otp', { challengeId, otp });
    status(s);
    if (s.state === 'READY') {
      $('verify').hidden = true;
      message('Connected. Account operations can resume.');
    }
  });
};
$('logout').onclick = () =>
  action(async () => {
    await api('api/logout', {});
    csrf = '';
    challengeId = '';
    $('controls').hidden = true;
    $('signin').hidden = false;
    $('verify').hidden = true;
    $('review').hidden = true;
  });
$('approve').onclick = () =>
  action(async () => {
    const r = await api('api/approve', { id: reviewId });
    message(r.message);
    await review();
  });
