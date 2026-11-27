export class PostExService {
  static isEnabled() {
    return false;
  }

  static prepareShipment(order) {
    return {
      provider: 'PostEx',
      integrationEnabled: this.isEnabled(),
      mode: 'draft',
      reference: order.id,
      recipient: {
        name: order.customer.name,
        phone: order.customer.phone,
        city: order.customer.city,
        address: order.customer.address
      },
      payment: {
        method: order.paymentMethod,
        codAmount: order.paymentMethod === 'cod' ? order.total : 0,
        invoiceAmount: order.total,
        currency: 'PKR'
      },
      items: order.items.map(item => ({
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.price,
        variantId: item.variantId || null
      })),
      trackingNumber: order.trackingNumber || null,
      labelUrl: null,
      note: 'Draft only. Confirm official PostEx API field requirements before booking.'
    };
  }

  static throwDisabled(operation) {
    const error = new Error(`PostEx ${operation} is disabled until official API documentation and server-side credentials are configured.`);
    error.statusCode = 503;
    throw error;
  }

  static bookShipment() {
    this.throwDisabled('booking');
  }

  static trackShipment() {
    this.throwDisabled('tracking');
  }

  static getLabel() {
    this.throwDisabled('label retrieval');
  }
}
