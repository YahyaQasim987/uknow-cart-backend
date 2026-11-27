# COD and manual advance payments

## Payment methods

Cash on Delivery remains the payment method for products that do not require an advance. For products configured by Admin with a fixed advance amount, checkout requires that amount to be transferred through an enabled store-configured bank, EasyPaisa, or JazzCash destination. These destinations are payment instructions only; the application does not connect to a payment gateway or verify transfers automatically.

The backend calculates prices, discounts, the fixed advance amount, and the remaining COD balance from current product records. It rejects COD for carts that require an advance and rejects advance orders if no supported destination is configured.

## Advance payment proof and fulfillment

1. Checkout creates an advance order with `payment_status = awaiting_proof` and a 36-hour proof deadline. Order status remains separate.
2. The customer submits the exact advance amount, account-holder name, payment platform, transaction reference, and a JPG, PNG, or WebP proof image.
3. Proof images are kept in private storage and can only be viewed by the order's customer or an Admin authorized for that order. Duplicate platform/reference submissions are rejected.
4. Admin checks the transfer in the bank or wallet account before approving the proof. Approval changes payment status to `partially_paid` when a balance remains, otherwise `paid`. Rejection requires a reason; the customer can resubmit with a new reference before the deadline.
5. Fulfillment remains blocked until the advance has been verified. After approval, the remaining balance and delivery charges are due on delivery.
6. Orders still awaiting proof or approval at the 36-hour deadline expire, and their reserved stock is restored. Proofs already submitted for Admin review are not auto-expired while that review is pending.

Payment proof status, payment-status history, and order-status history are stored separately and retained for audit. Admin manual payment-status changes that mark an advance order paid or partially paid are also blocked until a proof has been verified.

## Database setup

Back up the database, then run the existing migration runner from the backend directory:

```powershell
npm.cmd run migrate
```

The runner applies `sql/schema.sql` and its additive compatibility changes for existing tables. The backend must use its existing MySQL connection configuration. No additional payment-provider environment variables are required.

## Refund history

Existing refund records and backend history are retained. The current checkout changes do not initiate an automatic refund or transfer money.
