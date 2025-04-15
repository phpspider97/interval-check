const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const EventEmitter = require('events');
const emitter = new EventEmitter();

let bitcoin_product_id;
let current_lot = 5
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
let buy_bracket_response = null;
let sell_bracket_response = null;
let botRunning = true;
let buy_sell_point = 50
let buy_sell_profit_point = 200
let cancel_gap = buy_sell_point*2-10
let lot_size_increase = 2
let slippage = 50

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0
let orderInProgress = false
let triggerOrderOnBothSide = false

const api_url = process.env.API_URL 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET

function resetBot() {
  current_lot = 5;
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
async function currentOpenPosition() {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signaturePayload = `GET${timestamp}/v2/positions?product_id=${bitcoin_product_id}`;
    const signature = await generateEncryptSignature(signaturePayload);

    const headers = {
      "api-key": key,
      "signature": signature,
      "timestamp": timestamp,
      "Content-Type": "application/json",
      "Accept": "application/json",
    }; 
    const response = await axios.get(`${api_url}/v2/positions?product_id=${bitcoin_product_id}`, { headers });
    //console.log('response____',response.data)
    return { 
      data: response.data,
      status:true
    }
  } catch (error) {
    console.log('get_balance_error_message__',error.response.data)
    project_error_message = JSON.stringify(error.response.data)
    return { message: error.message, status: false };
  }
}

async function createBracketOrder(bidType,current_price){
  try{
      let timestamp = Math.floor(Date.now() / 1000)
      const bodyParams = {
          "product_id": bitcoin_product_id,
          "product_symbol": "BTCUSD",
          "stop_loss_order": {
              "order_type": "limit_order",
              "stop_price": (bidType === 'buy' ? border_buy_price-cancel_gap : border_sell_price+cancel_gap).toString(),
              "limit_price": (bidType === 'buy' ? border_buy_price-cancel_gap+5 : border_sell_price+cancel_gap+5).toString()
          },
          "take_profit_order": {
              "order_type": "limit_order",
              "stop_price": (bidType === 'buy' ? border_buy_profit_price : border_sell_profit_price).toString(),
              "limit_price": (bidType === 'buy' ? border_buy_profit_price+5 : border_sell_profit_price-5).toString()
          },
          //"bracket_stop_trigger_method": "spot_price"
      } 
      let signaturePayload = `POST${timestamp}/v2/orders/bracket${JSON.stringify(bodyParams)}`
      signature = await generateEncryptSignature(signaturePayload)
      const headers = {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "api-key": key,
          "signature": signature,
          "timestamp": timestamp
      }
      const response = await fetch(`${api_url}/v2/orders/bracket`,{ 
          method: "POST",
          headers,
          body: JSON.stringify(bodyParams)
      })
      const data = await response.json() 
      //console.log('bodyParams_bracket_order_',data)
      if(data.success){
          current_lot *= lot_size_increase
          return {
              data,
              status : true
          } 
      }
      return {
              message:"Some issue to get bitcoin current price.",
              status : false
          }
  } catch (error) {
    console.log('bodyParams_bracket_order_error__',error.message)
      return {
          message: error.message,
          status : false
      }
  }
}

async function createOrder(bidType,current_price) {
      if (orderInProgress) return { message: "Order already in progress", status: false };
      orderInProgress = true
      try {
       // bidType = (bidType == 'buy')?'sell':'buy'
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyParams = {
          product_id: bitcoin_product_id,
          product_symbol: "BTCUSD",
          size: current_lot,
          side: bidType, 
          order_type: "limit_order",
          stop_order_type: "stop_loss_order",
          stop_price: (bidType == 'buy')?border_buy_price:border_sell_price, 
          limit_price: (bidType == 'buy')?border_buy_price-5:border_sell_price-5,
          post_only: true,
          time_in_force: 'gtc',
          stop_trigger_method: "last_traded_price",
          // bracket_stop_loss_limit_price: (bidType == 'buy')?border_buy_price-5:border_sell_price+5,
          // bracket_stop_loss_price: (bidType == 'buy')?border_buy_price:border_sell_price,
          // bracket_take_profit_limit_price: (bidType == 'buy')?border_buy_profit_price-5:border_sell_profit_price+5,
          // bracket_take_profit_price: (bidType == 'buy')?border_buy_profit_price:border_sell_profit_price,
        };
       // console.log('order_bodyParams___',bodyParams)
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
        //console.log('order_response_',JSON.stringify(response.data))
        //console.log('order_added___')
        if (response.data.success) {
          number_of_time_order_executed++;
          //updateInit(bidType,current_price)
          //await changeOrderLevarage()
          return { data: response.data, status: true };
        }

        return { message: "Order failed", status: false };
      } catch (error) {
        console.log('error.message___2_',JSON.stringify(error?.response?.data))
        project_error_message = JSON.stringify(error?.response?.data)
        await cancelAllOpenOrder()
        botRunning = false
        return { message: error?.message, status: false };
      } finally {
        orderInProgress = false;
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

async function triggerLimitOrderOnBothSide(){
  try{
    await cancelAllOpenOrder()
    setTimeout(async () => {
      await createOrder('sell')
      await createOrder('buy')
  }, 1000);
  }catch(error){
    await cancelAllOpenOrder()
  }
}
async function init(is_cancle_open_order=true) {
  if(is_cancle_open_order){
    //await cancelAllOpenOrder()
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
  //current_lot = 5
  triggerOrderOnBothSide = false
  buy_bracket_response = false
  sell_bracket_response = false

  await triggerLimitOrderOnBothSide()
  //await createBracketOrder('buy')
  emitter.emit('log', { type: "init", markPrice });
}
init()

async function triggerOrder(current_price,openPosition) {
  //return true
  try{
    if (current_price > border_buy_profit_price || current_price < border_sell_profit_price) { // exit when acheive target
      total_profit += current_profit; 
      current_lot = 5
      await init();
    }

    if (!triggerOrderOnBothSide && current_price < border_buy_price-slippage && current_price > border_sell_price+slippage) { // exit when acheive target
      triggerOrderOnBothSide = true
      //await triggerLimitOrderOnBothSide()
    }
    //console.log('1_____',openPosition.result.entry_price, openPosition.result.size)
    if (!buy_bracket_response && openPosition.result.entry_price != null && openPosition.result.size > 0) {
      try{
        buy_bracket_response = true
        sell_bracket_response = false
        triggerOrderOnBothSide = false
        console.log('buy___bracket')
        const response = await createBracketOrder('buy',current_price)
        if(!response.status){
          buy_bracket_response = false 
        }
      }catch(error){
        buy_bracket_response = false 
      }
    }

    if (!sell_bracket_response && openPosition.result.entry_price != null && openPosition.result.size < 0) {
      try{
        sell_bracket_response = true
        buy_bracket_response = false
        triggerOrderOnBothSide = false
        console.log('sell___bracket')
        const response = await createBracketOrder('sell',current_price)
        if(!response.status){
          sell_bracket_response = false 
        }
      }catch(error){
        sell_bracket_response = false 
      }
    }

    // if (buy_response && current_price <= border_buy_price-buy_sell_point) { //cancel existing buy order
    //   buy_response = null
    //   buy_bracket_response = null
    //   const cancel = await cancelAllOpenOrder();
    //   if (!cancel.status) return cancel;
    // }
    // if (!buy_response && current_price > border_price) { //buy order
    //   console.log('buy_triggered')
    //   buy_response = true
    //   sell_response = null
    //   order_exicuted_at_price = current_price 
    // }
    // if (!buy_bracket_response && current_price > border_buy_price+3) {
    //     buy_bracket_response = true
    //     const bracket_order = await createBracketOrder('buy',current_price)
    // }
    
    // if (sell_response && current_price >= border_sell_price+buy_sell_point) { // cancel existing sell order
    //   sell_response = null;
    //   sell_bracket_response = null 
    //   const cancel = await cancelAllOpenOrder();
    //   if (!cancel.status) return cancel;
    // }

    // if (!sell_response && current_price < border_price) { // sell order
    //   console.log('sell_triggered')
    //   sell_response = true
    //   buy_response = null
    //   order_exicuted_at_price = current_price 
    // }

    // if (!sell_bracket_response && current_price < border_sell_price) { // sell order
    //   sell_bracket_response = true
    //   const bracket_order = await createBracketOrder('buy',current_price)
    //   console.log('buy_bracket_order___',bracket_order)
    // }

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
    const openPosition = await currentOpenPosition()
    if(openPosition.status){
      await triggerOrder(current_bitcoin_price,openPosition?.data)
    }
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
  setInterval(getBitcoinPriceLoop, 900);
}

emitter.on("restart", () => {
  resetBot();
});

module.exports = { startBot, emitter };