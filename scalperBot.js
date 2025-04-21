require("dotenv").config();
const axios = require("axios");
const WebSocket = require("ws");
const { EMA, RSI } = require("technicalindicators");

const API_KEY = process.env.DELTA_API_KEY;
const API_SECRET = process.env.DELTA_API_SECRET;
const SYMBOL = process.env.MARKET_SYMBOL || "BTCUSDT";
const API_URL = process.env.API_URL;
const API_URL_SOCKET = process.env.API_URL_SOCKET;

// Candles for indicator calculation
let candles = [];

// EMA and RSI settings
const shortEmaPeriod = 9;
const longEmaPeriod = 21;
const rsiPeriod = 14;

const ws = new WebSocket(`${API_URL_SOCKET}`);

ws.on("open", () => {
  //console.log("WebSocket connected");

  const subscribeMsg = {
    type: "subscribe",
    payload: {
      channels: [
        {
          name: "v2/ticker",
          symbols: [SYMBOL],
        },
      ],
    },
  };

  ws.send(JSON.stringify(subscribeMsg));
});

ws.on("message", async (data) => {
  const parsed = JSON.parse(data);
  //console.log('parsed____',parsed)
  if (parsed && parsed.mark_price) {
    const price = parseFloat(parsed.mark_price);

    const now = new Date();
    const lastCandle = candles[candles.length - 1];

    // Simulate 1-min candles (basic example)
    if (!lastCandle || now - lastCandle.time >= 60000) {
      candles.push({
        time: now,
        close: price,
      });

      console.log('price____',price)
      if (candles.length > 100) candles.shift();

      await evaluateStrategy();
    } else {
      lastCandle.close = price;
    }
  }
});
async function onError(error) { 
    console.error('Socket Error:', error.message);
}
async function onClose(error) { 
    console.error('Socket close:', error.message);
}
ws.on('error', onError);
ws.on('close', onClose);

async function evaluateStrategy() {
  const closes = candles.map((c) => c.close);
  console.log('closes___',closes)  
  if (closes.length >= Math.max(longEmaPeriod, rsiPeriod)) {
  } else {
    console.log(`Not enough data to calculate indicators. Need at least ${Math.max(longEmaPeriod, rsiPeriod)} data points.`);
  }

  if (closes.length < longEmaPeriod + 2) return;

  const shortEma = EMA.calculate({ period: shortEmaPeriod, values: closes });
  const longEma = EMA.calculate({ period: longEmaPeriod, values: closes });
  const rsi = RSI.calculate({ period: rsiPeriod, values: closes });

  const len = shortEma.length;
  const latestShortEma = shortEma[len - 1];
  const previousShortEma = shortEma[len - 2];
  const latestLongEma = longEma[len - 1];
  const previousLongEma = longEma[len - 2];
  const latestRsi = rsi[rsi.length - 1];

  const price = closes[closes.length - 1];

  const isBullishCross = previousShortEma < previousLongEma && latestShortEma > latestLongEma;
  const isBearishCross = previousShortEma > previousLongEma && latestShortEma < latestLongEma;

    console.log('isBullishCross___',latestRsi,isBullishCross)

  if (isBullishCross && latestRsi > 40 && latestRsi < 70) {
    console.log(`📈 LONG signal | Price: ${price} | RSI: ${latestRsi}`);
    await placeOrder("buy", price);
  } else if (isBearishCross && latestRsi < 60 && latestRsi > 30) {
    console.log(`📉 SHORT signal | Price: ${price} | RSI: ${latestRsi}`);
    await placeOrder("sell", price);
  }
}

async function placeOrder(side, price) {
  const quantity = 0.01; // adjust for your capital
  const stopLoss = side === "buy" ? price * 0.995 : price * 1.005;
  const takeProfit = side === "buy" ? price * 1.01 : price * 0.99;

  try {
    const orderData = {
      product_id: 1, // Use correct product ID for BTCUSDT on Delta
      size: quantity,
      side: side.toUpperCase(),
      order_type: "market",
    };

    const headers = {
      "api-key": API_KEY,
      "timestamp": Date.now(),
      "Content-Type": "application/json",
    };

    const response = await axios.post(
      `${API_URL}/v2/orders`,
      orderData,
      { headers }
    );

    console.log("✅ Order placed:", response.data);
  } catch (err) {
    console.error("❌ Order failed:", err.response?.data || err.message);
  }
}