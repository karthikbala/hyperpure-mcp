import { createHmac } from 'node:crypto';

// References are local to an installation, stable across token rotation, and not login secrets.
export function responseIdentity({ key, mobile, binding, outletId, verified = false }) {
  const reference = (value) => (key ? createHmac('sha256', key).update(value).digest('hex') : null);
  return {
    account: {
      reference: reference(`account:${mobile}`),
      loginMobileMasked: mobile ? `******${mobile.slice(-4)}` : null,
      source: 'configured_login',
    },
    outlet: {
      reference: binding ? reference(`outlet:${mobile}:${binding.text}`) : null,
      id: outletId || null,
      idSource: outletId ? 'last_verified_history_request' : null,
      name: binding?.parts?.[0]?.replace(/:$/, '') || null,
      address: binding?.parts?.[1] || null,
      displayText: binding?.text || null,
      source: 'configured_binding',
    },
    verification: verified ? 'outlet_verified' : 'unverified',
  };
}
