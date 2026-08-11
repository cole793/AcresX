(() => {
  const countyEl = document.getElementById('county');
  const form = document.getElementById('searchForm');
  if (!countyEl || !form || document.getElementById('state')) return;

  const WA_COUNTIES = Array.from(countyEl.options).map(option => option.value).filter(Boolean);
  const oldFindParcel = typeof findParcel === 'function' ? findParcel : null;

  const stateEl = document.createElement('select');
  stateEl.id = 'state';
  stateEl.className = 'control';
  stateEl.setAttribute('aria-label', 'State');
  stateEl.innerHTML = '<option value="WA">Washington</option><option value="MT">Montana (Beta)</option>';
  form.insertBefore(stateEl, countyEl);

  function populateCounties() {
    const state = stateEl.value;
    countyEl.innerHTML = '';
    if (state === 'MT') {
      countyEl.add(new Option('Yellowstone', 'Yellowstone'));
      countyEl.value = 'Yellowstone';
    } else {
      WA_COUNTIES.forEach(county => countyEl.add(new Option(county, county)));
      countyEl.value = WA_COUNTIES.includes('Spokane') ? 'Spokane' : WA_COUNTIES[0] || '';
    }

    const parcel = document.getElementById('parcel');
    if (parcel) parcel.placeholder = state === 'MT'
      ? 'Enter Yellowstone parcel / geocode number'
      : 'Enter assessor parcel number';
  }

  stateEl.addEventListener('change', populateCounties);
  populateCounties();

  if (oldFindParcel) {
    window.findParcel = async function (county, input) {
      if (stateEl.value !== 'MT') return oldFindParcel(county, input);

      const response = await fetch('/api/parcel-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'MT', county, parcelId: String(input || '').trim() })
      });
      const data = await response.json();
      if (!response.ok || !data?.parcel) throw new Error(data?.error || `Montana parcel service returned ${response.status}`);
      return data.parcel;
    };
  }

  const style = document.createElement('style');
  style.id = 'stateSelectorStyles';
  style.textContent = `
    .search-form{grid-template-columns:160px 210px minmax(220px,1fr) 170px!important}
    @media(max-width:900px){.search-form{grid-template-columns:1fr 1fr!important}.search-form .search-btn{grid-column:1/-1}}
    @media(max-width:700px){.search-form{grid-template-columns:1fr!important}.search-form .search-btn{grid-column:auto}}
  `;
  document.head.appendChild(style);

  const version = document.querySelector('.version');
  if (version) version.textContent = 'AcresX Multi-State Beta';
})();
