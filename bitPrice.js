const axios = require('axios');
require('dotenv').config();

const api_url = process.env.API_URL 
async function getCurrentPriceOfBitcoin() {
    try {  
      const response = await axios.get(`${api_url}/v2/tickers?contract_type=perpetual_futures`);
      //console.log(response.data.result) 
      const btcTicker = response.data.result.find(ticker => ticker.symbol === 'BTCUSD');
 
      console.table({
        close: btcTicker.close,
        high: btcTicker.high,
        low: btcTicker.low,
        open: btcTicker.open,
        mark_price: parseFloat(btcTicker.mark_price).toFixed(2),
        spot_price: parseFloat(btcTicker.spot_price).toFixed(2),
      })

    } catch (error) {
        console.log('error____',error.message) 
    }
}
setInterval(async ()=>{
    await getCurrentPriceOfBitcoin()
},1000)