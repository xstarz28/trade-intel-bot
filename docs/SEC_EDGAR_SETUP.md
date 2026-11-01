# SEC EDGAR provider setup

## Production environment

SEC EDGAR's public endpoints do not require an API key. They do require an identifying
User-Agent with a real project contact. Configure this variable in the **Convex
production deployment**, not in Vite or the frontend:

```sh
npx convex env set SEC_USER_AGENT "TradeIntelBot/1.0 (Contact: <owner-contact-email>)"
```

Do not commit the actual contact value to the repository. The value is sent as an
HTTP header to SEC endpoints.

## Fetch behavior

The authenticated Convex action is `api.secEdgar.fetchCompanyFilingHistory`.
It resolves a ticker through SEC's official ticker directory, fetches that issuer's
submissions and XBRL Company Facts, maps discrete quarterly EPS/revenue facts, and
persists first-seen observations by filing accession and fiscal period.

The mapper currently accepts 10-Q and 6-K quarterly filing records with a 70–110
day fact duration. It intentionally does not infer missing values or manufacture
quarterly values from year-to-date/annual facts. Coverage is US issuer / US GAAP
Company Facts only; it does not cover IDX issuers such as BBCA.

## Point-in-time semantics

- `filingDate` is the SEC filing date and supports daily point-in-time eligibility.
- `acceptanceDateTime` is preserved as SEC acceptance metadata.
- Neither field is represented as an independently verified exact public-availability
  timestamp.
- `firstObservedAt` is the time Trade Intel Bot first persisted the record, not the
  original publication time.

## Operational limits

SEC requests include the configured User-Agent and are kept below the SEC's published
10 requests/second ceiling per process. The ticker directory is cached in the action
runtime for 24 hours. Provider credential presence means the User-Agent is configured;
it does not prove SEC authentication/availability or that every ticker has usable facts.

After setting the production variable, deploy the Convex functions and run an
authenticated fetch for a representative US issuer. Confirm the returned CIK,
accession links, filing dates, and persisted observations before marking this source
production-verified.
