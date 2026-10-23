# 06 — Cash Flow and Working Capital

Implementation: `domain/portfolio.ts` (cash section). Modelled data is never written to finance; no invoice, payment
or posting is created by the engine.

## Events

| Category | Rule | Basis |
|---|---|---|
| RECEIPT | Forecast invoices (net) per billing schedule → received after payment term + configured and scenario collection delay; gross incl. VAT | CONTRACTED / WEIGHTED |
| EXTERNAL_COST | External labour, unfilled-demand cost and expenses per month → supplier invoice at month end, paid after supplier term; gross incl. input VAT | FORECAST |
| PAYROLL | Internal resources' monthly fixed cost (or rate × nominal hours) at month end | FORECAST / SIMULATED |
| OVERHEAD | Configured monthly overhead (+ scenario extras) at month end | FORECAST |
| OPEN_RECEIVABLE / OPEN_PAYABLE | Open AR/AP from finance at due date; overdue AR after `overdueCollectionDays` | ACTUAL |
| VAT | Output VAT − input VAT per invoice month, paid on `paymentDay` after `paymentLagMonths` (default 10th of the following month) | FORECAST |

Invoice schedules: MONTHLY = earned revenue per month (first month adjusted by WIP or advance invoicing so that total =
revenue at completion − invoiced to date); MILESTONE = open milestones (overdue → as-of date), remainder at end;
UPFRONT; ON_COMPLETION. Invoiced-to-date per contract comes from finance and is split across that contract's
assignments by estimated revenue. Invoices are not receipts.

## Projection

`closing = opening + receipts − payments − VAT` per week and month. Opening cash = Σ bank account opening balance +
payments (BANK) or a manual value. Reported: minimum balance and date, peak deficit (opening − minimum), financing
requirement (`max(0, reserve − minimum)`), end balance, totals by category.

## Assignment cash attractiveness

Per assignment (net of VAT, unweighted): receipts − external payments − internal labour at month end → peak financing
need, date from which cumulative cash stays positive, maximum receivable exposure. Ratios like contribution / peak
working capital are deliberately not used as a sole score (denominators near zero).

## Known simplifications

VAT on actual open AR/AP and on overhead is not re-modelled; intra-month timing within a segment uses event dates.
