const store = require('./utils/store');
App({ onLaunch() { try { store.read(); } catch (e) { console.error('账本读取失败', e.message); } } });
