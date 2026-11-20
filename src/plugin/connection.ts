/** The personalized main bundle shares its installation credential only with its UI. */
export const installedPairingKey = () => '__HLA_LOCAL_PAIRING_KEY__';
export function installedVerificationUrl() {
  const value = '__HLA_VERIFICATION_URL__';
  return /^(https?|fixture)%3A/i.test(value) ? decodeURIComponent(value) : '';
}
export async function connectLocalService(
  request: typeof fetch = fetch,
  base = 'http://localhost:4017',
  pairingKey = installedPairingKey(),
) {
  const response = await request(base + '/plugin-session', {
    method: 'GET',
    headers: { 'X-Plugin-Pairing': pairingKey },
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'تعذر التحقق من اتصال البلوغن. أعيدي فتحه بعد التحديث.'
        : 'تعذر الاتصال بخدمة الالتقاط. حاولي مجدداً.',
    );
  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || !/^[a-f0-9]{48}$/.test(data.token))
    throw new Error('تعذر الاتصال بخدمة الالتقاط.');
  return data.token;
}
