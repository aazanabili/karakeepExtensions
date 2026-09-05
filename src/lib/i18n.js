// Lightweight runtime i18n (AR/EN) with RTL/LTR switching — shared by popup, newtab and options.

const STR = {
  en: {
    appTitle: 'TabSync',
    searchPlaceholder: 'Search lists and links…',
    refresh: 'Refresh',
    syncNow: 'Sync now',
    settings: 'Settings',
    openDashboard: 'Open dashboard',
    status: 'Status',
    lastSync: 'Last sync',
    never: 'never',
    syncingNow: 'Syncing…',
    syncOk: 'Up to date',
    syncPending: 'Pending changes',
    syncError: 'Sync error',
    notConfigured: 'Not configured — open Settings',
    openInNewWindow: 'Open in new window',
    openHere: 'Open in this window',
    copyAll: 'Copy links',
    copied: 'Copied!',
    linksLabel: 'links',
    noLists: 'No lists yet. Create a tab group and it will appear here.',
    noResults: 'No local results — press Enter to search the web',
    reconnectFolder: 'Reconnect folder',
    folderNeeded: 'Local folder permission is required to read/write your lists.',
    updated: 'Updated',
    activity: 'Activity log',
    emptyLog: 'No activity yet',
    restored: 'Restored',
    driverLabel: 'Storage driver',
    driverKarakeep: 'Karakeep server',
    driverLocal: 'Local TXT folder',
    serverUrlLabel: 'Server URL',
    apiKeyLabel: 'API key',
    testConnection: 'Test connection',
    testOk: 'Connection OK',
    testFail: 'Connection failed',
    pickFolder: 'Choose folder',
    folderOk: 'Folder linked',
    deleteModeLabel: 'On tab close',
    deleteArchive: 'Archive bookmarks',
    deleteHard: 'Delete permanently',
    nonListLabel: 'Ungrouped tabs list name',
    themeLabel: 'Theme',
    themeAuto: 'Auto',
    themeLight: 'Light',
    themeDark: 'Dark',
    langLabel: 'Language',
    langAuto: 'Auto (browser)',
    saveBtn: 'Save',
    savedMsg: 'Saved',
    exportBtn: 'Export backup (JSON)',
    importBtn: 'Import backup',
    importOk: 'Backup imported',
    importFail: 'Invalid backup file',
    manualSyncDone: 'Sync complete',
    errorGeneric: 'Error',
    grantRetry: 'Grant access',
    liveBadge: 'Open now',
    archivedBadge: 'Archived'
  },
  ar: {
    appTitle: 'TabSync',
    searchPlaceholder: 'ابحث في القوائم والروابط…',
    refresh: 'تحديث',
    syncNow: 'مزامنة الآن',
    settings: 'الإعدادات',
    openDashboard: 'فتح اللوحة',
    status: 'الحالة',
    lastSync: 'آخر مزامنة',
    never: 'أبداً',
    syncingNow: 'جارٍ المزامنة…',
    syncOk: 'مُحدَّث',
    syncPending: 'تغييرات معلّقة',
    syncError: 'خطأ في المزامنة',
    notConfigured: 'غير مُهيأ — افتح الإعدادات',
    openInNewWindow: 'فتح في نافذة جديدة',
    openHere: 'فتح في هذه النافذة',
    copyAll: 'نسخ الروابط',
    copied: 'تم النسخ!',
    linksLabel: 'رابط',
    noLists: 'لا توجد قوائم بعد. أنشئ مجموعة تبويبات وستظهر هنا.',
    noResults: 'لا نتائج محلية — اضغط Enter للبحث في الويب',
    reconnectFolder: 'إعادة ربط المجلد',
    folderNeeded: 'صلاحية المجلد المحلي مطلوبة لقراءة/كتابة القوائم.',
    updated: 'آخر تحديث',
    activity: 'سجل العمليات',
    emptyLog: 'لا يوجد نشاط بعد',
    restored: 'تمت الاستعادة',
    driverLabel: 'نظام التخزين',
    driverKarakeep: 'سيرفر Karakeep',
    driverLocal: 'مجلد TXT محلي',
    serverUrlLabel: 'رابط السيرفر',
    apiKeyLabel: 'مفتاح API',
    testConnection: 'اختبار الاتصال',
    testOk: 'الاتصال ناجح',
    testFail: 'فشل الاتصال',
    pickFolder: 'اختيار المجلد',
    folderOk: 'المجلد مربوط',
    deleteModeLabel: 'عند إغلاق تبويب',
    deleteArchive: 'أرشفة الروابط',
    deleteHard: 'حذف نهائي',
    nonListLabel: 'اسم قائمة التبويبات غير المجمّعة',
    themeLabel: 'المظهر',
    themeAuto: 'تلقائي',
    themeLight: 'نهاري',
    themeDark: 'ليلي',
    langLabel: 'اللغة',
    langAuto: 'تلقائي (المتصفح)',
    saveBtn: 'حفظ',
    savedMsg: 'تم الحفظ',
    exportBtn: 'تصدير نسخة احتياطية (JSON)',
    importBtn: 'استيراد نسخة احتياطية',
    importOk: 'تم الاستيراد',
    importFail: 'ملف غير صالح',
    manualSyncDone: 'اكتملت المزامنة',
    errorGeneric: 'خطأ',
    grantRetry: 'منح الصلاحية',
    liveBadge: 'مفتوح الآن',
    archivedBadge: 'محفوظ'
  }
};

export function resolveLang(settings) {
  if (settings.lang && settings.lang !== 'auto') return settings.lang;
  try {
    return (chrome.i18n?.getUILanguage?.() || 'en').toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function makeT(lang) {
  return (key) => STR[lang]?.[key] ?? STR.en[key] ?? key;
}

export function applyI18n(root, t, lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

export function applyTheme(theme) {
  const dark = theme === 'dark' ||
    (theme === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function relTime(ts, lang) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const mins = Math.round(diff / 60000);
  if (mins < 1) return rtf.format(0, 'minute');
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
}
