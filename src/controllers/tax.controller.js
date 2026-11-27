import { executeQuery as query } from '../config/db.js';

export const FBR_EXEMPTION_THRESHOLD_PKR = 600000;

export const DEFAULT_FBR_SLABS = [
  {
    id: 1,
    slabLabel: 'Slab 1: Upto Rs. 600,000',
    minPKR: 0,
    maxPKR: 600000,
    ratePercentage: 0,
    fixedBaseTaxPKR: 0,
    description: '0% Tax (Completely Tax Free Exemption)',
    isExempt: true
  },
  {
    id: 2,
    slabLabel: 'Slab 2: Rs. 600,001 to Rs. 1,200,000',
    minPKR: 600000,
    maxPKR: 1200000,
    ratePercentage: 15,
    fixedBaseTaxPKR: 0,
    description: '15% of the amount exceeding Rs. 600,000',
    isExempt: false
  },
  {
    id: 3,
    slabLabel: 'Slab 3: Rs. 1,200,001 to Rs. 2,400,000',
    minPKR: 1200000,
    maxPKR: 2400000,
    ratePercentage: 20,
    fixedBaseTaxPKR: 90000,
    description: 'Rs. 90,000 + 20% of amount exceeding Rs. 1,200,000',
    isExempt: false
  },
  {
    id: 4,
    slabLabel: 'Slab 4: Rs. 2,400,001 to Rs. 3,600,000',
    minPKR: 2400000,
    maxPKR: 3600000,
    ratePercentage: 30,
    fixedBaseTaxPKR: 330000,
    description: 'Rs. 330,000 + 30% of amount exceeding Rs. 2,400,000',
    isExempt: false
  },
  {
    id: 5,
    slabLabel: 'Slab 5: Rs. 3,600,001 to Rs. 5,600,000',
    minPKR: 3600000,
    maxPKR: 5600000,
    ratePercentage: 40,
    fixedBaseTaxPKR: 690000,
    description: 'Rs. 690,000 + 40% of amount exceeding Rs. 3,600,000',
    isExempt: false
  },
  {
    id: 6,
    slabLabel: 'Slab 6: Above Rs. 5,600,000',
    minPKR: 5600000,
    maxPKR: null,
    ratePercentage: 45,
    fixedBaseTaxPKR: 1490000,
    description: 'Rs. 1,490,000 + 45% of amount exceeding Rs. 5,600,000',
    isExempt: false
  }
];

export function calculateFBRTaxPure(profitPKR) {
  const profit = Math.max(0, Math.round(Number(profitPKR) || 0));

  if (profit <= FBR_EXEMPTION_THRESHOLD_PKR) {
    return {
      totalProfitPKR: profit,
      taxPayablePKR: 0,
      netIncomeAfterTaxPKR: profit,
      effectiveTaxRate: 0,
      slabNumber: 1,
      slabName: 'Slab 1: 100% Tax Free (Under 6 Lac)',
      isExempt: true,
      exemptionRemainingPKR: FBR_EXEMPTION_THRESHOLD_PKR - profit,
      calculationBreakdown: `Annual profit (Rs. ${profit.toLocaleString()}) is within the PKR 600,000 exemption limit. 0% tax applies (Rs. 0).`
    };
  }

  if (profit <= 1200000) {
    const taxableExcess = profit - 600000;
    const tax = Math.round(taxableExcess * 0.15);
    return {
      totalProfitPKR: profit,
      taxPayablePKR: tax,
      netIncomeAfterTaxPKR: profit - tax,
      effectiveTaxRate: Number(((tax / profit) * 100).toFixed(1)),
      slabNumber: 2,
      slabName: 'Slab 2: 15% (Above 6 Lac)',
      isExempt: false,
      exemptionRemainingPKR: 0,
      calculationBreakdown: `15% of (Rs. ${profit.toLocaleString()} - Rs. 600,000) = Rs. ${tax.toLocaleString()}`
    };
  }

  if (profit <= 2400000) {
    const taxableExcess = profit - 1200000;
    const tax = Math.round(90000 + (taxableExcess * 0.20));
    return {
      totalProfitPKR: profit,
      taxPayablePKR: tax,
      netIncomeAfterTaxPKR: profit - tax,
      effectiveTaxRate: Number(((tax / profit) * 100).toFixed(1)),
      slabNumber: 3,
      slabName: 'Slab 3: Rs. 90k + 20%',
      isExempt: false,
      exemptionRemainingPKR: 0,
      calculationBreakdown: `Rs. 90,000 + 20% of (Rs. ${profit.toLocaleString()} - Rs. 1,200,000) = Rs. ${tax.toLocaleString()}`
    };
  }

  if (profit <= 3600000) {
    const taxableExcess = profit - 2400000;
    const tax = Math.round(330000 + (taxableExcess * 0.30));
    return {
      totalProfitPKR: profit,
      taxPayablePKR: tax,
      netIncomeAfterTaxPKR: profit - tax,
      effectiveTaxRate: Number(((tax / profit) * 100).toFixed(1)),
      slabNumber: 4,
      slabName: 'Slab 4: Rs. 330k + 30%',
      isExempt: false,
      exemptionRemainingPKR: 0,
      calculationBreakdown: `Rs. 330,000 + 30% of (Rs. ${profit.toLocaleString()} - Rs. 2,400,000) = Rs. ${tax.toLocaleString()}`
    };
  }

  if (profit <= 5600000) {
    const taxableExcess = profit - 3600000;
    const tax = Math.round(690000 + (taxableExcess * 0.40));
    return {
      totalProfitPKR: profit,
      taxPayablePKR: tax,
      netIncomeAfterTaxPKR: profit - tax,
      effectiveTaxRate: Number(((tax / profit) * 100).toFixed(1)),
      slabNumber: 5,
      slabName: 'Slab 5: Rs. 690k + 40%',
      isExempt: false,
      exemptionRemainingPKR: 0,
      calculationBreakdown: `Rs. 690,000 + 40% of (Rs. ${profit.toLocaleString()} - Rs. 3,600,000) = Rs. ${tax.toLocaleString()}`
    };
  }

  const taxableExcess = profit - 5600000;
  const tax = Math.round(1490000 + (taxableExcess * 0.45));
  return {
    totalProfitPKR: profit,
    taxPayablePKR: tax,
    netIncomeAfterTaxPKR: profit - tax,
    effectiveTaxRate: Number(((tax / profit) * 100).toFixed(1)),
    slabNumber: 6,
    slabName: 'Slab 6: Rs. 1.49M + 45%',
    isExempt: false,
    exemptionRemainingPKR: 0,
    calculationBreakdown: `Rs. 1,490,000 + 45% of (Rs. ${profit.toLocaleString()} - Rs. 5,600,000) = Rs. ${tax.toLocaleString()}`
  };
}

export async function getTaxSlabs(req, res, next) {
  try {
    try {
      const rows = await query('SELECT * FROM tax_slabs ORDER BY display_order ASC, id ASC');
      if (rows && rows.length > 0) {
        const formatted = rows.map(r => ({
          id: r.id,
          slabLabel: r.slab_label,
          minPKR: Number(r.min_pkr),
          maxPKR: r.max_pkr !== null ? Number(r.max_pkr) : null,
          ratePercentage: Number(r.rate_percentage),
          fixedBaseTaxPKR: Number(r.fixed_base_tax_pkr),
          description: r.description,
          isExempt: Boolean(r.is_exempt)
        }));
        return res.json({ success: true, count: formatted.length, data: formatted });
      }
    } catch (e) {}
    return res.json({ success: true, count: DEFAULT_FBR_SLABS.length, data: DEFAULT_FBR_SLABS });
  } catch (err) {
    next(err);
  }
}

export async function calculateTax(req, res, next) {
  try {
    const { profitPKR, incomePKR, amount: rawAmount } = req.body;
    const amount = profitPKR !== undefined ? profitPKR : (incomePKR !== undefined ? incomePKR : rawAmount);
    const result = calculateFBRTaxPure(amount || 0);
    return res.json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

export async function updateTaxSlab(req, res, next) {
  try {
    const { id } = req.params;
    const { slabLabel, minPKR, maxPKR, ratePercentage, fixedBaseTaxPKR, description, isExempt } = req.body;
    await query(
      `UPDATE tax_slabs SET
        slab_label = COALESCE(?, slab_label),
        min_pkr = COALESCE(?, min_pkr),
        max_pkr = ?,
        rate_percentage = COALESCE(?, rate_percentage),
        fixed_base_tax_pkr = COALESCE(?, fixed_base_tax_pkr),
        description = COALESCE(?, description),
        is_exempt = COALESCE(?, is_exempt)
       WHERE id = ?`,
      [slabLabel ?? null, minPKR ?? null, maxPKR !== undefined ? maxPKR : null, ratePercentage ?? null, fixedBaseTaxPKR ?? null, description ?? null, isExempt ?? null, id]
    );
    const [updated] = await query('SELECT * FROM tax_slabs WHERE id = ?', [id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}
