const axios = require('axios')
const { EMA } = require('technicalindicators')
const nodemailer = require('nodemailer')

const SYMBOL = 'BTCUSD'
const INTERVAL = '5m'
let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.USER_EMAIL,
      pass: process.env.USER_PASSWORD
    },
  }); 

async function fetchCandles() {
    const end_time_stamp = Math.floor(Date.now() / 1000)
    const start_time_stamp = end_time_stamp - (2 * 60 * 60)

    try {
        const response = await axios.get('https://cdn-ind.testnet.deltaex.org/v2/history/candles', {
            params : { 
                symbol : SYMBOL, 
                resolution : INTERVAL, 
                start : start_time_stamp, 
                end : end_time_stamp 
            }
        }); 
        const candles = response.data.result 
        const closePrices = candles.map(c => parseFloat(c.close));
        return closePrices;

    } catch (err) {
        console.error('❌ Error fetching candles:', err.message);
        return [];
    }
}
function detectCrossover(emaShort, emaLong) {
    const len = emaShort.length;
    if (len < 2 || emaShort.length !== emaLong.length) return null;
  
    const prevDiff = emaShort[len - 2] - emaLong[len - 2];
    const currDiff = emaShort[len - 1] - emaLong[len - 1];
  
    if (prevDiff < 0 && currDiff > 0) return 'bullish';
    if (prevDiff > 0 && currDiff < 0) return 'bearish';
    return null;
  }
  
  /**
   * Check EMA crossover and log result
   */
  async function checkEmaCrossover() {
    const closes = await fetchCandles();
    if (closes.length < 21) {
      console.log('⚠️ Not enough data to calculate EMAs');
      return;
    }
  
    const ema9 = EMA.calculate({ period: 9, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });
  
    const crossover = detectCrossover(ema9, ema21);
    const lastPrice = closes[closes.length - 1]; 
    if (crossover === 'bullish') {
      console.log(`🚀 Bullish crossover detected at price: ${lastPrice}`);
    } else if (crossover === 'bearish') {
      console.log(`🔻 Bearish crossover detected at price: ${lastPrice}`);
    } else {
      console.log(`ℹ️  No crossover. Last price: ${lastPrice}`);
    }
  }
  
  // Run on start and every minute
  checkEmaCrossover();
  setInterval(checkEmaCrossover, 5 * 1000);