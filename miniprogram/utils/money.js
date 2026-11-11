// Amounts are stored as integer cents. money() is the plain form used in input fields and
// CSV exports; moneyText() adds thousands separators for display only.
function money(cents) { return (cents / 100).toFixed(2); }
function moneyText(cents) {
  const text = money(Math.abs(cents)); const dot = text.indexOf('.');
  return (cents < 0 ? '-' : '') + text.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + text.slice(dot);
}
// Typed amounts may end with a dot ("12.") or start with one (".5"). Pasted amounts may carry
// thousands separators, but only in the usual places, so "12,34" is not read as 1234.
function amountInput(value) {
  const raw = String(value).trim();
  return /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(raw) ? raw.replace(/,/g, '') : raw;
}
function parseCents(raw) {
  const [whole, fraction = ''] = raw.split('.');
  return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
}
module.exports = { money, moneyText, amountInput, parseCents };
