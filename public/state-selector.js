(() => {
  const countyEl = document.getElementById('county');
  const form = document.getElementById('searchForm');
  if (!countyEl || !form || document.getElementById('state')) return;

  const WA_COUNTIES = Array.from(countyEl.options).map(option => option.value).filter(Boolean);
  const MT_COUNTIES = ['Beaverhead','Big Horn','Blaine','Broadwater','Carbon','Carter','Cascade','Chouteau','Custer','Daniels','Dawson','Deer Lodge','Fallon','Fergus','Flathead','Gallatin','Garfield','Glacier','Golden Valley','Granite','Hill','Jefferson','Judith Basin','Lake','Lewis and Clark','Liberty','Lincoln','Madison','McCone','Meagher','Mineral','Missoula','Musselshell','Park','Petroleum','Phillips','Pondera','Powder River','Powell','Prairie','Ravalli','Richland','Roosevelt','Rosebud','Sanders','Sheridan','Silver Bow','Stillwater','Sweet Grass','Teton','Toole','Treasure','Valley','Wheatland','Wibaux','Yellowstone'];
  const oldFindParcel = typeof findParcel === 'function' ? findParcel : null;
  const oldFindWells = typeof findWells === 'function' ? findWells : null;
  const oldFindUtility = typeof findUtility === 'function' ? findUtility : null;

  const stateEl = document.createElement('select');
  stateEl.id = 'state';
  stateEl.className = 'control';
  stateEl.setAttribute('aria-label', 'State');
  stateEl.innerHTML = '<option value="" selected>Select a state</option><option value="WA">Washington</option><option value="MT">Montana (Beta)</option>';
  form.insertBefore(stateEl, countyEl);

  function updateHeroLabel() {
    const searchCard = document.querySelector('.search-card');
    if (!searchCard) return;
    const eyebrow = searchCard.querySelector('.eyebrow');
    if (eyebrow) eyebrow.textContent = 'Parcel Research';
  }

  function updateBetaLabels() {
    const stateName = stateEl.value === 'MT' ? 'Montana' : stateEl.value === 'WA' ? 'Washington' : 'AcresX';
    const sideNote = document.querySelector('.sidebar .side-note');
    if (sideNote) {
      const heading = sideNote.querySelector('strong, b');
      if (heading) heading.textContent = stateEl.value ? `${stateName} beta` : 'Beta';
    }
    const version = document.querySelector('.version');
    if (version) version.textContent = 'AcresX Multi-State Beta';
    updateHeroLabel();
  }

  function populateCounties() {
    const state = stateEl.value;
    countyEl.innerHTML = '';
    if (!state) {
      countyEl.add(new Option('Select a state first', ''));
      countyEl.disabled = true;
    } else if (state === 'MT') {
      countyEl.disabled = false;
      countyEl.add(new Option('Select a county', ''));
      MT_COUNTIES.forEach(county => countyEl.add(new Option(county, county)));
      countyEl.value = '';
    } else {
      countyEl.disabled = false;
      WA_COUNTIES.forEach(county => countyEl.add(new Option(county, county)));
      countyEl.value = WA_COUNTIES.includes('Spokane') ? 'Spokane' : WA_COUNTIES[0] || '';
    }

    const parcel = document.getElementById('parcel');
    if (parcel) {
      parcel.value = '';
      parcel.disabled = !state;
      parcel.placeholder = !state ? 'Select a state first' : state === 'MT' ? 'Enter Montana parcel geocode / assessment code' : 'Enter assessor parcel number';
    }
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) searchBtn.disabled = !state;
    updateBetaLabels();
  }

  stateEl.addEventListener('change', populateCounties);
  populateCounties();

  form.addEventListener('submit', event => {
    if (!stateEl.value || (stateEl.value === 'MT' && !countyEl.value)) {
      event.preventDefault();
      (!stateEl.value ? stateEl : countyEl).focus();
    }
  }, true);

  if (oldFindParcel) {
    window.findParcel = async function (county, input) {
      if (!stateEl.value) throw new Error('Select a state before searching a parcel.');
      if (stateEl.value !== 'MT') return oldFindParcel(county, input);
      if (!county) throw new Error('Select a Montana county before searching.');
      const response = await fetch('/api/parcel-search', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:'MT', county, parcelId:String(input || '').trim()}) });
      const data = await response.json();
      if (!response.ok || !data?.parcel) throw new Error(data?.error || `Montana parcel service returned ${response.status}`);
      return data.parcel;
    };
  }

  if (oldFindWells) {
    window.findWells = async function (parcel) {
      if (stateEl.value !== 'MT') return oldFindWells(parcel);
      const [lon, lat] = turf.centroid(parcel).geometry.coordinates;
      const response = await fetch('/api/well-search', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:'MT', county:countyEl.value, lat, lon}) });
      const data = await response.json();
      if (!response.ok || !data?.available) throw new Error(data?.error || `Montana well service returned ${response.status}`);
      const boundary = turf.polygonToLine(parcel);
      const wells = Array.isArray(data.wells) ? data.wells : [];
      wells.forEach(well => { try { well.properties = well.properties || {}; well.properties._distance = turf.pointToLineDistance(well, boundary, {units:'miles'}); } catch { well.properties._distance = Number.POSITIVE_INFINITY; } });
      return wells.sort((a,b) => Number(a.properties?._distance)-Number(b.properties?._distance)).slice(0,5);
    };
  }

  if (oldFindUtility) {
    window.findUtility = async function (parcel) {
      if (stateEl.value !== 'MT') return oldFindUtility(parcel);
      const [lon, lat] = turf.centroid(parcel).geometry.coordinates;
      try {
        const response = await fetch('/api/utility-territory', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({state:'MT', county:countyEl.value, lat, lon}) });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Utility territory service returned ${response.status}`);
        return Array.isArray(data.providers) ? data.providers : [];
      } catch (error) { console.warn('Montana utility territory lookup failed', error); return []; }
    };
  }

  const style = document.createElement('style');
  style.id = 'stateSelectorStyles';
  style.textContent = `.search-form{grid-template-columns:160px 210px minmax(220px,1fr) 170px!important}.control:disabled,.search-btn:disabled{opacity:.58;cursor:not-allowed}@media(max-width:900px){.search-form{grid-template-columns:1fr 1fr!important}.search-form .search-btn{grid-column:1/-1}}@media(max-width:700px){.search-form{grid-template-columns:1fr!important}.search-form .search-btn{grid-column:auto}}`;
  document.head.appendChild(style);
})();
