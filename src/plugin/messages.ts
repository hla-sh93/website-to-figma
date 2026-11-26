/**
 * Errors reach the plugin as technical English text from the browser engine, the
 * capture service or Figma. The interface is Arabic, so each known failure is shown
 * as a short Arabic sentence that says what happened and what to try.
 */
const RULES: [RegExp, string][] = [
  // The website could not be reached.
  [
    /ERR_NAME_NOT_RESOLVED|could not be resolved|DNS timeout|ENOTFOUND/i,
    'عنوان الموقع غير موجود. تأكدي من كتابة الرابط بشكل صحيح.',
  ],
  [
    /ERR_EMPTY_RESPONSE|ERR_CONNECTION_(REFUSED|RESET|CLOSED|ABORTED|FAILED)|ERR_ADDRESS_UNREACHABLE|ECONNREFUSED|ECONNRESET/i,
    'الموقع لا يستجيب على هذا الرابط، مع www وبدونها. تأكدي من الرابط ومن أن الموقع يعمل.',
  ],
  [
    /ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|Upstream timeout|ETIMEDOUT/i,
    'انتهت مهلة الاتصال بالموقع. قد يكون الموقع متوقفاً أو بطيئاً؛ حاولي مجدداً بعد قليل.',
  ],
  [
    /ERR_CERT_|ERR_SSL_|ERR_BAD_SSL|certificate/i,
    'شهادة الأمان الخاصة بالموقع غير صالحة، لذلك تعذر فتحه.',
  ],
  [/ERR_TOO_MANY_REDIRECTS/i, 'الموقع يعيد التوجيه بشكل متكرر ولا يفتح أي صفحة.'],
  [
    /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_PROXY_|ERR_TUNNEL_/i,
    'لا يوجد اتصال بالإنترنت. تأكدي من الاتصال ثم حاولي مجدداً.',
  ],
  [
    /ERR_BLOCKED_|ERR_ACCESS_DENIED|ERR_HTTP_RESPONSE_CODE_FAILURE|ERR_INVALID_RESPONSE|ERR_ABORTED/i,
    'رفض الموقع فتح الصفحة. بعض المواقع تمنع المتصفحات الآلية.',
  ],
  // The page opened but could not be captured.
  [
    /Timeout \d+ms exceeded|Capture timeout|exceeded while|stopped responding/i,
    'استغرق تحميل الموقع وقتاً أطول من المسموح. حاولي مجدداً، أو جرّبي مقاساً واحداً.',
  ],
  [
    /did not reveal visible content/i,
    'لم يظهر أي محتوى في الصفحة. قد يتطلب الموقع تسجيل الدخول أو يمنع المتصفحات الآلية.',
  ],
  [
    /network (byte budget|request limit)|Image budget/i,
    'الصفحة أكبر من الحد المسموح للالتقاط. جرّبي صفحة أصغر أو مقاساً واحداً.',
  ],
  [/Capture aborted|Import cancelled/i, 'تم الإلغاء.'],
  [/Capture selector/i, 'الجزء المطلوب من الصفحة غير موجود أو غير ظاهر.'],
  // The link itself is not accepted.
  [
    /Enter a complete|Invalid website URL|Only HTTP and HTTPS/i,
    'الرابط غير صالح. الصقي رابطاً كاملاً يبدأ بـ https:// أو http://',
  ],
  [
    /Local and internal|public address|private or non-public/i,
    'يمكن نسخ المواقع العامة على الإنترنت فقط؛ العناوين المحلية والداخلية غير مسموحة.',
  ],
  [/credentials are not allowed/i, 'الروابط التي تحتوي على اسم مستخدم أو كلمة مرور غير مسموحة.'],
  [/standard web ports|HTTPS tunnel/i, 'هذا الرابط يستخدم منفذاً غير مسموح.'],
  [
    /Invalid capture (widths|height|language)/i,
    'إعدادات النسخ غير صالحة. اختاري المقاس واللغة من جديد.',
  ],
  // Figma and the local service.
  [
    /Unable to establish connection to Figma|check your internet connection/i,
    'تعذر على Figma الاتصال بخوادمه. تأكدي من اتصال الإنترنت في Figma ثم حاولي مجدداً.',
  ],
  [/already running/i, 'هناك عملية نسخ جارية. انتظري انتهاءها أو ألغيها أولاً.'],
  [
    /Missing exact editor fonts|unloaded font/i,
    'بعض خطوط الموقع غير متوفرة في Figma. ثبّتي الخط أو اسمحي باستخدام خط بديل.',
  ],
  [
    /Failed to fetch|NetworkError|Load failed|Request failed/i,
    'تعذر الاتصال بخدمة الالتقاط على هذا الجهاز. تأكدي من أنها تعمل ثم حاولي مجدداً.',
  ],
  [
    /Invalid scene|Invalid base64|Unsafe SVG|Invalid font/i,
    'بيانات الالتقاط غير سليمة. حاولي النسخ مجدداً.',
  ],
  [
    /frame (not found|was removed)|container was removed|parent was removed|Screen not found|duplicate variable name|^Layer import/i,
    'تعذر إنشاء التصميم في Figma. حاولي النسخ مجدداً في صفحة فارغة.',
  ],
];

/** The technical text, without colour codes or the engine's call log, on one line. */
export function technicalDetail(raw: string): string {
  return raw
    .replace(/\u001b?\[\d{1,3}m/g, '')
    .replace(/Call log:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function arabicError(raw: string): string {
  const text = String(raw ?? '');
  // Already written for the user.
  if (/[؀-ۿ]/.test(text) && !/[A-Za-z]{4,}.*(Error|ERR_|:)/.test(text)) return text;
  for (const [pattern, message] of RULES) if (pattern.test(text)) return message;
  const detail = technicalDetail(text);
  return detail ? `تعذر إكمال النسخ. (التفاصيل التقنية: ${detail})` : 'تعذر إكمال النسخ.';
}
