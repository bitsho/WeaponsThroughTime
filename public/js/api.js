/* Data access: live API first, static export second, inlined bundle last. */
window.WTTApi = (function () {
  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(url + ' → ' + r.status);
    return r.json();
  }
  async function loadBundle(country) {
    if (window.__WTT_BUNDLE__) return { data: window.__WTT_BUNDLE__, source: 'inline' };
    try { return { data: await getJSON(`api/v1/bundle?country=${encodeURIComponent(country)}`), source: 'api' }; }
    catch (e) { return { data: await getJSON(`data/bundle-${country}.json`), source: 'static' }; }
  }
  return { loadBundle, getJSON };
})();
