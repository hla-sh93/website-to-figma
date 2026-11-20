/** Standalone browser functions: do not reference module variables when serialized. */
export function captureGate(): string | null {
  const visible = (selector: string) =>
    [...document.querySelectorAll(selector)].some((el) => {
      const box = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return (
        box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
      );
    });
  const text = document.body.innerText;
  if (
    visible('form[action*="validateCaptcha"], #captchacharacters') ||
    (/just a moment|robot check|attention required|verify you are human/i.test(document.title) &&
      visible('#challenge-form, #cf-challenge-running, iframe[src*="challenges.cloudflare.com"]'))
  )
    return 'human-verification';
  if (
    /(^|\.)amazon\./i.test(location.hostname) &&
    text.length < 1500 &&
    /click the button below to continue shopping/i.test(text) &&
    [...document.querySelectorAll('button,input[type="submit"]')].some((el) =>
      /^continue shopping$/i.test((el.textContent || (el as HTMLInputElement).value || '').trim()),
    )
  )
    return 'access-interstitial';
  return null;
}

export function pageFingerprint(): string {
  const hash = (value: string) => {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++)
      result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return result >>> 0;
  };
  return JSON.stringify([
    document.documentElement.scrollHeight,
    hash(document.body.innerText),
    [...document.images]
      .slice(0, 1000)
      .map((image) => [image.currentSrc, image.complete, image.naturalWidth, image.naturalHeight]),
    [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input,textarea,select',
      ),
    ]
      .slice(0, 1000)
      .map((control) => [
        hash(
          control instanceof HTMLInputElement && control.type === 'password'
            ? String(control.value.length)
            : control.value,
        ),
        control instanceof HTMLInputElement ? control.checked : null,
      ]),
    [...document.querySelectorAll('body *')].slice(0, 2200).map((el) => {
      const box = el.getBoundingClientRect(),
        style = getComputedStyle(el);
      return [
        ...[box.x, box.y, box.width, box.height].map((value) => Math.round(value * 10) / 10),
        style.opacity,
        style.color,
        style.backgroundColor,
        style.backgroundImage,
        style.transform,
        style.font,
        style.fontVariationSettings,
      ];
    }),
  ]);
}
