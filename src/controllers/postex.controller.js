import { OrderController } from './order.controller.js';
import { OrderService } from '../services/order.service.js';
import { PostExService } from '../services/postex.service.js';

async function getAuthorizedOrder(req) {
  await OrderController.assertAdminOwnsOrder(req.params.id, req.user.id);
  const order = await OrderService.getOrderById(req.params.id);
  if (!order) {
    const error = new Error(`Order "${req.params.id}" not found.`);
    error.statusCode = 404;
    throw error;
  }
  return order;
}

export async function preparePostExShipment(req, res, next) {
  try {
    const order = await getAuthorizedOrder(req);
    return res.json({
      success: true,
      shipment: PostExService.prepareShipment(order)
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
}

export async function bookPostExShipment(req, res, next) {
  try {
    await getAuthorizedOrder(req);
    return PostExService.bookShipment();
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
}

export async function trackPostExShipment(req, res, next) {
  try {
    await getAuthorizedOrder(req);
    return PostExService.trackShipment();
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
}

export async function getPostExLabel(req, res, next) {
  try {
    await getAuthorizedOrder(req);
    return PostExService.getLabel();
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
}
