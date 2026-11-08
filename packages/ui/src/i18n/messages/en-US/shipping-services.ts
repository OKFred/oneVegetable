export const shippingServices = {
  title: 'China-origin shipping services',
  independentNotice:
    'Independent of Alibaba; no TOP / IOP authorization required. Manual estimates share shipment data with the provider and may consume quota or incur fees.',
  directoryDetails: 'Coverage and privacy',
  serviceDetails: 'Coverage details / source',
  mainlandChina: 'Mainland China (CN)',
  route: 'Estimate route · Mainland China origin',
  countryExample: 'United States / United Kingdom / US / GB',
  countryHelp:
    'Choose a local country-name suggestion or enter a code, e.g. US / GB. Suggestions do not guarantee route coverage.',
  estimateNotice: 'Market estimate, not a carrier quote. Send only after reviewing and consenting.',
  estimateDetails: 'Data sharing, fees and estimate scope',
  quotedAt: 'Quoted at: {time}',
  directoryDisclaimer:
    'Official discovery links, not a worldwide cheapest-price comparison. Mainland China origin does not guarantee coverage for your route, goods or account; confirm with each provider.',
  localPrivacy:
    'Directory filtering is local and does not use the route fields. Shipment inputs stay on this page only; no addresses are saved or added to website links.',
  originCountry: 'Origin country (read-only)',
  mode: 'Transport mode',
  keyword: 'Service name or keyword',
  modes: {
    express: 'Express',
    parcel: 'Parcel',
    air: 'Air freight',
    lcl: 'Ocean LCL',
    fcl: 'Ocean FCL'
  },
  names: {
    sf: 'SF International',
    dhl: 'DHL Express',
    ups: 'UPS',
    fedex: 'FedEx',
    freightos: 'Freightos',
    maersk: 'Maersk',
    'ups-forwarding': 'UPS Supply Chain Solutions'
  },
  kinds: {
    carrier: 'Carrier / freight services',
    marketplace: 'Marketplace'
  },
  coverage: {
    'documented-mainland-origin': 'Mainland origin documented; check the specific route and cargo.',
    'route-check-required': 'Confirm mainland-origin service and route availability directly.'
  },
  officialWebsite: 'Open official website',
  source: 'Coverage source',
  checkedOn: 'Source checked {date}',
  directoryEmpty: 'No matching services. Try another mode or keyword.',
  marketEstimate: 'Market estimate',
  notReturned: 'Not returned',
  configure: 'Configure Freightos / onboarding',
  configured: 'API key configured',
  notConfigured: 'No API key configured',
  revision: 'Configuration revision: {revision}',
  livePending:
    'This app’s live integration acceptance is pending, not a statement about your account. Saving configuration and fixture tests do not verify live availability.',
  estimateDisclaimer:
    'Freightos returns market averages, not a carrier or account offer, booking or guaranteed lowest price. Import clearance, accessorials and insurance may be excluded. Confirm final charges separately. This workspace never ships, buys or creates labels.',
  fees: 'Each manual request may count toward your provider quota or incur charges, including unsuccessful integration requests. Published free use: up to 10 requests/day, subject to your agreed limits. No dry run, automatic retries or polling.',
  unavailable:
    'This runtime has no shipping-services connection. You can still use the directory and onboarding guide.',
  websiteOnly:
    'Express and parcel estimates are not available through this API. Use the official websites above; no API request will be sent.',
  packaging: 'Packaging',
  packages: {
    boxes: 'Boxes',
    pallets: 'Pallets',
    container20: '20 ft container',
    container40: '40 ft container',
    container40HC: '40 ft high cube'
  },
  fields: {
    originProvince: 'Origin province',
    originCity: 'Origin city',
    originPostal: 'Origin postal code (optional)',
    destinationCountry: 'Destination country',
    destinationProvince: 'Destination province / state (optional)',
    destinationCity: 'Destination city',
    destinationPostal: 'Destination postal code (optional)',
    quantity: 'Package / container count',
    weightKg: 'Weight per package (kg)',
    lengthCm: 'Length per package (cm)',
    widthCm: 'Width per package (cm)',
    heightCm: 'Height per package (cm)',
    declaredValue: 'Declared goods value',
    pickupDate: 'Pickup date (optional)'
  },
  currency: 'Requested currency',
  inputHelp:
    'Quotes require origin province/city, destination country/city and valid cargo details. Loose packages need weight and all dimensions; containers send no dimensions. Returned currency is shown unchanged; no conversion is performed.',
  review: 'Review one estimate request',
  processing: 'Processing one operation…',
  failed:
    'Could not complete the shipping operation. Check the configuration and inputs; no fallback or automatic retry was used.',
  saved: 'Freightos configuration saved. No estimate requested.',
  cleared: 'Freightos configuration cleared.',
  noRates: 'No rates returned for this request. No example or fallback prices are shown.',
  transit: 'Estimated transit: {from}–{to} days',
  freightosAttribution: 'Market estimates by Freightos · official website',
  onboarding: 'Start without an account',
  onboardingSteps:
    '1. Open the official Rate Estimate API guide and follow its contact instructions to request a production API key and confirm mainland-origin lane access. A normal marketplace login is not an API key.\n2. Review the provider data terms, pricing and daily quota; obtain approval before using paid access.\n3. Save only your Freightos production key below. Saving does not test connectivity or request an estimate.\n4. Return to the form, review the exact shipment, and consent separately for each manual request. Live acceptance remains pending until an authorized real request succeeds.',
  apiGuide: 'Official API / key application guide',
  termsLink: 'Freightos data terms',
  downloadGuide: 'Download onboarding checklist',
  keyPrivacy:
    'The key is write-only and encrypted by the runtime; the UI shows only configured status and revision. It is cleared from this form after saving or closing. Shipment inputs and raw provider responses are not stored.',
  apiKey: 'Production API key',
  acceptTerms: 'I have reviewed and accept the Freightos data terms for this configuration.',
  acceptConfigCost:
    'I understand provider quota limits and possible charges; saving this key does not authorize any estimate request.',
  save: 'Save only Freightos',
  clear: 'Clear configuration',
  clearTitle: 'Clear Freightos configuration?',
  clearDescription:
    'Remove the saved API key at the displayed revision. This does not cancel any request already sent to Freightos.',
  confirmTitle: 'Confirm this single estimate request',
  confirmDescription:
    'Review the frozen provider, request ID, configuration revision and sent shipment fields below. Weight and dimensions are per package, not totals. Empty optional fields and unused container dimensions are omitted. Consent applies only to this request.',
  acceptData:
    'I authorize sharing this displayed shipment with Freightos (ship.freightos.com) for this request only.',
  acceptQuoteCost:
    'I acknowledge that this single request consumes quota and may incur provider fees. Do not retry it automatically.',
  sendOnce: 'Send once to Freightos'
};
