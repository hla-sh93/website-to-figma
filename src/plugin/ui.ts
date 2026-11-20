import { validateScene, type ScenePackage } from '../core/scene.js';
import { createRequestKey } from './request-key.js';
import { collectFontRequests } from './fonts.js';
declare const __DIAGNOSTICS__: boolean;
import type { RenderResult } from './renderer.js';
import {
  connectLocalService,
  installedPairingKey,
  installedVerificationUrl,
} from './connection.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const select = (id: string) => $<HTMLSelectElement>(id);
const send = (type: string, data: object = {}) =>
  parent.postMessage({ pluginMessage: { type, ...data, __channel: installedPairingKey() } }, '*');
let token = '',
  busy = false,
  phase = 'idle',
  generation = 0,
  jobId: string | undefined,
  scene: ScenePackage | undefined,
  substituted = false;
let connectionError = 'تعذر الاتصال بخدمة الالتقاط. اضغطي نسخ للمحاولة مجدداً.';
let touched = false,
  pasteTimer: ReturnType<typeof setTimeout> | undefined;
let connection: Promise<boolean> | undefined;
const verificationUrl = installedVerificationUrl();
const ownedVerification = ['fixture:reference', 'fixture:features'].includes(verificationUrl);
let bridgeEvents = 0;
function report(stage: string, data: object = {}) {
  if (!__DIAGNOSTICS__) return;
  void fetch('http://localhost:4017/plugin-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Plugin-Pairing': installedPairingKey() },
    body: JSON.stringify({ stage, data }),
  }).catch(() => {});
}
const status = (text: string, error = false) => {
  $('status').textContent = text;
  $('status').className = error ? 'error' : '';
};
function setBusy(value: boolean) {
  busy = value;
  $<HTMLFieldSetElement>('settings').disabled = value;
  $<HTMLButtonElement>('submit').disabled = value;
  $('progress').hidden = !value;
  $('cancel').hidden = !value;
  $('submit').textContent = value ? 'جارٍ النسخ…' : 'نسخ إلى Figma';
  if (!value) phase = 'idle';
}
function finishError(message: string) {
  report('error', { phase, message: message.replaceAll(installedPairingKey(), '[private]') });
  setBusy(false);
  $('font-note').hidden = true;
  status(message, true);
}
function ensureConnection(): Promise<boolean> {
  if (token) return Promise.resolve(true);
  if (connection) return connection;
  connection = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      report('pair-start');
      token = await connectLocalService((url, options) =>
        fetch(url, { ...options, signal: controller.signal }),
      );
      report('pair-ready');
      if (!busy) status('');
      return true;
    } catch (error) {
      connectionError = error instanceof Error ? error.message : 'تعذر الاتصال.';
      report('pair-error', {
        name: error instanceof Error ? error.name : 'unknown',
        message: connectionError,
      });
      if (!busy) status(connectionError, true);
      return false;
    } finally {
      clearTimeout(timeout);
      connection = undefined;
    }
  })();
  return connection;
}
async function api(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  const response = await fetch('http://localhost:4017' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...options.headers,
    },
  });
  if (response.status === 401 && retry) {
    token = '';
    if (await ensureConnection()) return api(path, options, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? 'انتهت جلسة الالتقاط. حاولي مجدداً.'
        : String(data.error || 'تعذر إكمال النسخ.'),
    );
  return data;
}
function validUrl() {
  if (ownedVerification) return true;
  try {
    const url = new URL($<HTMLInputElement>('url').value.trim());
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
function savePreferences() {
  if (verificationUrl) return;
  send('SAVE_PREFERENCES', {
    preferences: {
      size: select('size').value,
      theme: select('theme').value,
      language: select('language').value,
    },
  });
}
async function capture() {
  if (busy) return;
  clearTimeout(pasteTimer);
  pasteTimer = undefined;
  if (!validUrl()) {
    status('الصقي رابط موقع يبدأ بـ https:// أو http://', true);
    return;
  }
  const requestId = ++generation;
  jobId = undefined;
  scene = undefined;
  substituted = false;
  $('notes').hidden = true;
  $('font-note').hidden = true;
  setBusy(true);
  phase = 'connecting';
  status('جارٍ الاتصال…');
  try {
    if (!(await ensureConnection())) {
      if (requestId === generation) finishError(connectionError);
      return;
    }
    if (requestId !== generation) return;
    savePreferences();
    phase = 'capture';
    status('جارٍ التقاط الموقع…');
    const size = select('size').value,
      language = select('language').value;
    const job = await api('/jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': createRequestKey() },
      body: JSON.stringify({
        ...(ownedVerification
          ? {
              demo: true,
              ...(verificationUrl === 'fixture:features' ? { selector: '#features' } : {}),
            }
          : { url: $<HTMLInputElement>('url').value.trim() }),
        widths:
          size === 'all'
            ? [1440, 768, 390]
            : size === 'desktop-mobile'
              ? [1440, 390]
              : [Number(size)],
        theme: select('theme').value,
        ...(language === 'original' ? {} : { language }),
      }),
    });
    if (requestId !== generation) {
      void api('/jobs/' + job.id, { method: 'DELETE' }).catch(() => {});
      return;
    }
    jobId = job.id;
    report('capture-started', { jobId });
    while (requestId === generation) {
      const state = await api('/jobs/' + jobId);
      if (requestId !== generation) return;
      if (state.state === 'ready') {
        // Screenshots are only needed by the comparison tools, never by the editor.
        const value = await api('/jobs/' + jobId + '/scene?screenshots=0');
        if (requestId !== generation) return;
        scene = validateScene(value);
        report('capture-ready', {
          jobId,
          title: scene.capture.title,
          screens: scene.screens.length,
        });
        phase = 'fonts';
        status('جارٍ تجهيز الخطوط…');
        send('PREFLIGHT', { fonts: collectFontRequests(scene), fallback: 'Inter', requestId });
        return;
      }
      if (state.state === 'failed' || state.state === 'cancelled')
        throw new Error(state.error || 'تعذر التقاط الموقع.');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    if (requestId === generation)
      finishError(
        error instanceof TypeError
          ? 'تعذر الاتصال بخدمة الالتقاط المحلية.'
          : error instanceof Error
            ? error.message
            : 'تعذر إكمال النسخ.',
      );
  }
}
function insert(allowSubstitution = false) {
  if (!scene || !busy) return;
  substituted = allowSubstitution;
  phase = 'import';
  $('font-note').hidden = true;
  status('جارٍ إنشاء التصميم في Figma…');
  report('native-import-start', { requestId: generation, allowSubstitution });
  send('IMPORT', {
    scene,
    allowSubstitution,
    foundations: true,
    fallback: 'Inter',
    requestId: generation,
  });
}
function showNotes(result: RenderResult) {
  const messages = new Set<string>();
  for (const issue of [
    ...scene!.issues.filter((issue) => issue.severity === 'warning'),
    ...result.issues,
  ]) {
    const code = issue.code.toLowerCase();
    messages.add(
      /font/.test(code)
        ? 'بعض الخطوط أو تفاصيل النص تحتاج مراجعة.'
        : /image|asset|crop/.test(code)
          ? 'راجعي الصور والقص عند تغيير حجم الإطار.'
          : /layout|spacing|margin/.test(code)
            ? 'بعض ترتيبات الموقع محفوظة كمواضع ثابتة.'
            : /effect|transform|pseudo|media/.test(code)
              ? 'بعض التأثيرات المرئية غير مدعومة بالكامل.'
              : 'توجد تفاصيل في الموقع تحتاج مراجعة بعد النسخ.',
    );
  }
  if (substituted) messages.add('استُخدم خط بديل بموافقتك؛ قد يختلف التفاف النص.');
  $('note-list').replaceChildren();
  for (const message of messages) {
    const li = document.createElement('li');
    li.textContent = message;
    $('note-list').append(li);
  }
  $('notes').hidden = messages.size === 0;
  ($('notes') as HTMLDetailsElement).open = messages.size > 0;
  return messages.size > 0;
}
$('capture-form').onsubmit = (event) => {
  event.preventDefault();
  void capture();
};
$('submit').onclick = () => void capture();
$('url').onkeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void capture();
  }
};
$('url').addEventListener('paste', () => {
  setTimeout(() => {
    if (busy || !validUrl()) return;
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(() => void capture(), 900);
  }, 0);
});
for (const id of ['size', 'theme', 'language'])
  select(id).onchange = () => {
    touched = true;
    savePreferences();
    if (pasteTimer) {
      clearTimeout(pasteTimer);
      pasteTimer = setTimeout(() => void capture(), 900);
    }
  };
$('allow-fonts').onclick = () => insert(true);
$('cancel').onclick = async () => {
  if (!busy) return;
  if (phase === 'import') {
    phase = 'stopping';
    status('جارٍ إلغاء النسخ…');
    send('CANCEL');
    return;
  }
  generation++;
  const cancelledJob = jobId;
  jobId = undefined;
  setBusy(false);
  $('font-note').hidden = true;
  status('تم الإلغاء.');
  if (cancelledJob)
    try {
      await api('/jobs/' + cancelledJob, { method: 'DELETE' });
    } catch {}
};
window.onmessage = async (event: MessageEvent) => {
  const data = event.data?.pluginMessage;
  if (!data || typeof data.type !== 'string') return;
  if (data.type === 'NATIVE_FUNCTIONAL' && data.__channel === installedPairingKey()) {
    report('native-functional', data.report);
    return;
  }
  if (__DIAGNOSTICS__ && bridgeEvents++ < 24)
    report('bridge-message', {
      kind: data.type,
      source:
        event.source === parent
          ? 'parent'
          : event.source === window
            ? 'self'
            : event.source === null
              ? 'null'
              : 'other',
      accepted: data.__channel === installedPairingKey(),
    });
  if (data.__channel !== installedPairingKey()) return;
  if (__DIAGNOSTICS__ && data.type === 'NATIVE_PREVIEW') {
    report('native-preview', {
      png: data.png,
      screenId: data.screenId,
      nodeId: data.nodeId,
      pageId: data.pageId,
      nodes: data.nodes,
    });
    return;
  }
  if (data.type === 'PREFERENCES') {
    if (!touched && !busy && data.preferences)
      for (const id of ['size', 'theme', 'language']) {
        const value = String(data.preferences[id]);
        if ([...select(id).options].some((option) => option.value === value))
          select(id).value = value;
      }
    return;
  }
  if (data.requestId !== generation || !busy) return;
  if (data.type === 'ERROR') {
    finishError(String(data.message || 'تعذر إكمال النسخ.'));
    return;
  }
  if (data.type === 'CANCELLED') {
    setBusy(false);
    status('تم الإلغاء.');
    return;
  }
  if (data.type === 'PREFLIGHT_RESULT' && phase === 'fonts') {
    if (data.missing.length) {
      if (__DIAGNOSTICS__ && verificationUrl) {
        report('verification-substitution', { count: data.missing.length });
        insert(true);
        return;
      }
      report('missing-fonts', { count: data.missing.length });
      $('font-note').hidden = false;
      $('progress').hidden = true;
      $('font-message').textContent =
        'خط الموقع غير متوفر في Figma. ثبّتيه للحفاظ على النص، أو اختاري المتابعة بخط بديل.';
      status('بانتظار الخط المطلوب.');
    } else insert();
    return;
  }
  if (data.type === 'IMPORT_PROGRESS' && phase === 'import') {
    $<HTMLProgressElement>('progress').max = data.total;
    $<HTMLProgressElement>('progress').value = data.done;
  }
  if (data.type === 'IMPORT_RESULT') {
    report('native-import-complete', {
      stats: data.result.stats,
      createdNodeIds: data.result.createdNodeIds,
      screenIds: data.result.screenIds,
      issues: data.result.issues,
    });
    if (__DIAGNOSTICS__ && verificationUrl) send('VERIFY_PREVIEW', { requestId: generation });
    const needsReview = showNotes(data.result);
    setBusy(false);
    status(
      substituted
        ? 'تم النسخ باستخدام خط بديل. راجعي فروقات الدقة.'
        : needsReview
          ? 'تم إنشاء الطبقات. توجد فروقات تحتاج مراجعة.'
          : 'تم نسخ التصميم إلى Figma.',
    );
  }
};
send('READY');
report('ui-boot', { verification: Boolean(verificationUrl) });
void ensureConnection();
if (__DIAGNOSTICS__ && verificationUrl) {
  touched = true;
  select('size').value = ownedVerification ? '1440' : 'desktop-mobile';
  select('theme').value = 'light';
  select('language').value = 'original';
  const input = $<HTMLInputElement>('url');
  if (ownedVerification) {
    input.type = 'text';
    input.readOnly = true;
    input.value =
      verificationUrl === 'fixture:features'
        ? 'Forma — فحص المكوّنات'
        : 'Forma — صفحة اختبار مملوكة';
  } else input.value = verificationUrl;
  setTimeout(() => void capture(), 1000);
}
