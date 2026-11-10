// Washington statewide public water: WA Department of Health "Drinking Water Service Areas".
//   https://services8.arcgis.com/rGGrs6HCnw87OFOT/arcgis/rest/services/Drinking_Water_Service_Areas/FeatureServer/0
// Checked live (`?f=json` and queries, read-only) on 2026-11-09: layer "ServiceAreas", polygons,
// last edit 2026-11-09. Fields read: WS_Name, WS_Grp ('A' | 'B'), WS_Type ('Comm', 'NTNC',
// 'TNC ', 'GRPB'), WS_Status ('Active' | 'Inactive'), Total_Conn, DataSourceDate. The layer also
// holds Contact_F_Name, Contact_L_Name, Contact_Phone, EMailAddr, OwnerID and WS_Address*/WS_City/
// WS_Zip: NEVER requested.
// Rules:
// - Polygons overlap, so every hit is read (decideService keeps the others under `others`).
// - Only Group A, community ('Comm'), Active systems count as public water. Group B systems are
//   small private systems (2-14 connections); NTNC/TNC systems serve a school, workplace or
//   campground, not homes. E.g. the City of Cheney test lot (13013.2211) returns only
//   "CHENEY CITY OF" (A, Comm, Active, 5,773 connections); the Spokane Valley lot (35234.0602)
//   returns "SPO CO WATER DIST 3 SYS 1" with WS_Status 'Inactive', so it does not count here
//   (Spokane County's district layer names its purveyor, src/counties/spokane-utilities.js).
// - DataSourceDate is 2016-07-07 for the Spokane County rows and 2007-2018 for Stevens, so asOf
//   is reported (src/shared/utility-findings.js staleDate).
// The server sends CORS headers (Access-Control-Allow-Origin: *, checked 2026-11-09).
import { staleDate, text, titleCase } from '../../shared/utility-findings.js';

export const WA_DOH_WATER_SERVICE_AREAS = 'https://services8.arcgis.com/rGGrs6HCnw87OFOT/arcgis/rest/services/Drinking_Water_Service_Areas/FeatureServer/0';

export function isPublicWaterSystem(a) {
  return text(a.WS_Grp).toUpperCase() === 'A' && text(a.WS_Type).toUpperCase() === 'COMM' && text(a.WS_Status).toUpperCase() === 'ACTIVE';
}

// "SPOKANE CITY OF" -> "City of Spokane"; other names title-cased as the state lists them.
export function dohSystemName(name) {
  const raw = text(name);
  const m = /^(.*)\s+(CITY|TOWN) OF$/i.exec(raw);
  return m ? `${titleCase(m[2])} of ${titleCase(m[1])}` : titleCase(raw);
}

export const WA_DOH_WATER_SOURCE = {
  id: 'wa-doh-water', name: 'WA DOH Drinking Water Service Areas', agency: 'WA Department of Health',
  url: WA_DOH_WATER_SERVICE_AREAS, services: ['water'], kind: 'area',
  outFields: 'WS_Name,WS_Grp,WS_Type,WS_Status,Total_Conn,DataSourceDate',
  read(rows, ctx) {
    return rows.filter(isPublicWaterSystem).map(a => {
      const provider = dohSystemName(a.WS_Name);
      const asOf = staleDate(a.DataSourceDate, ctx?.now);
      const conns = Number(a.Total_Conn);
      return {
        service: 'water', status: 'served', provider,
        basis: `inside WA DOH Group A service area: ${provider}${Number.isFinite(conns) && conns > 0 ? ` (${conns.toLocaleString('en-US')} connections)` : ''}`,
        ...(asOf ? { asOf } : {})
      };
    });
  }
};
