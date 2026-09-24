import { PROVINCES } from './placeRegions.ts';

type AddressParts = Record<string, string | undefined>;
const clean = (value?: string) => String(value ?? '').trim();

/** Extract real administrative labels, not the POI name returned by reverse geocoding. */
export function searchRegionFromAddress(address: AddressParts): string {
  const province = [address.state, address.province, address.city]
    .map(clean).map((item) => PROVINCES[item]).find(Boolean) ?? '';
  const districts = [address.city_district, address.borough, address.county, address.city, address.municipality]
    .map(clean).filter((item) => /^[가-힣]+(?:시|군|구)$/.test(item) && !PROVINCES[item]);
  const district = districts.find((item) => /구$/.test(item)) ?? districts[0] ?? '';
  const locality = [address.quarter, address.neighbourhood, address.suburb, address.town, address.village]
    .map(clean).find((item) => /^[가-힣0-9]+(?:동|읍|면|리)$/.test(item)) ?? '';
  return [...new Set([province, district, locality].filter(Boolean))].join(' ');
}
