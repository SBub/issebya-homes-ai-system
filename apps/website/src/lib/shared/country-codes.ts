// ITU-T E.164 country calling codes, self-contained (no phone-input
// dependency, matching this repo's minimal-dependency style). `id` is the
// unique select-option key/value — several countries share the same dial
// `code` (e.g. NANP's +1, or +7 for Russia/Kazakhstan), so the dial code
// itself can't be the option's unique identifier.
export interface CountryCode {
  id: string;
  country: string;
  code: string;
  flag: string;
}

export const COUNTRY_CODES: CountryCode[] = [
  { id: "AF", country: "Afghanistan", code: "+93", flag: "🇦🇫" },
  { id: "AL", country: "Albania", code: "+355", flag: "🇦🇱" },
  { id: "DZ", country: "Algeria", code: "+213", flag: "🇩🇿" },
  { id: "AD", country: "Andorra", code: "+376", flag: "🇦🇩" },
  { id: "AO", country: "Angola", code: "+244", flag: "🇦🇴" },
  { id: "AR", country: "Argentina", code: "+54", flag: "🇦🇷" },
  { id: "AM", country: "Armenia", code: "+374", flag: "🇦🇲" },
  { id: "AU", country: "Australia", code: "+61", flag: "🇦🇺" },
  { id: "AT", country: "Austria", code: "+43", flag: "🇦🇹" },
  { id: "AZ", country: "Azerbaijan", code: "+994", flag: "🇦🇿" },
  { id: "BH", country: "Bahrain", code: "+973", flag: "🇧🇭" },
  { id: "BD", country: "Bangladesh", code: "+880", flag: "🇧🇩" },
  { id: "BY", country: "Belarus", code: "+375", flag: "🇧🇾" },
  { id: "BE", country: "Belgium", code: "+32", flag: "🇧🇪" },
  { id: "BZ", country: "Belize", code: "+501", flag: "🇧🇿" },
  { id: "BJ", country: "Benin", code: "+229", flag: "🇧🇯" },
  { id: "BT", country: "Bhutan", code: "+975", flag: "🇧🇹" },
  { id: "BO", country: "Bolivia", code: "+591", flag: "🇧🇴" },
  { id: "BA", country: "Bosnia and Herzegovina", code: "+387", flag: "🇧🇦" },
  { id: "BW", country: "Botswana", code: "+267", flag: "🇧🇼" },
  { id: "BR", country: "Brazil", code: "+55", flag: "🇧🇷" },
  { id: "BN", country: "Brunei", code: "+673", flag: "🇧🇳" },
  { id: "BG", country: "Bulgaria", code: "+359", flag: "🇧🇬" },
  { id: "BF", country: "Burkina Faso", code: "+226", flag: "🇧🇫" },
  { id: "BI", country: "Burundi", code: "+257", flag: "🇧🇮" },
  { id: "KH", country: "Cambodia", code: "+855", flag: "🇰🇭" },
  { id: "CM", country: "Cameroon", code: "+237", flag: "🇨🇲" },
  { id: "CA", country: "Canada", code: "+1", flag: "🇨🇦" },
  { id: "CV", country: "Cape Verde", code: "+238", flag: "🇨🇻" },
  { id: "CF", country: "Central African Republic", code: "+236", flag: "🇨🇫" },
  { id: "TD", country: "Chad", code: "+235", flag: "🇹🇩" },
  { id: "CL", country: "Chile", code: "+56", flag: "🇨🇱" },
  { id: "CN", country: "China", code: "+86", flag: "🇨🇳" },
  { id: "CO", country: "Colombia", code: "+57", flag: "🇨🇴" },
  { id: "KM", country: "Comoros", code: "+269", flag: "🇰🇲" },
  { id: "CG", country: "Congo", code: "+242", flag: "🇨🇬" },
  { id: "CD", country: "Congo (DRC)", code: "+243", flag: "🇨🇩" },
  { id: "CR", country: "Costa Rica", code: "+506", flag: "🇨🇷" },
  { id: "HR", country: "Croatia", code: "+385", flag: "🇭🇷" },
  { id: "CU", country: "Cuba", code: "+53", flag: "🇨🇺" },
  { id: "CY", country: "Cyprus", code: "+357", flag: "🇨🇾" },
  { id: "CZ", country: "Czech Republic", code: "+420", flag: "🇨🇿" },
  { id: "DK", country: "Denmark", code: "+45", flag: "🇩🇰" },
  { id: "DJ", country: "Djibouti", code: "+253", flag: "🇩🇯" },
  { id: "DO", country: "Dominican Republic", code: "+1", flag: "🇩🇴" },
  { id: "EC", country: "Ecuador", code: "+593", flag: "🇪🇨" },
  { id: "EG", country: "Egypt", code: "+20", flag: "🇪🇬" },
  { id: "SV", country: "El Salvador", code: "+503", flag: "🇸🇻" },
  { id: "GQ", country: "Equatorial Guinea", code: "+240", flag: "🇬🇶" },
  { id: "ER", country: "Eritrea", code: "+291", flag: "🇪🇷" },
  { id: "EE", country: "Estonia", code: "+372", flag: "🇪🇪" },
  { id: "SZ", country: "Eswatini", code: "+268", flag: "🇸🇿" },
  { id: "ET", country: "Ethiopia", code: "+251", flag: "🇪🇹" },
  { id: "FJ", country: "Fiji", code: "+679", flag: "🇫🇯" },
  { id: "FI", country: "Finland", code: "+358", flag: "🇫🇮" },
  { id: "FR", country: "France", code: "+33", flag: "🇫🇷" },
  { id: "GA", country: "Gabon", code: "+241", flag: "🇬🇦" },
  { id: "GM", country: "Gambia", code: "+220", flag: "🇬🇲" },
  { id: "GE", country: "Georgia", code: "+995", flag: "🇬🇪" },
  { id: "DE", country: "Germany", code: "+49", flag: "🇩🇪" },
  { id: "GH", country: "Ghana", code: "+233", flag: "🇬🇭" },
  { id: "GR", country: "Greece", code: "+30", flag: "🇬🇷" },
  { id: "GT", country: "Guatemala", code: "+502", flag: "🇬🇹" },
  { id: "GN", country: "Guinea", code: "+224", flag: "🇬🇳" },
  { id: "GW", country: "Guinea-Bissau", code: "+245", flag: "🇬🇼" },
  { id: "GY", country: "Guyana", code: "+592", flag: "🇬🇾" },
  { id: "HT", country: "Haiti", code: "+509", flag: "🇭🇹" },
  { id: "HN", country: "Honduras", code: "+504", flag: "🇭🇳" },
  { id: "HK", country: "Hong Kong", code: "+852", flag: "🇭🇰" },
  { id: "HU", country: "Hungary", code: "+36", flag: "🇭🇺" },
  { id: "IS", country: "Iceland", code: "+354", flag: "🇮🇸" },
  { id: "IN", country: "India", code: "+91", flag: "🇮🇳" },
  { id: "ID", country: "Indonesia", code: "+62", flag: "🇮🇩" },
  { id: "IR", country: "Iran", code: "+98", flag: "🇮🇷" },
  { id: "IQ", country: "Iraq", code: "+964", flag: "🇮🇶" },
  { id: "IE", country: "Ireland", code: "+353", flag: "🇮🇪" },
  { id: "IL", country: "Israel", code: "+972", flag: "🇮🇱" },
  { id: "IT", country: "Italy", code: "+39", flag: "🇮🇹" },
  { id: "CI", country: "Ivory Coast", code: "+225", flag: "🇨🇮" },
  { id: "JM", country: "Jamaica", code: "+1", flag: "🇯🇲" },
  { id: "JP", country: "Japan", code: "+81", flag: "🇯🇵" },
  { id: "JO", country: "Jordan", code: "+962", flag: "🇯🇴" },
  { id: "KZ", country: "Kazakhstan", code: "+7", flag: "🇰🇿" },
  { id: "KE", country: "Kenya", code: "+254", flag: "🇰🇪" },
  { id: "KW", country: "Kuwait", code: "+965", flag: "🇰🇼" },
  { id: "KG", country: "Kyrgyzstan", code: "+996", flag: "🇰🇬" },
  { id: "LA", country: "Laos", code: "+856", flag: "🇱🇦" },
  { id: "LV", country: "Latvia", code: "+371", flag: "🇱🇻" },
  { id: "LB", country: "Lebanon", code: "+961", flag: "🇱🇧" },
  { id: "LS", country: "Lesotho", code: "+266", flag: "🇱🇸" },
  { id: "LR", country: "Liberia", code: "+231", flag: "🇱🇷" },
  { id: "LY", country: "Libya", code: "+218", flag: "🇱🇾" },
  { id: "LI", country: "Liechtenstein", code: "+423", flag: "🇱🇮" },
  { id: "LT", country: "Lithuania", code: "+370", flag: "🇱🇹" },
  { id: "LU", country: "Luxembourg", code: "+352", flag: "🇱🇺" },
  { id: "MO", country: "Macau", code: "+853", flag: "🇲🇴" },
  { id: "MG", country: "Madagascar", code: "+261", flag: "🇲🇬" },
  { id: "MW", country: "Malawi", code: "+265", flag: "🇲🇼" },
  { id: "MY", country: "Malaysia", code: "+60", flag: "🇲🇾" },
  { id: "MV", country: "Maldives", code: "+960", flag: "🇲🇻" },
  { id: "ML", country: "Mali", code: "+223", flag: "🇲🇱" },
  { id: "MT", country: "Malta", code: "+356", flag: "🇲🇹" },
  { id: "MR", country: "Mauritania", code: "+222", flag: "🇲🇷" },
  { id: "MU", country: "Mauritius", code: "+230", flag: "🇲🇺" },
  { id: "MX", country: "Mexico", code: "+52", flag: "🇲🇽" },
  { id: "MD", country: "Moldova", code: "+373", flag: "🇲🇩" },
  { id: "MC", country: "Monaco", code: "+377", flag: "🇲🇨" },
  { id: "MN", country: "Mongolia", code: "+976", flag: "🇲🇳" },
  { id: "ME", country: "Montenegro", code: "+382", flag: "🇲🇪" },
  { id: "MA", country: "Morocco", code: "+212", flag: "🇲🇦" },
  { id: "MZ", country: "Mozambique", code: "+258", flag: "🇲🇿" },
  { id: "MM", country: "Myanmar", code: "+95", flag: "🇲🇲" },
  { id: "NA", country: "Namibia", code: "+264", flag: "🇳🇦" },
  { id: "NP", country: "Nepal", code: "+977", flag: "🇳🇵" },
  { id: "NL", country: "Netherlands", code: "+31", flag: "🇳🇱" },
  { id: "NZ", country: "New Zealand", code: "+64", flag: "🇳🇿" },
  { id: "NI", country: "Nicaragua", code: "+505", flag: "🇳🇮" },
  { id: "NE", country: "Niger", code: "+227", flag: "🇳🇪" },
  { id: "NG", country: "Nigeria", code: "+234", flag: "🇳🇬" },
  { id: "KP", country: "North Korea", code: "+850", flag: "🇰🇵" },
  { id: "MK", country: "North Macedonia", code: "+389", flag: "🇲🇰" },
  { id: "NO", country: "Norway", code: "+47", flag: "🇳🇴" },
  { id: "OM", country: "Oman", code: "+968", flag: "🇴🇲" },
  { id: "PK", country: "Pakistan", code: "+92", flag: "🇵🇰" },
  { id: "PA", country: "Panama", code: "+507", flag: "🇵🇦" },
  { id: "PG", country: "Papua New Guinea", code: "+675", flag: "🇵🇬" },
  { id: "PY", country: "Paraguay", code: "+595", flag: "🇵🇾" },
  { id: "PE", country: "Peru", code: "+51", flag: "🇵🇪" },
  { id: "PH", country: "Philippines", code: "+63", flag: "🇵🇭" },
  { id: "PL", country: "Poland", code: "+48", flag: "🇵🇱" },
  { id: "PT", country: "Portugal", code: "+351", flag: "🇵🇹" },
  { id: "QA", country: "Qatar", code: "+974", flag: "🇶🇦" },
  { id: "RO", country: "Romania", code: "+40", flag: "🇷🇴" },
  { id: "RU", country: "Russia", code: "+7", flag: "🇷🇺" },
  { id: "RW", country: "Rwanda", code: "+250", flag: "🇷🇼" },
  { id: "SM", country: "San Marino", code: "+378", flag: "🇸🇲" },
  { id: "SA", country: "Saudi Arabia", code: "+966", flag: "🇸🇦" },
  { id: "SN", country: "Senegal", code: "+221", flag: "🇸🇳" },
  { id: "RS", country: "Serbia", code: "+381", flag: "🇷🇸" },
  { id: "SC", country: "Seychelles", code: "+248", flag: "🇸🇨" },
  { id: "SL", country: "Sierra Leone", code: "+232", flag: "🇸🇱" },
  { id: "SG", country: "Singapore", code: "+65", flag: "🇸🇬" },
  { id: "SK", country: "Slovakia", code: "+421", flag: "🇸🇰" },
  { id: "SI", country: "Slovenia", code: "+386", flag: "🇸🇮" },
  { id: "SO", country: "Somalia", code: "+252", flag: "🇸🇴" },
  { id: "ZA", country: "South Africa", code: "+27", flag: "🇿🇦" },
  { id: "KR", country: "South Korea", code: "+82", flag: "🇰🇷" },
  { id: "SS", country: "South Sudan", code: "+211", flag: "🇸🇸" },
  { id: "ES", country: "Spain", code: "+34", flag: "🇪🇸" },
  { id: "LK", country: "Sri Lanka", code: "+94", flag: "🇱🇰" },
  { id: "SD", country: "Sudan", code: "+249", flag: "🇸🇩" },
  { id: "SR", country: "Suriname", code: "+597", flag: "🇸🇷" },
  { id: "SE", country: "Sweden", code: "+46", flag: "🇸🇪" },
  { id: "CH", country: "Switzerland", code: "+41", flag: "🇨🇭" },
  { id: "SY", country: "Syria", code: "+963", flag: "🇸🇾" },
  { id: "TW", country: "Taiwan", code: "+886", flag: "🇹🇼" },
  { id: "TJ", country: "Tajikistan", code: "+992", flag: "🇹🇯" },
  { id: "TZ", country: "Tanzania", code: "+255", flag: "🇹🇿" },
  { id: "TH", country: "Thailand", code: "+66", flag: "🇹🇭" },
  { id: "TG", country: "Togo", code: "+228", flag: "🇹🇬" },
  { id: "TT", country: "Trinidad and Tobago", code: "+1", flag: "🇹🇹" },
  { id: "TN", country: "Tunisia", code: "+216", flag: "🇹🇳" },
  { id: "TR", country: "Turkey", code: "+90", flag: "🇹🇷" },
  { id: "TM", country: "Turkmenistan", code: "+993", flag: "🇹🇲" },
  { id: "UG", country: "Uganda", code: "+256", flag: "🇺🇬" },
  { id: "UA", country: "Ukraine", code: "+380", flag: "🇺🇦" },
  { id: "AE", country: "United Arab Emirates", code: "+971", flag: "🇦🇪" },
  { id: "GB", country: "United Kingdom", code: "+44", flag: "🇬🇧" },
  { id: "US", country: "United States", code: "+1", flag: "🇺🇸" },
  { id: "UY", country: "Uruguay", code: "+598", flag: "🇺🇾" },
  { id: "UZ", country: "Uzbekistan", code: "+998", flag: "🇺🇿" },
  { id: "VE", country: "Venezuela", code: "+58", flag: "🇻🇪" },
  { id: "VN", country: "Vietnam", code: "+84", flag: "🇻🇳" },
  { id: "YE", country: "Yemen", code: "+967", flag: "🇾🇪" },
  { id: "ZM", country: "Zambia", code: "+260", flag: "🇿🇲" },
  { id: "ZW", country: "Zimbabwe", code: "+263", flag: "🇿🇼" },
];

const DEFAULT_COUNTRY_ID = "PT";

function findCountryById(id: string): CountryCode {
  return (
    COUNTRY_CODES.find((c) => c.id === id) ??
    COUNTRY_CODES.find((c) => c.id === DEFAULT_COUNTRY_ID)!
  );
}

/**
 * Splits a combined E.164 string (e.g. "+351920742845") into a country
 * entry + local-number digits, for reversing sendBookingLink's already-
 * combined ?phone= prefill back into the split UI. Longest-dial-code-first
 * match, since some codes are prefixes of others' digit sequences are not a
 * concern here (dial codes themselves don't nest), but codes DO vary in
 * length (+1 vs +351), so a naive shortest-first scan could wrongly match
 * "+1" against a number that's actually "+351..." if not sorted longest
 * first.
 */
export function splitPhoneNumber(value: string): { countryId: string; localNumber: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { countryId: DEFAULT_COUNTRY_ID, localNumber: "" };
  }

  const withPlus = trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
  const candidates = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
  const match = candidates.find((c) => withPlus.startsWith(c.code));

  if (match) {
    return { countryId: match.id, localNumber: withPlus.slice(match.code.length) };
  }

  // Defensive fallback: no known dial code matches — don't crash, just put
  // the whole thing in the number field under the default country.
  return { countryId: DEFAULT_COUNTRY_ID, localNumber: trimmed.replace(/^\+/, "") };
}

export function combinePhoneNumber(countryId: string, localNumber: string): string {
  return `${findCountryById(countryId).code}${localNumber.replace(/\D/g, "")}`;
}
