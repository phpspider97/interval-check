const axios = require('axios');

const now = Math.floor(Date.now() / 1000); // current time in seconds
const thirtyDaysAgo = now - (30 * 24 * 60 * 60); // 30 days in seconds

// console.log('Start (30 days ago):', thirtyDaysAgo);
// console.log('End (now):', now);

const API_URL = 'https://api.india.delta.exchange/v2/history/candles';
const symbol = 'BTCUSD';
const resolution = '5m';
const start = thirtyDaysAgo; // Replace with your desired UNIX timestamp
const end = now;   // Replace with your desired UNIX timestamp

async function backtest() {
  try {
    const response = await axios.get(API_URL, {
      params: { symbol, resolution, start, end }
    });

    const candles = response.data.result;
    let crossCount = 0;

    // Loop through each candle and count times price crossed 70000
    for (const candle of candles) {
        //crossCount++
        const closePrice = candle.close; // [timestamp, open, high, low, close, volume]
        console.log('closePrice___',closePrice)
        if (closePrice > 70000) {
            crossCount++;
        }
    }

    console.log(`BTC closed above $70,000 ${crossCount} times.`);
  } catch (error) {
    console.error('Error fetching or processing data:', error.message);
  }
}

backtest();