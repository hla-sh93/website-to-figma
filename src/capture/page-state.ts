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
  const text = document.body?.innerText ?? '';
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
    hash(document.body?.innerText ?? ''),
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

/**
 * Freezes motion after the page has loaded, scrolled and decoded: finishes
 * finite CSS/Web animations at their end state, pauses infinite ones, clears
 * pending timers and stops new timers, animation frames, idle callbacks and
 * animations. The capture's own scripts use the saved __captureTimeout.
 */
export function freezePage(): void {
  const w = window as Window & { __figmaFrozen?: boolean };
  if (w.__figmaFrozen) return;
  w.__figmaFrozen = true;
  for (const animation of document.getAnimations()) {
    try {
      const timing = animation.effect?.getComputedTiming();
      if (timing && Number.isFinite(timing.endTime as number)) animation.finish();
      else animation.pause();
    } catch {
      try {
        animation.pause();
      } catch {}
    }
  }
  const last = setTimeout(() => {}, 0) as unknown as number;
  for (let id = 0; id <= last; id++) {
    clearTimeout(id);
    clearInterval(id);
  }
  // Keep a private timer for the capture's own scripts, then stop page scheduling.
  (w as unknown as Record<string, unknown>).__captureTimeout = setTimeout.bind(window);
  w.requestAnimationFrame = () => 0;
  w.setInterval = (() => 0) as unknown as typeof setInterval;
  w.setTimeout = (() => 0) as unknown as typeof setTimeout;
  (w as unknown as Record<string, unknown>).requestIdleCallback = () => 0;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<typeof animate>) {
    const animation = animate.apply(this, args);
    animation.pause();
    return animation;
  };
  for (const video of document.querySelectorAll('video')) video.pause();
  for (const marquee of document.querySelectorAll('marquee'))
    (marquee as HTMLElement & { stop?: () => void }).stop?.();
}
