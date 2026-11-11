// Applies a setData payload like the mini program runtime, including path keys such as
// "groups[2].records[5]", so tests see the same data as the page.
function applySetData(data, payload) {
  for (const [path, value] of Object.entries(payload)) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let node = data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (node[keys[i]] === undefined || node[keys[i]] === null) node[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
  }
}
module.exports = { applySetData };
