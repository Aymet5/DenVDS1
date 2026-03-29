import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.ts';

const SHOP_ID = config.YOOKASSA_SHOP_ID;
const SECRET_KEY = config.YOOKASSA_SECRET_KEY;
const APP_URL = config.APP_URL;

export async function createYookassaPayment(amount: number, description: string, metadata: any) {
  const auth = Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');
  try {
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      confirmation: {
        type: 'redirect',
        return_url: `${APP_URL}`
      },
      capture: true,
      description: description,
      metadata: metadata
    }, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Idempotence-Key': uuidv4(),
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  } catch (error: any) {
    console.error('[Yookassa] Create Payment Error:', error.response?.data || error.message);
    throw error;
  }
}

export async function getYookassaPaymentStatus(paymentId: string) {
  const auth = Buffer.from(`${SHOP_ID}:${SECRET_KEY}`).toString('base64');
  try {
    const response = await axios.get(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });
    return response.data;
  } catch (error: any) {
    console.error('[Yookassa] Get Payment Status Error:', error.response?.data || error.message);
    throw error;
  }
}
