import { PaymentPolicyService } from '../services/payment-policy.service.js';

export class PaymentPolicyController {
  static async getPolicies(req, res, next) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Administrator access is required.' });
      }
      const [globalPolicy, cityPolicies] = await Promise.all([
        PaymentPolicyService.getGlobalPolicy(req.user.id),
        PaymentPolicyService.listCityPolicies(req.user.id)
      ]);
      res.json({
        success: true,
        adminId: req.user.id,
        globalPolicy,
        cityPolicies
      });
    } catch (error) {
      next(error);
    }
  }

  static async updateGlobalPolicy(req, res, next) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Administrator access is required.' });
      }
      const globalPolicy = await PaymentPolicyService.upsertGlobalPolicy(req.user.id, req.body || {});
      res.json({
        success: true,
        message: 'Global advance-payment policy saved for your products.',
        globalPolicy
      });
    } catch (error) {
      next(error);
    }
  }

  static async saveCityPolicy(req, res, next) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Administrator access is required.' });
      }
      const cityPolicy = await PaymentPolicyService.upsertCityPolicy(req.user.id, req.body || {});
      res.status(201).json({
        success: true,
        message: `City advance-payment rule saved for ${cityPolicy.cityName}.`,
        cityPolicy
      });
    } catch (error) {
      next(error);
    }
  }

  static async deleteCityPolicy(req, res, next) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden. Administrator access is required.' });
      }
      const deleted = await PaymentPolicyService.deleteCityPolicy(req.user.id, req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'City advance-payment rule not found.' });
      }
      res.json({ success: true, message: 'City advance-payment rule removed.' });
    } catch (error) {
      next(error);
    }
  }
}
