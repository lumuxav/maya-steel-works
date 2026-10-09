# Maya Steel Works — Daily Operations Manual

**Audience:** Employee, Business Admin and System Super Admin  
**Applicable site:** https://maya-steel-works-mgt.vercel.app  
**Scope:** Maya Branch only | **First business date:** Monday, 12 October 2026 (Uganda)

This guide describes the operational workflows available in the current Maya application. Screen labels may change with later releases. Do not make up missing receipts, cash, or stock quantities to match the system.

## 1. Start-of-day routine (business manager)

1. Open Maya on the latest installed Android APK or desktop website and sign in with your individual account.
2. Confirm the account/profile is yours and that the opening date and branch are **Maya Branch**.
3. Inspect the Home dashboard, Alerts and Cash Book; check pending banking and existing debt balances.
4. Confirm raw and finished inventory against physical records. On the first live day, enter and independently verify the actual opening stock before making stock sales.
5. Ensure the existing day archive shows correct carried-forward cash; Maya's cash history officially begins 12 Oct 2026.
6. Assign staff work only to active accounts. Business Admin handles operational decisions; Super Admin handles account/security/system matters.

## 2. Role-specific access

| Role | Main responsibility | Cautions |
| --- | --- | --- |
| Employee | Normal permitted stock, delivery, sale, customer material and collection operations | Cannot grant own privileges or directly change protected financial records |
| Admin | Business owner/manager: oversee stock, debt, cash/banking, reports, approvals and audited corrections | Use documented correction/reversal paths; never edit database manually |
| Super Admin | Technical accounts, roles, password resets, archive/restore, system monitoring and troubleshooting | Do not routinely transact on behalf of staff; do not share credentials |

Actual per-page availability depends on role, business policy and RLS enforcement; a hidden button alone must never be considered a security check.

## 3. Deliveries / receiving Maya-owned materials

**Path:** `/deliveries`

1. Record the real supplier, material category and relevant gauge/size/units.
2. Enter the actual physical quantity and weight where applicable; verify before submission.
3. Management adds cost/transport where the form grants access.
4. Save the delivery and confirm that the received material appears once under `/inventory`.
5. Confirm the inventory history or stock movement. Never submit twice just because the screen seems slow; first check whether the record was saved.
6. If a receipt was entered incorrectly, follow the authorized stocktake/correction workflow with a reason. Do not delete evidence or reset the database.

**Opening stock:** if existing material was physically present before 12 Oct, record it through the approved inventory/receiving workflow and label supporting physical documents clearly. The system started with empty raw/finished tables after test-data removal; do not invent a historic supplier.

## 4. Stock / inventory / stocktake

**Paths:** `/inventory`, `/inventory/history`, `/stocktake`

- Raw materials include specifications and quantities. Finished goods represent output available to sell.
- Verify unit consistency (pieces vs sheets, length, weight); incorrect units produce misleading quantity reports.
- Stocktake: select the correct Maya stock item, enter **physical total** (not merely the difference), add counter/notes and save once.
- Compare physical count against the system; exceptions appear in discrepancy/management records.
- Investigate shortfalls/overages before writing an adjustment. Keep evidence (delivery note, supervisor confirmation, etc.).
- Check the opening and closing stock for each operating day. Don't use another branch's quantities to make Maya's balance match.

## 5. Production of Maya-owned material

**Paths:** `/recipes`, `/production`, `/production-report`

1. Business management defines an appropriate production standard or recipe (raw category/gauge/size, output design/size and yield).
2. Operator chooses the actual raw batch and recipe.
3. Record raw material used, pieces produced and scrap; require positive meaningful quantities.
4. Save. The atomic business ledger is intended to deduct raw stock, add output, and record a production event together.
5. Check the finished-goods quantity and production yield report; investigate large differences from the expected standard.
6. The `Make & Sell` sales mode combines required production and a sale as one operation. Do not separately record a duplicate production run for the same material.

## 6. Sales, cash and customer credit

**Paths:** `/sales`, `/sales-report`

### Raw or finished goods sale

1. Select the real Maya-owned item.
2. Enter actual quantity, valid unit price, customer name (if applicable) and payment method/status.
3. Choose **Paid**, **Partial**, or **Credit**, matching what the customer actually paid.
4. Record only the genuine amount received for a partial payment.
5. Submit once, then verify: exactly one sale, the correct stock deducted and the recorded cash matching receipt.
6. Retain the physical/payment evidence. Do not manually adjust `sales.total_amount` or `sales.amount_paid`.

### Credit and debt repayment

- A credit or partially paid sale creates a customer balance. A later payment reduces outstanding debt and is recorded in the debt ledger.
- Record a repayment against the correct customer only once. The repayment contributes cash on **the payment date**, not the original sale date.
- A different customer with a similar name should not be merged into the same debt account casually.
- Refunds/returns/compensations must follow the authorized business adjustment flow so the audit trail and financial totals remain consistent.

## 7. Customer-owned material processing

**Path:** `/customer-work`

Use this when a customer brings their **own** steel, sheets or plates for ribbing, press work, louvers, strip cutting or other processing.

1. Select or clearly name the service performed.
2. Record the number of pieces/plates and charge **per piece**.
3. Enter customer and Paid / Partial / Credit details.
4. Save the service transaction; verify service revenue and collected cash/debt.
5. Verify that **no Maya raw or finished stock has been deducted**. The service transaction uses `sales.item_type='service'`, with a non-stock `item_id=0` marker.

Do not record the customer's material as Maya-owned delivery/inventory just to make the service form work.

## 8. Cash Book, expenses and banking

**Path:** `/cashbook`

### Cash calculation

```text
Opening cash (previous confirmed closing)
+ money received today from paid/partial stock sales
+ money received today from customer service work
+ today's debt repayments
- today's recorded expenses
- today's CONFIRMED banking
= expected closing cash
```

Do **not** subtract pending bankings from confirmed cash totals before they are confirmed. Real-world temporary holds/shortfalls still need review.

### Expenses

- Record a real description, correct expense category and positive amount.
- Confirm the cash spent and receipt/invoice.
- Business Admin reviews suspicious expenses and the resulting expected cash.

### Banking

- Record date, actual amount, bank/method and notes.
- A pending deposit is not yet a confirmed cash outflow.
- Business management confirms genuine banking through the audited confirmation action, which stores the confirming user and time.
- Any variance or cash shortage must be investigated in Records & Discrepancies; never alter amounts simply to match a desired closing balance.
- Once banking is confirmed, its amount and date are locked from ordinary corrections.

### Cash archive

The Cash Book archive begins **12 October 2026** and continues daily, including days without transactions. Its time calculations follow **Africa/Kampala**. Never clear, backdate or regenerate history to conceal mistakes.

## 9. Alerts, profit and discrepancies

**Paths:** `/alerts`, `/profit`, `/records`, `/production-report`

Review alerts for stock shortage, variance, outstanding debts, production yield and unusual banking/cash conditions. Records & Discrepancies groups stock count differences, banking variances, production losses, credit sales and corrections. A blank state only means **nothing recorded in the filtered data**, not that the underlying business has been independently audited.

Profit reports depend on the quality of costs, inventory valuation and the full history of transactions. Some application queries currently cap displayed rows; for long-running accounting and tax reporting, validate exports against the full database.

## 10. Financial corrections

**Path:** `/corrections` (management authorization)

- Enter a genuine, written reason for the adjustment.
- Correct permitted descriptive fields or a valid unconfirmed expense/banking detail only.
- A correction is saved together with individual before/after audit rows by `maya_correct_record`; if the audit insert fails, the change must roll back.
- The Corrections page does **not** offer unrestricted financial record deletion or rewrite of stock/sales amounts.
- Returns/compensation/repayments belong to the ledger's specific business operation, not manual financial editing.
- Confirmed banking is locked against changing amount/date. Use the business owner to investigate any dispute.

## 11. System administration

**Paths:** `/users`, `/system-control`, `/settings`

### Creating and managing staff

- Each employee uses an individual named account; never share credentials.
- The Super Admin assigns the minimum role required. New/restored/reset passwords require at least 12 characters, uppercase, lowercase, number and symbol.
- Disable a departing employee promptly. Archive instead of casually destroying historical identity: transaction references may depend on it.
- If the **same** former employee returns, restore their archived account, assign a new password and review role permissions. A different person must get a new identity.
- A disabled/archived account must no longer be allowed to transact, even with previously saved sessions.
- Use `System Control` for authorized diagnostics, not for editing business money.

### Personal profile and preferences

Settings provides the user's profile/photo, Light/Dark/Navy theme, display preferences, notification permission and sign-out. Notifications and browser permission are optional; alerts in the system must still be checked directly.

## 12. End-of-day manager closeout

1. Confirm all sales, customer service jobs, debt repayments and expenses.
2. Reconcile recorded money with actual cash; investigate differences.
3. Confirm banked funds actually received by the bank and review pending banking.
4. Examine credit/debt, stock balances, stocktake differences and production variances.
5. Record exceptions, reasons and the responsible approver.
6. Check the current day's Cash Book closing; ensure carried-forward cash will be credible tomorrow.
7. Secure documents and check that the Supabase/website health and backup procedures are operating.

## 13. If something goes wrong

- **Page slow or stuck:** allow normal loading; check connection; avoid repeated submission of the same transaction. Refresh and inspect the actual ledger before retrying.
- **Sale recorded but balance looks wrong:** stop repeat entry, capture error/message, report to Admin; use approved correction path only.
- **No stock / insufficient stock:** check material batch, recipe and units; don't bypass protections via database SQL.
- **Employee cannot log in:** verify role, active state, valid password and network with Super Admin. Never expose Auth service keys.
- **Android system Back:** current native build goes to previous Maya screen; from Home the user must press Back twice within about 2.2 seconds to exit. Native changes need a new APK.
- **Database/website unavailable:** use the monitoring and recovery runbook. Maintain contemporaneous paper records until Maya is fully restored; later enter them exactly once, with documented original transaction timing when supported.

**Related:** [Architecture](ARCHITECTURE_AND_DATA_MODEL.md) · [Security/monitoring](SECURITY_DEPLOYMENT_MONITORING.md) · [Testing](TESTING_RELEASE_AND_RECOVERY.md).
