const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const WebSocket = require('ws');

const EventEmitter = require('events');
const emitter = new EventEmitter();

let bitcoin_product_id;
let current_lot = 1
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
let buy_sell_point = 100
let buy_sell_profit_point = 200
let cancel_gap = 190
let lot_size_increase = 2
let slippage = 50
let total_error_count = 0

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0
let orderInProgress = false 
let create_buy_order_again = false
let create_sell_order_again = false
const openOrders = [];

const api_url = process.env.API_URL 
const socket_url = process.env.API_URL_SOCKET 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET 

function resetBot() {
  current_lot = 1;
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

let reconnectInterval = 2000;
function wsConnect() {
  // Replace with your actual API credentials
  const WEBSOCKET_URL = socket_url;
  const API_KEY = key;
  const API_SECRET = secret;

  // Generate HMAC SHA256 signature
  function generateSignature(secret, message) {
    return crypto.createHmac('sha256', secret).update(message).digest('hex');
  }

  // Subscribe to a specific channel with given symbols
  function subscribe(ws, channel, symbols) {
    const payload = {
      type: 'subscribe',
      payload: {
        channels: [
          {
            name: channel,
            symbols: symbols
          }
        ]
      }
    };
    ws.send(JSON.stringify(payload));
  }
  
  async function onMessage(data) {
    const message = JSON.parse(data);
    //console.log('total_error_count_start_',total_error_count)
    if(total_error_count>10) return
    //console.log('total_error_count_end_',total_error_count)
    // Subscribe to private channels after successful authentication
    if (message.type === 'success' && message.message === 'Authenticated') {
      subscribe(ws, 'orders', ['all']);
      subscribe(ws, 'v2/ticker', ['BTCUSD']);
      //subscribe(ws, 'positions', ['all']);
    } else {
      
      if(message.type == "v2/ticker"){
        if(message?.close){
            if (message?.close > border_buy_profit_price || message?.close < border_sell_profit_price) { 
              await resetLoop(1)
            }
        }
        //console.log('message___',message?.close,message?.bracket_order )
      }
  
      if(message?.bracket_order == null && message?.meta_data?.pnl != undefined){
        console.log(`============= ORDER : ${message.side} order trigger ============= `)
        const bracket_response = await createBracketOrder(message.side)
        console.log('bracket_response___',bracket_response)
        if(!bracket_response.status){
          await resetLoop(1)
        }
      }
      if(message?.bracket_order == true){
        if(message.meta_data.pnl != undefined){ 
          if(parseFloat(message.meta_data.pnl)>0){
            console.log(`============= BRACKET ORDER : Profit (${message.meta_data.pnl}) from bracket order ============= `)
            await resetLoop(1)
          }else{
            console.log(`============= BRACKET ORDER : Loss (${message.meta_data.pnl}) from bracket order ============= `)
            current_lot *= lot_size_increase 
            await resetLoop(current_lot) 
          }
        }
        //console.log('Received message:', JSON.stringify(message));
      }
    }
  } 
  async function onError(error) {
    await cancelAllOpenOrder()
    console.error('Socket Error:', error.message);
  }
  async function resetLoop(lot_size){
    current_lot = lot_size
    await init()
  }
  function onClose(code, reason) {
    console.log(`Socket closed with code: ${code}, reason: ${reason}`);
    setTimeout(() => {
      console.log('Reconnecting...');
      wsConnect();
    }, reconnectInterval);
  }
  
  function sendAuthentication(ws) {
    const method = 'GET';
    const path = '/live';
    const timestamp = Math.floor(Date.now() / 1000).toString(); // Unix timestamp in seconds
    const signatureData = method + timestamp + path;
    const signature = generateSignature(API_SECRET, signatureData);

    const authPayload = {
      type: 'auth',
      payload: {
        'api-key': API_KEY,
        signature: signature,
        timestamp: timestamp
      }
    };

    ws.send(JSON.stringify(authPayload));
  }

  // Initialize WebSocket connection
  const ws = new WebSocket(WEBSOCKET_URL);
  ws.on('open', () => {
    console.log('Socket opened');
    sendAuthentication(ws);
  });
  ws.on('message', onMessage);
  ws.on('error', onError);
  ws.on('close', onClose);
}
wsConnect();


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
    return { data: response.data, status: true };
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
  //return true
  try{
      let timestamp = Math.floor(Date.now() / 1000)
      const bodyParams = {
          "product_id": bitcoin_product_id,
          "product_symbol": "BTCUSD",
          "take_profit_order": {
            "order_type": "limit_order",
            "stop_price": (bidType == 'buy' ? border_buy_profit_price-buy_sell_point : border_sell_profit_price+buy_sell_point).toString(),
            "limit_price": (bidType == 'buy' ? border_buy_profit_price : border_sell_profit_price).toString()
          },
          "stop_loss_order": {
              "order_type": "limit_order",
              "stop_price": (bidType == 'buy' ? border_buy_price-buy_sell_point : border_sell_price+buy_sell_point).toString(),
              "limit_price": (bidType == 'buy' ? border_buy_price-cancel_gap : border_sell_price+cancel_gap).toString()
          },
          "bracket_stop_trigger_method": "last_traded_price"
      } 
      //console.log('bracket_order_response_body_params____',bodyParams)
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
      //console.log('bracket_order_response___',data)
      if(data.success){
          return {
              data,
              status : true
          } 
      }
      total_error_count++
      return {
              message: JSON.stringify(data),
              status : false
          }
  } catch (error) {
    total_error_count++
    //console.log('bodyParams_bracket_order_error__',error.message)
    return {
        message: error.message,
        status : false
    }
  }
}

async function createOrder(bidType,bitcoin_current_price) {
  //return true
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
          stop_price: (bidType == 'buy')?border_buy_price-buy_sell_point/5:border_sell_price+buy_sell_point/5, 
          limit_price: (bidType == 'buy')?border_buy_price:border_sell_price,
          post_only: true,
          time_in_force: 'gtc',
          stop_trigger_method: "last_traded_price",
          //reduce_only:true
          // bracket_stop_loss_limit_price: (bidType == 'buy')?border_buy_price-5:border_sell_price+5,
          // bracket_stop_loss_price: (bidType == 'buy')?border_buy_price:border_sell_price,
          // bracket_take_profit_limit_price: (bidType == 'buy')?border_buy_profit_price-5:border_sell_profit_price+5,
          // bracket_take_profit_price: (bidType == 'buy')?border_buy_profit_price:border_sell_profit_price,
        };
        //console.log('order_bodyParams___',bitcoin_current_price,bodyParams)
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
        total_error_count++
        project_error_message = JSON.stringify(error?.response?.data)
        orderInProgress = false;
        await triggerLimitOrderOnBothSide(bitcoin_current_price)
        //botRunning = false
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

async function triggerLimitOrderOnBothSide(bitcoin_current_price=0){
  try{
    const cancle_response = await cancelAllOpenOrder()
    if(cancle_response.status){
      const sell_order_response = await createOrder('sell',bitcoin_current_price)
      if(sell_order_response.status){
        await createOrder('buy',bitcoin_current_price)
      }
    }
  }catch(error){
    await cancelAllOpenOrder()
  }
}
async function init(is_cancle_open_order=true) {
  //return true
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
  total_error_count = 0
  //current_lot = 1 
  //buy_bracket_response = false
  //sell_bracket_response = false

  await triggerLimitOrderOnBothSide(markPrice)
  //await createBracketOrder('buy')
  emitter.emit('log', { type: "init", markPrice });
}
init()

async function triggerOrder(current_price,openPosition) {
  //console.log('openPosition____',openPosition)
  //return true
  try{
    // if (current_price > border_buy_profit_price || current_price < border_sell_profit_price) { // exit when acheive target
    //   total_profit += current_profit; 
    //   current_lot = 1
    //   current_lot *= lot_size_increase
    //   await init();
    // }
 
    //console.log('1_____',openPosition.result.entry_price, openPosition.result.size)
    // if(!create_buy_order_again && buy_bracket_response && openPosition.result.entry_price == null){
    //   create_buy_order_again = true
    //   current_lot = 1
    //   await init();
    // }

    // if (!buy_bracket_response && openPosition.result.entry_price != null && openPosition.result.size > 0) {
    //   try{
    //     buy_bracket_response = true
    //     sell_bracket_response = false 
    //     console.log('buy___bracket')
    //     const response = await createBracketOrder('buy',current_price)
    //     if(!response.status){
    //       buy_bracket_response = false 
    //     }
    //   }catch(error){
    //     buy_bracket_response = false 
    //   }
    // }

    // if(!create_sell_order_again && sell_bracket_response && openPosition.result.entry_price == null){
    //   create_sell_order_again = true
    //   current_lot = 1
    //   await init();
    // }
    // if (!sell_bracket_response && openPosition.result.entry_price != null && openPosition.result.size < 0) {
    //   try{
    //     sell_bracket_response = true
    //     buy_bracket_response = false
    //     create_buy_order_again = false
    //     create_sell_order_again = false 
    //     console.log('sell___bracket')
    //     const response = await createBracketOrder('sell',current_price)
    //     console.log('response___',response)
    //     if(!response.status){
    //       sell_bracket_response = false 
    //     }
    //   }catch(error){
    //     sell_bracket_response = false 
    //   }
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
  if(total_error_count>10) return
  if (!botRunning) return;
  try { 
    const res = await axios.get(`${api_url}/v2/tickers/BTCUSD`);
    const current_bitcoin_price = parseFloat(res.data?.result?.close);
    //const openPosition = await currentOpenPosition()
    //if(openPosition.status){
      await triggerOrder(current_bitcoin_price)
    //}
    // balance_response = await currentBalance()
    // if(balance_response.status){ 
    //   current_balance = balance_response.data
    // }
    current_balance = 0
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