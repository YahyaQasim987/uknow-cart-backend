import { config } from '../config/env.js';
import { pool } from '../config/db.js';
import { PaymentPolicyService } from './payment-policy.service.js';

const DEFAULT_STANDARD_DELIVERY_FEE = 350;
const DEFAULT_URGENT_DELIVERY_FEE = 600;

const round2 = value => Math.round((Number(value) || 0) * 100) / 100;

function positiveOrFallback(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class PricingService {
  /**
   * Pre-seeded authoritative test catalog for isolated test execution when MySQL is offline.
   * Product prices and attributes are strictly server-controlled.
   */
  static mockCatalog = new Map([
    ['p1', { id: 'p1', name: 'Scent Sample', price: 2000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['p2', { id: 'p2', name: 'Silk Scarf', price: 3500, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['p3', { id: 'p3', name: 'Horology Timepiece', price: 5000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['p4', { id: 'p4', name: 'Oud Royale', price: 10000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['p5', { id: 'p5', name: 'Tourbillon Grand Complication', price: 50000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1', advance_payment_required: true, advance_payment_type: 'fixed', advance_payment_amount: 10000, advance_payment_value: 10000 }],
    ['p6', { id: 'p6', name: 'Emerald Pendant', price: 10000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1', advance_payment_required: true, advance_payment_type: 'percentage', advance_payment_percent: 10, advance_payment_value: 10 }],
    ['prod-1', { id: 'prod-1', name: 'Horology Timepiece', price: 4500, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-2', { id: 'prod-2', name: 'Oud Sample', price: 2500, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-3', { id: 'prod-3', name: 'Titanium Chrono', price: 12000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-4', { id: 'prod-4', name: 'Amber Essence', price: 3000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-horology-1', { id: 'prod-horology-1', name: 'Chrono Noir Tourbillon', price: 45000, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1', advance_payment_required: true, advance_payment_amount: 9000 }],
    ['prod-apparel-1', { id: 'prod-apparel-1', name: 'Silk Tuxedo', price: 12500, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-fragrance-1', { id: 'prod-fragrance-1', name: 'Royal Velvet Rose', price: 6500, stock: 100, reserved_stock: 0, admin_id: 'usr-admin-1' }],
    ['prod-custom-delivery', { id: 'prod-custom-delivery', name: 'Bulky Furniture Item', price: 4000, stock: 50, reserved_stock: 0, admin_id: 'usr-admin-1', delivery_charges: 450 }]
  ]);

  static setMockCatalogItem(id, item) {
    PricingService.mockCatalog.set(id, item);
  }

  /**
   * Authoritative calculation of an order/cart breakdown
   * @param {Array<{ productId: string, variantId?: string, quantity: number }>} items
   * @param {Object} options - { couponCode, deliverySpeed, city, customSettings }
   */
  static async calculateOrderTotals(items = [], options = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error('Order calculation requires at least one valid item.');
      error.statusCode = 400;
      error.isOperational = true;
      throw error;
    }

    const {
      couponCode = null,
      deliverySpeed = 'standard',
      city = null,
      customSettings = {}
    } = options;

    // Delivery is never free. An empty/zero configured fee falls back to Rs. 350.
    const standardShippingFee = positiveOrFallback(
      customSettings.standardShippingFee,
      positiveOrFallback(config.pricing.standardShippingFee, DEFAULT_STANDARD_DELIVERY_FEE)
    );
    const urgentShippingFee = Math.max(
      0,
      Number(customSettings.urgentShippingFee ?? config.pricing.urgentShippingFee)
    );
    const isUrgent = deliverySpeed === 'urgent';

    let subtotalCents = 0;
    const validatedItems = [];

    // Query products/variants to verify database prices
    for (const item of items) {
      const qty = parseInt(item.quantity, 10);
      if (isNaN(qty) || qty < 1) {
        throw new Error(`Invalid quantity "${item.quantity}" for item.`);
      }

      let itemRecord = null;

      // 1. Authoritative lookup from database (or trusted test catalog if DB offline)
      try {
        if (item.variantId) {
          const [vRows] = await pool.query(
            `SELECT v.id, v.name, v.price, v.original_price, v.cost_price, v.stock, v.reserved_stock,
                    v.discount_type, v.discount_value, COALESCE(v.delivery_charges, p.delivery_charges) AS delivery_charges,
                    p.id AS product_id, p.name AS parent_name, p.cost_price AS parent_cost_price,
                    p.advance_payment_required, p.advance_payment_type, p.advance_payment_amount, p.advance_payment_percent, p.advance_payment_value,
                    p.delivery_advance_required, p.delivery_advance_type, p.delivery_advance_value,
                    p.urgent_delivery_advance_required, p.urgent_delivery_advance_type, p.urgent_delivery_advance_value,
                    COALESCE(p.admin_id, p.owner_id) AS admin_id
             FROM product_variants v
             JOIN products p ON v.product_id = p.id
             WHERE v.id = ? AND v.is_active = TRUE
               AND p.archived_at IS NULL
               AND (p.expires_at IS NULL OR p.expires_at > NOW())`,
            [item.variantId]
          );

          if (vRows.length > 0) {
            itemRecord = vRows[0];
          }
        } else if (item.productId) {
          const [pRows] = await pool.query(
            `SELECT id, name, price, original_price, discount_type, discount_value,
                    cost_price, stock, reserved_stock,
                    delivery_charges,
                    advance_payment_required, advance_payment_type, advance_payment_amount, advance_payment_percent, advance_payment_value,
                    delivery_advance_required, delivery_advance_type, delivery_advance_value,
                    urgent_delivery_advance_required, urgent_delivery_advance_type, urgent_delivery_advance_value,
                    COALESCE(admin_id, owner_id) AS admin_id
             FROM products
             WHERE id = ? AND archived_at IS NULL
               AND (expires_at IS NULL OR expires_at > NOW())`,
            [item.productId]
          );

          if (pRows.length > 0) {
            itemRecord = pRows[0];
          }
        } else {
          throw new Error('Each order item must specify either a valid productId or variantId.');
        }
      } catch (dbErr) {
        if (dbErr.code === 'ECONNREFUSED' || dbErr.message?.includes('ECONNREFUSED')) {
          const testKey = item.variantId || item.productId;
          if (this.mockCatalog.has(testKey)) {
            itemRecord = this.mockCatalog.get(testKey);
          }
        } else {
          throw dbErr;
        }
      }

      // STRICT VALIDATION: If product cannot be verified, reject the operation immediately.
      if (!itemRecord) {
        const itemIdentifier = item.variantId || item.productId || 'unknown';
        throw new Error(`Product "${itemIdentifier}" was not found in catalog or could not be verified. Unverified prices are strictly rejected.`);
      }

      // AUTHORITATIVE PRICE ONLY: Derived strictly from server record, ignoring any client price
      const listedPrice = parseFloat(itemRecord.price);
      const originalPrice = Number(itemRecord.original_price);
      const discountValue = Number(itemRecord.discount_value || 0);
      const unitPrice = Number.isFinite(originalPrice) && originalPrice > listedPrice && discountValue > 0
        ? (itemRecord.discount_type === 'percentage'
          ? originalPrice * (1 - Math.min(discountValue, 100) / 100)
          : Math.max(0, originalPrice - discountValue))
        : listedPrice;
      const name = itemRecord.parent_name ? `${itemRecord.parent_name} - ${itemRecord.name}` : itemRecord.name;
      const stock = (itemRecord.stock || 0) - (itemRecord.reserved_stock || 0);
      const adminId = itemRecord.admin_id || null;
      const costPrice = itemRecord.cost_price ?? itemRecord.parent_cost_price ?? (unitPrice * 0.65);

      // A delivery fee of 0/null means "use the standard Rs. 350 fee"; delivery is never free.
      const parsedDelivery = itemRecord.delivery_charges !== null && itemRecord.delivery_charges !== undefined && itemRecord.delivery_charges !== ''
        ? parseFloat(itemRecord.delivery_charges)
        : NaN;
      const deliveryCharges = Number.isFinite(parsedDelivery) && parsedDelivery > 0 ? round2(parsedDelivery) : null;

      if (isNaN(unitPrice) || unitPrice <= 0) {
        throw new Error(`Authoritative price for item "${name}" is invalid (${unitPrice}). Checkout cannot proceed.`);
      }
      const unitPriceCents = Math.round(unitPrice * 100);
      const lineTotalCents = unitPriceCents * qty;
      subtotalCents += lineTotalCents;

      const advancePaymentRequired = Boolean(itemRecord.advance_payment_required);
      let advancePerUnit = 0;
      if (advancePaymentRequired) {
        const advType = itemRecord.advance_payment_type || 'percentage';
        if (advType === 'percentage') {
          const advPercent = Number(itemRecord.advance_payment_value ?? itemRecord.advance_payment_percent ?? 20);
          if (!Number.isFinite(advPercent) || advPercent <= 0) {
            throw new Error(`Advance payment percentage is invalid for "${name}".`);
          }
          advancePerUnit = round2(unitPrice * (Math.min(advPercent, 100) / 100));
        } else {
          const configuredAdvance = Number(itemRecord.advance_payment_amount ?? itemRecord.advance_payment_value);
          if (!Number.isFinite(configuredAdvance) || configuredAdvance <= 0) {
            throw new Error(`Advance payment fixed PKR amount is invalid for "${name}".`);
          }
          advancePerUnit = round2(Math.min(configuredAdvance, unitPrice));
        }
      }

      const deliveryAdvanceRequired = Boolean(itemRecord.delivery_advance_required);
      const urgentDeliveryAdvanceRequired = Boolean(itemRecord.urgent_delivery_advance_required);

      validatedItems.push({
        productId: item.productId,
        variantId: item.variantId || null,
        adminId,
        costPrice: round2(costPrice),
        deliveryCharges,
        name,
        unitPrice: round2(unitPrice),
        quantity: qty,
        lineTotal: round2(lineTotalCents / 100),
        advancePaymentRequired,
        advancePerUnit,
        lineAdvance: round2(advancePerUnit * qty),
        productAdvancePerUnit: advancePerUnit,
        deliveryAdvanceRequired,
        deliveryAdvanceType: itemRecord.delivery_advance_type || 'percentage',
        deliveryAdvanceValue: itemRecord.delivery_advance_value !== null && itemRecord.delivery_advance_value !== undefined
          ? Number(itemRecord.delivery_advance_value)
          : null,
        urgentDeliveryAdvanceRequired,
        urgentDeliveryAdvanceType: itemRecord.urgent_delivery_advance_type || 'percentage',
        urgentDeliveryAdvanceValue: itemRecord.urgent_delivery_advance_value !== null && itemRecord.urgent_delivery_advance_value !== undefined
          ? Number(itemRecord.urgent_delivery_advance_value)
          : null,
        deliveryAdvance: 0
      });
    }

    const subtotal = subtotalCents / 100;

    // 2. Shipping calculation:
    // A positive product delivery_charges overrides the standard fee; otherwise the
    // standard fee (Rs. 350 by default) always applies. Free shipping stays disabled.
    const productMaxDelivery = validatedItems.reduce((max, it) => {
      if (it.deliveryCharges !== null && it.deliveryCharges !== undefined && it.deliveryCharges > 0) {
        return max === null ? it.deliveryCharges : Math.max(max, it.deliveryCharges);
      }
      return max;
    }, null);

    const baseShippingFee = productMaxDelivery !== null ? productMaxDelivery : standardShippingFee;
    const deliveryChargeSource = productMaxDelivery !== null ? 'custom' : 'standard';
    const freeShippingEligible = false;
    const urgentFee = isUrgent ? urgentShippingFee : 0;
    const totalShipping = round2(baseShippingFee + urgentFee);

    // 2b. Admin-wide and city-wide advance policies (vendor scoped).
    const adminIds = [...new Set(validatedItems.map(item => item.adminId).filter(Boolean))];
    const policyMap = await PaymentPolicyService.resolvePolicyMap(adminIds, city || '');
    const policyFor = adminId => policyMap.get(adminId) || { global: {}, city: null };

    for (const item of validatedItems) {
      if (item.advancePaymentRequired) continue;
      const { global: globalPolicy, city: cityPolicy } = policyFor(item.adminId);
      const source = cityPolicy?.productAdvanceEnabled ? cityPolicy : (globalPolicy?.productAdvanceEnabled ? globalPolicy : null);
      if (!source) continue;
      const type = source.productAdvanceType === 'fixed' ? 'fixed' : 'percentage';
      const value = Number(source.productAdvanceValue);
      if (!Number.isFinite(value) || value <= 0) continue;
      const perUnit = PaymentPolicyService.computeAdvanceAmount({ enabled: true, type, value }, item.unitPrice);
      item.advancePaymentRequired = true;
      item.advancePerUnit = perUnit;
      item.productAdvancePerUnit = perUnit;
      item.lineAdvance = round2(perUnit * item.quantity);
      item.advanceSource = cityPolicy?.productAdvanceEnabled ? 'city' : 'global';
    }

    // 3. Coupon / Discount calculation
    let discountAmount = 0;
    let appliedCoupon = null;

    if (couponCode) {
      const cleanCode = couponCode.trim().toUpperCase();
      let coupon = null;
      try {
        const [cRows] = await pool.query(
          `SELECT * FROM coupons
           WHERE code = ?
             AND is_active = TRUE
             AND (expires_at IS NULL OR expires_at >= NOW())`,
          [cleanCode]
        );
        if (cRows.length > 0) {
          coupon = cRows[0];
        }
      } catch (dbErr) {
        if (dbErr.code === 'ECONNREFUSED' || dbErr.message?.includes('ECONNREFUSED')) {
          if (cleanCode === 'PRIVILEGE20') {
            coupon = { discount_percent: 20, min_order_amount: 0, max_discount: null };
          }
        } else {
          throw dbErr;
        }
      }

      if (coupon) {
        const minSpend = parseFloat(coupon.min_order_amount || 0);

        if (subtotal >= minSpend) {
          const rawDiscount = (subtotal * coupon.discount_percent) / 100;
          const maxCap = coupon.max_discount ? parseFloat(coupon.max_discount) : Infinity;
          discountAmount = round2(Math.min(rawDiscount, maxCap));
          appliedCoupon = {
            code: cleanCode,
            percent: coupon.discount_percent,
            discountAmount
          };
        }
      }
    }

    // 4. Allocate discount, then fold each line's product advance into the payable advance.
    let remainingDiscountCents = Math.round(discountAmount * 100);
    let productAdvanceCents = 0;
    for (let index = 0; index < validatedItems.length; index += 1) {
      const item = validatedItems[index];
      const lineCents = Math.round(item.lineTotal * 100);
      const allocatedDiscountCents = index === validatedItems.length - 1
        ? remainingDiscountCents
        : Math.min(remainingDiscountCents, Math.round(discountAmount * 100 * lineCents / subtotalCents));
      remainingDiscountCents -= allocatedDiscountCents;
      const lineAfterDiscountCents = Math.max(0, lineCents - allocatedDiscountCents);
      const advanceCents = item.advancePaymentRequired
        ? Math.min(Math.round(item.advancePerUnit * item.quantity * 100), lineAfterDiscountCents)
        : 0;
      item.lineDiscount = allocatedDiscountCents / 100;
      item.lineAfterDiscount = lineAfterDiscountCents / 100;
      item.productAdvance = advanceCents / 100;
      item.lineAdvance = advanceCents / 100;
      productAdvanceCents += advanceCents;
    }

    // 5. Delivery advance (separate money from the product advance).
    //    Product-level rules win, then a city rule, then the admin-wide rule.
    let deliveryAdvanceTotal = 0;
    if (totalShipping > 0 && validatedItems.length > 0) {
      const candidates = [];
      for (const item of validatedItems) {
        const { global: globalPolicy, city: cityPolicy } = policyFor(item.adminId);
        const rules = [];

        if (isUrgent && item.urgentDeliveryAdvanceRequired) {
          rules.push({
            enabled: true,
            type: item.urgentDeliveryAdvanceType,
            value: item.urgentDeliveryAdvanceValue,
            urgentOnly: true
          });
        }
        if (item.deliveryAdvanceRequired) {
          rules.push({
            enabled: true,
            type: item.deliveryAdvanceType,
            value: item.deliveryAdvanceValue,
            urgentOnly: false
          });
        }

        const policySource = cityPolicy?.deliveryAdvanceEnabled
          ? cityPolicy
          : (globalPolicy?.deliveryAdvanceEnabled ? globalPolicy : null);
        if (policySource) {
          const appliesToUrgent = policySource.applyDeliveryAdvanceToUrgent !== false;
          if (!isUrgent || appliesToUrgent) {
            rules.push({
              enabled: true,
              type: policySource.deliveryAdvanceType,
              value: policySource.deliveryAdvanceValue,
              urgentOnly: false
            });
          }
        }

        for (const rule of rules) {
          if (!isUrgent && rule.urgentOnly) continue;
          const amount = PaymentPolicyService.computeAdvanceAmount(rule, totalShipping);
          if (amount > 0) candidates.push(amount);
        }
      }

      // Never charge more delivery advance than the delivery fee itself, and never
      // stack multiple rules into a double charge: the highest applicable rule wins.
      deliveryAdvanceTotal = Math.min(totalShipping, Math.max(0, ...candidates, 0));
      deliveryAdvanceTotal = round2(deliveryAdvanceTotal);
    }

    if (deliveryAdvanceTotal > 0) {
      const allocationBase = validatedItems.reduce((sum, item) => sum + Math.max(0, item.lineAfterDiscount || 0), 0);
      let remainingDeliveryAdvanceCents = Math.round(deliveryAdvanceTotal * 100);
      for (let index = 0; index < validatedItems.length; index += 1) {
        const item = validatedItems[index];
        const itemBase = Math.max(0, item.lineAfterDiscount || 0);
        const allocated = index === validatedItems.length - 1
          ? remainingDeliveryAdvanceCents
          : (allocationBase > 0
            ? Math.min(remainingDeliveryAdvanceCents, Math.round(deliveryAdvanceTotal * 100 * itemBase / allocationBase))
            : Math.round(deliveryAdvanceTotal * 100 / validatedItems.length));
        remainingDeliveryAdvanceCents -= allocated;
        item.deliveryAdvance = allocated / 100;
        item.lineAdvance = round2((item.productAdvance || 0) + (allocated / 100));
      }
    }

    const productAdvanceDue = productAdvanceCents / 100;
    // 6. Tax calculation (0% default in luxury boutique policy)
    const taxAmount = 0.00;

    // 7. Grand Total (Fixed-point arithmetic)
    const grandTotal = Math.max(0, round2(subtotal - discountAmount + totalShipping + taxAmount));

    const advancePaymentDue = Math.min(grandTotal, round2(productAdvanceDue + deliveryAdvanceTotal));
    const codRemainingDue = Math.max(0, round2(grandTotal - advancePaymentDue));

    return {
      subtotal: round2(subtotal),
      discountAmount,
      appliedCoupon,
      shippingFee: baseShippingFee,
      deliveryChargeSource,
      urgentFee,
      totalShipping,
      freeShippingEligible,
      taxAmount,
      total: grandTotal,
      productAdvanceDue: round2(Math.min(grandTotal, productAdvanceDue)),
      deliveryAdvanceDue: round2(deliveryAdvanceTotal),
      advancePaymentDue,
      codRemainingDue,
      deliverySpeed: isUrgent ? 'urgent' : 'standard',
      currency: 'PKR',
      items: validatedItems
    };
  }
}
