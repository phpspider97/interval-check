const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const EventEmitter = require('events');
const emitter = new EventEmitter();

let bitcoin_product_id;
let current_lot = 60;
let current_profit = 0;
let total_profit = 0;
let border_price;
let number_of_time_order_executed = 0;

let border_buy_price;
let border_buy_profit_price;

let border_sell_price;
let border_sell_profit_price;

let buy_response = null;
let sell_response = null;
let botRunning = true;
let buy_sell_point = 50
let buy_sell_profit_point = 100
let cancel_gap = 70

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0

const api_url = process.env.API_URL 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET

function resetBot() {
  botRunning = true;
  current_profit = 0;
  total_profit = 0;
  ordersExecuted = 0;
  buyExecuted = false;
  sellExecuted = false;
  border_price = 0;
  project_error_message = '';
  order_exicuted_at_price = 0;
  emitter.emit("log", { type: "info", message: "Bot reset triggered." });
  init();
}

async function generateEncryptSignature(signaturePayload) {
  return crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
}

async function cancelAllOpenOrder() {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyParams = {
      close_all_portfolio: true,
      close_all_isolated: true,
      user_id: process.env.WEB_USER_ID,
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
    console.log('error.message___1_',error.response.data)
    project_error_message = JSON.stringify(error.response.data)
    botRunning = false
    return { message: error.message, status: false };
  }
} 
function updateInit(bidType,current_price){
    if(bidType == 'buy' && (current_price-border_buy_price)>50){
        init(false)
    }
    if(bidType == 'sell' && (border_sell_price-current_price)>50){
      init(false)
  }
}
async function currentBalance() {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signaturePayload = `GET${timestamp}/v2/wallet/balances`;
    const signature = await generateEncryptSignature(signaturePayload);

    const headers = {
      "api-key": key,
      "signature": signature,
      "timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "application/json",
    }; 
    const response = await axios.get(`${api_url}/v2/wallet/balances`, { headers });
    //console.log('response____',JSON.parse(response.data.result[0].balance).toFixed(2))
    return { 
      data: JSON.parse(response.data.result[0].balance).toFixed(2),
      status:true
    }
  } catch (error) {
    console.log('get_balance_error_message__',error.response.data)
    project_error_message = JSON.stringify(error.response.data)
    return { message: error.message, status: false };
  }
}
async function createOrder(bidType,current_price) {
  // number_of_time_order_executed++;
  // updateInit(bidType,current_price)
  // return true
  
    const cancel = await cancelAllOpenOrder();
    if (!cancel.status) return cancel;
    if(cancel.status){
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyParams = {
          product_id: bitcoin_product_id,
          product_symbol: "BTCUSD",
          size: current_lot,
          side: bidType,
          order_type: "market_order",
          leverage: 20,
          time_in_force: "ioc"
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
          updateInit(bidType,current_price)
          //await changeOrderLevarage()
          return { data: response.data, status: true };
        }

        return { message: "Order failed", status: false };
      } catch (error) {
        console.log('error.message___2_',error.response.data)
        project_error_message = JSON.stringify(error.response.data)
        await cancelAllOpenOrder()
        botRunning = false
        return { message: error.message, status: false };
      }
  }
}

async function getCurrentPriceOfBitcoin() {
  try {
    const response = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    //console.log('response___',response)
    return { data: response.data, status: true };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function init(is_cancle_open_order=true) {
  if(is_cancle_open_order){
    await cancelAllOpenOrder()
  }
  const result = await getCurrentPriceOfBitcoin();
  if (!result.status) return;

  const markPrice = Math.round(result.data.result.close);
  bitcoin_product_id = result.data.result.product_id;
  border_price = markPrice;

  border_buy_price = markPrice + buy_sell_point;
  border_buy_profit_price = border_buy_price + buy_sell_profit_point;

  border_sell_price = markPrice - buy_sell_point;
  border_sell_profit_price = border_sell_price - buy_sell_profit_point;

  order_exicuted_at_price = 0 

  emitter.emit('log', { type: "init", markPrice });
}
init()

async function triggerOrder(current_price) {
  try{
    if (!buy_response && current_price > border_buy_price) { //buy order
      await createOrder('buy',current_price)
      buy_response = true
      sell_response = null
      order_exicuted_at_price = current_price
    }
    if (buy_response && current_price <= border_buy_price-cancel_gap) { //cancel existing buy order
      const cancel = await cancelAllOpenOrder();
      if (!cancel.status) return cancel;
      buy_response = null
    }

    if (!sell_response && current_price < border_sell_price) { // sell order
      await createOrder('sell',current_price)
      sell_response = true
      buy_response = null
      order_exicuted_at_price = current_price
    }
    if (sell_response && current_price >= border_sell_price+cancel_gap) { // cancel existing sell order
      const cancel = await cancelAllOpenOrder();
      if (!cancel.status) return cancel;
      sell_response = null;
    }

    if (current_price > border_buy_profit_price || current_price < border_sell_profit_price) { // exit when acheive target
      total_profit += current_profit; 
      await init();
    }

    // Calculate current profit
    if (current_price > border_buy_price) {
      current_profit = ((current_price - border_buy_price) / 1000) * current_lot;
    } else if (current_price < border_sell_price) {
      current_profit = ((border_sell_price - current_price) / 1000) * current_lot;
    }

    // Emit updates
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
      order_exicuted_at_price: order_exicuted_at_price,
      project_error_message: project_error_message,
      current_balance: current_balance
    })
  }catch(error){
    botRunning = false
    console.log('error____',error)
  }
}

async function getBitcoinPriceLoop() { 
  if (!botRunning) return;
  try { 
    const res = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    const current_bitcoin_price = parseFloat(res.data?.result?.close);
    await triggerOrder(current_bitcoin_price);
    balance_response = await currentBalance()
    if(balance_response.status){ 
      current_balance = balance_response.data
    }
  } catch (err) {
    emitter.emit('log', { type: "error", message: err.message });
  }
}

emitter.on("stop", () => {
  botRunning = false; 
  emitter.emit("log", { type: "warn", message: "Bot has been stopped." });
});

async function startBot() {
  setInterval(getBitcoinPriceLoop, 1000);
}

emitter.on("restart", () => {
  resetBot();
});

module.exports = { startBot, emitter };