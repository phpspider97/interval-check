const axios = require('axios');
const crypto = require('crypto');

const EventEmitter = require('events');
const emitter = new EventEmitter();

let bitcoin_product_id;
let current_bitcoin_price;
let current_lot = 5;
let current_profit = 0;
let total_profit = 0;
let border_price;
let number_of_time_order_executed = 0;

let border_buy_price;
let border_buy_profit_price;
let border_buy_loss_price;

let border_sell_price;
let border_sell_profit_price;
let border_sell_loss_price;

let buy_response = null;
let sell_response = null;

const SLIPPAGE = 30;
const api_url = "https://api.india.delta.exchange";
const key = "3dSIQaAYjeChQ5a8gEnAJ2tYGpHeXF";
const secret = "HRUnXDAKita82DVMvC4WdYZxj4k8mfHuWKRv01nwcHsMQXGHkAP5aV2C9EN7";

function resetBot() {
  lotSize = 5;
  current_profit = 0;
  total_profit = 0;
  ordersExecuted = 0;
  buyExecuted = false;
  sellExecuted = false;
  border_price = 0;
  emitter.emit("log", { type: "info", message: "Bot reset triggered." });
  init();
}

async function generateEncryptSignature(signaturePayload) {
  return crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
}

async function getCurrentPriceOfBitcoin() {
  try {
    const response = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    return { data: response.data, status: true };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function cancelAllOpenOrder() {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyParams = {
      close_all_portfolio: true,
      close_all_isolated: true,
      user_id: 12473901,
    };
    const signaturePayload = `POST${timestamp}/v2/positions/close_all${JSON.stringify(bodyParams)}`;
    const signature = await generateEncryptSignature(signaturePayload);

    const headers = {
      "api-key": key,
      "signature": signature,
      "timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const response = await axios.post(`${api_url}/v2/positions/close_all`, bodyParams, { headers });
    return { data: response.data, status: response.data.success };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function createOrder(bidType, price) {
  return true
  const cancel = await cancelAllOpenOrder();
  if (!cancel.status) return cancel;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyParams = {
      product_id: bitcoin_product_id,
      product_symbol: "BTCUSD",
      size: current_lot,
      side: bidType,
      order_type: "market_order",
    };

    const signaturePayload = `POST${timestamp}/v2/orders${JSON.stringify(bodyParams)}`;
    const signature = await generateEncryptSignature(signaturePayload);

    const headers = {
      "api-key": key,
      "signature": signature,
      "timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    const response = await axios.post(`${api_url}/v2/orders`, bodyParams, { headers });

    if (response.data.success) {
      number_of_time_order_executed++;
      return { data: response.data, status: true };
    }

    return { message: "Order failed", status: false };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function init() {
  const result = await getCurrentPriceOfBitcoin();
  if (!result.status) return;

  const markPrice = Math.round(result.data.result.close);
  bitcoin_product_id = result.data.result.product_id;
  border_price = markPrice;

  border_buy_price = markPrice + 100;
  border_buy_profit_price = markPrice + 600;

  border_sell_price = markPrice - 100;
  border_sell_profit_price = markPrice - 600;

  emitter.emit('log', { type: "init", markPrice });
}
init()

async function triggerOrder(current_price) {
  if (current_lot >= 40) {
    current_lot = 5;
    await init();
  }

  if (!buy_response && current_price > border_buy_price) {
    buy_response = await createOrder('buy', current_price);
    current_lot *= 2;
    sell_response = null;
  }

  if (!sell_response && current_price < border_sell_price) {
    sell_response = await createOrder('sell', current_price);
    current_lot *= 2;
    buy_response = null;
  }

  if (current_price > border_buy_profit_price || current_price < border_sell_profit_price) {
    total_profit += current_profit;
    current_lot = 5;
    await init();
  }

  // Calculate current profit
  if (current_price > border_buy_price) {
    current_profit = ((current_price - border_buy_price) / 1000) * current_lot;
  } else if (current_price < border_sell_price) {
    current_profit = ((border_sell_price - current_price) / 1000) * current_lot;
  }

  // Emit updates
  bitcoin_product_id
  border_price
  border_buy_price
  border_buy_profit_price
  border_sell_price
  border_sell_profit_price

  emitter.emit("update", {
    bitcoin_product_id:bitcoin_product_id,
    border_price:border_price,
    border_buy_price:border_buy_price,
    border_buy_profit_price:border_buy_profit_price,
    border_sell_price:border_sell_price,
    border_sell_profit_price:border_sell_profit_price,
    price: current_price,
    lot: current_lot,
    profit: current_profit.toFixed(2),
    totalProfit: total_profit.toFixed(2),
    ordersExecuted: number_of_time_order_executed,
  });
}

async function getBitcoinPriceLoop() {
  try {
    const res = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    const price = parseFloat(res.data?.result?.close);
    current_bitcoin_price = price;
    await triggerOrder(price);
  } catch (err) {
    emitter.emit('log', { type: "error", message: err.message });
  }
}

async function startBot() {
  //await init();
  setInterval(getBitcoinPriceLoop, 1000);
}

emitter.on("restart", () => {
  resetBot();
});

module.exports = { startBot, emitter };