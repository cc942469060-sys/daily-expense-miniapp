const store = require('./utils/store');
App({
  onLaunch() { try { store.protect(); } catch (e) { console.error('账本读取失败', e.message); } },
  // Unexpected errors still reach the console; they are also kept (without bill content) for
  // the diagnostic summary on the backup page.
  onError(message) { store.recordError('error', message); },
  onUnhandledRejection(event) { store.recordError('rejection', event && event.reason); }
});
