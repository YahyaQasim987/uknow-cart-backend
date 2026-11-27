import { CourierService } from '../services/courier.service.js';
import { OrderController } from './order.controller.js';

async function assertAdminOwns(req, orderId) {
  await OrderController.assertAdminOwnsOrder(orderId, req.user.id);
}

function sendError(res, error, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      providerResponse: error.providerResponse
    });
  }
  return next(error);
}

export async function listCouriers(req, res, next) {
  try {
    const providers = await CourierService.listProviders();
    return res.json({ success: true, count: providers.length, providers });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function createCourier(req, res, next) {
  try {
    const provider = await CourierService.createProvider(req.body || {});
    const { apiKey, extraHeaders, ...safe } = provider;
    return res.status(201).json({
      success: true,
      message: 'Courier added.',
      provider: { ...safe, apiKeySet: Boolean(apiKey), apiKeyPreview: apiKey ? `••••••${apiKey.slice(-4)}` : '' }
    });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function updateCourier(req, res, next) {
  try {
    const provider = await CourierService.updateProvider(req.params.key, req.body || {});
    const { apiKey, extraHeaders, ...safe } = provider;
    return res.json({
      success: true,
      message: 'Courier settings saved.',
      provider: { ...safe, apiKeySet: Boolean(apiKey), apiKeyPreview: apiKey ? `••••••${apiKey.slice(-4)}` : '' }
    });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function deleteCourier(req, res, next) {
  try {
    const result = await CourierService.deleteProvider(req.params.key);
    return res.json({ success: true, message: 'Courier removed.', ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function testCourier(req, res, next) {
  try {
    const result = await CourierService.testProvider(req.params.key);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function previewOrderShipment(req, res, next) {
  try {
    await assertAdminOwns(req, req.params.id);
    const providerKey = req.query.provider || req.body?.provider;
    const preview = await CourierService.previewShipment(req.params.id, providerKey);
    return res.json({ success: true, ...preview });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function bookOrderShipment(req, res, next) {
  try {
    await assertAdminOwns(req, req.params.id);
    const providerKey = req.body?.provider;
    const result = await CourierService.bookShipment({
      orderId: req.params.id,
      providerKey,
      actor: req.user.name || req.user.email || 'Store Administrator'
    });
    return res.json({
      success: true,
      message: `Shipment booked with ${result.shipment.providerName}. Tracking: ${result.shipment.trackingNumber}`,
      shipment: result.shipment,
      order: result.assignment
    });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function trackOrderShipment(req, res, next) {
  try {
    await assertAdminOwns(req, req.params.id);
    const result = await CourierService.trackShipment({
      orderId: req.params.id,
      providerKey: req.query.provider || req.body?.provider
    });
    return res.json({
      success: true,
      message: `Tracking refreshed: ${result.tracking.statusLabel}`,
      ...result
    });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function cancelOrderShipment(req, res, next) {
  try {
    await assertAdminOwns(req, req.params.id);
    const result = await CourierService.cancelShipment({
      orderId: req.params.id,
      reason: req.body?.reason || 'Cancelled by store admin'
    });
    return res.json({ success: true, message: 'Courier booking cancelled.', ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}

export async function getOrderLabel(req, res, next) {
  try {
    await assertAdminOwns(req, req.params.id);
    const result = await CourierService.getLabel({ orderId: req.params.id });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, next);
  }
}
