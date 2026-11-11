// Helpers for the paged bill lists on the home and bills pages.
// Only the fields the list shows (plus the amount used for sorting) are sent to the view layer.
const FIELDS = ['id', 'type', 'amountCents', 'refundCents', 'payment', 'date', 'time', 'note', 'categoryName', 'icon', 'typeName', 'sign', 'amountText', 'refundText'];
function pick(bill) { const view = {}; FIELDS.forEach(key => { view[key] = bill[key]; }); return view; }
function viewGroups(groups) { return groups.map(group => Object.assign({}, group, { records: group.records.map(pick) })); }
// setData path updates that append a page of groups after the shown ones, so only the new page
// crosses to the view layer. A day split across pages is extended in place.
function appendGroups(shown, added, update = {}) {
  let index = shown.length; const rest = added.slice();
  if (index && rest.length && shown[index - 1].date === rest[0].date) {
    const last = shown[index - 1]; const first = rest.shift();
    first.records.forEach((bill, i) => { update[`groups[${index - 1}].records[${last.records.length + i}]`] = bill; });
  }
  rest.forEach(group => { update[`groups[${index++}]`] = group; });
  return update;
}
module.exports = { pick, viewGroups, appendGroups };
