# China-origin shipping services (2.25.0)

## Scope and protocol preflight

| Sub-capability                            | TOP            | IOP            | External service / risk                                                         |
| ----------------------------------------- | -------------- | -------------- | ------------------------------------------------------------------------------- |
| Carrier directory, mode/keyword filtering | Not applicable | Not applicable | Local only; no request on entry or filtering                                    |
| Open an official quote website            | Not applicable | Not applicable | Explicit external navigation; route data is not embedded in the link            |
| Freightos market estimate                 | Not applicable | Not applicable | User-owned API key, explicit per-query data/cost consent; may consume quota     |
| Provider credential configuration         | Not applicable | Not applicable | Administrator/trusted extension only; write-only encrypted key, revision checks |

The new tab is independent of OneTouch eligibility and Alibaba credentials. It must
disable Alibaba logistics/permission/product-reference queries while active. Existing
logistics order forms and packing preview remain separate.

Only mainland China (CN) is accepted as an API origin in this release. Hong Kong,
Macao and Taiwan are not aliases for CN. Shipment destination must differ from CN.
Directory matches are suggestions for where to inquire, not proof of route coverage,
lowest prices, current capacity, safe cargo handling or an endorsement.

## Sources checked on 2026-11-09

- Freightos China-origin routes:
  https://www.freightos.com/shipping-routes/shipping-from-china-to-the-united-states/
- Freightos Rate Estimate API v1:
  https://ship.freightos.com/api/shippingCalculator
- Freightos data terms:
  https://www.freightos.com/freightos-data-terms-conditions/
- Easyship shipping-origin coverage:
  https://support.easyship.com/hc/en-us/articles/19262777924626-Countries-You-Can-Ship-From-With-Easyship
- Easyship rate-call billing:
  https://support.easyship.com/hc/en-us/articles/34766246620562-API-Usage-Billing

The directory stores each official source and check date alongside the entry.
Recheck coverage and terms when changing an entry. Do not scrape private carrier APIs.

Easyship is deferred: the current official origin list does not include mainland
China. An API description or a Hong Kong-origin test does not establish CN support.
Do not dispatch an Easyship quote or suggest an automatic HK-origin workaround.

## Freightos onboarding

1. Review the provider's data terms and own account/route coverage.
2. Request an API key using the contact on the official API documentation. The key
   is environment-specific; this application only accepts the published production
   host, not arbitrary/custom endpoints.
3. Confirm the account's current quota, subscription and fees with the provider.
   The documentation currently describes 10 free calls per day, but the key may be
   used elsewhere and commercial terms can differ. No automatic paid upgrade.
4. An administrator saves the key in the shipping-services configuration panel.
   Key entry and successful local saving do not verify provider permission.
5. Enter a CN export route, mode and load. Review the exact fields to be sent and
   explicitly confirm both data sharing and potential API fees for that query.

Never provide an Alibaba AppSecret/Token as the Freightos API key. The extension
requests only the exact Freightos host when the user saves or requests a quote.
There is no automatic provider test call, polling or automatic retry.

## Quote meaning and data minimization

The API returns average market figures by mode, not an individual carrier offer or
a booking. Keep currencies and modes separate. Missing price/time is unavailable,
never zero. Display query time, source and provider fee/coverage caveats.
Quoted amounts are not a commitment to transport cargo and need not include all
taxes, insurance, customs clearance or accessorials.

Only route country/city/province/postal code, selected mode, package type/count,
per-piece weight/dimensions, optional pickup date/value and requested currency are
sent. No contacts, phone, account identity, Alibaba credentials or product/order
data are copied into a quote. Form inputs and quote replies stay in page memory.
Changing inputs/provider/configuration or leaving discards late results.

No booking, label purchase, insurance purchase, pickup or payment API is used.
Freightos documentation states that every request is recorded and there is no
dry-run mode. Transport timeouts can still consume allowance; do not automatically
resend them.

## Acceptance boundary

CI uses only synthetic CN-origin fixtures under mock/data/shipping-services.
Do not call a provider using fake keys to label an integration verified.

At implementation start the user has no provider account/key. Real CN-origin
API acceptance is therefore pending, not passed. Directory/UI/manual consent,
request serialization, auth/storage and isolated response replay can be accepted
independently. Once a valid key and explicit fee boundary are available, perform
one CN-origin query per selected mode, record only request ID, mode, result class
and sanitized outcome, and never buy or book anything.

This development branch does not authorize merging mainline, deploying the existing
Worker, creating a formal Tag/Release or submitting the Chrome Store.

### Remote verification on 2026-11-09

- The Windows 102 Chrome preview was checked in Chinese and English, including
  the mainland-CN label, mode filtering, consent/configuration panel and narrow layout.
- The directory opened DHL's official China quote page, whose origin was China.
  No shipment form was submitted. This verifies the website entry, not a quote or booking.
- Node/SQLite and workerd/D1 replay cover the same CN-export fixture, owner-bound
  encryption, revision conflicts, pre-dispatch receipts and duplicate/daily guards.
- Packaged MV3 tests use isolated permission decisions and a non-forwarding fixture
  transport. Test keys cannot reach the real provider; they do not establish API access.
- Provider credentials were not available. Live CN-origin Freightos estimates and
  route coverage remain pending until the merchant obtains a key and approves costs.

Existing backend installations need migration 0020 and their existing
`ONE_VEGETABLE_CREDENTIAL_ENCRYPTION_KEY` before saving provider credentials.
No production migration or deployment was performed during development.
