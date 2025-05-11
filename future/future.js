const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const EventEmitter = require('events');
const futureEmitter = new EventEmitter();

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.USER_EMAIL,
      pass: process.env.USER_PASSWORD
    },
  }); 

let bitcoin_product_id; 
let current_profit = 0;
let total_profit = 0;

let lot_size_array = [1, 3, 9]

let number_of_time_order_executed = 0

let border_buy_price;
let border_buy_profit_price;
let border_price;
let border_sell_price;
let border_sell_profit_price;
    
let buy_sell_profit_point = 230
let buy_sell_point = 50 

let total_error_count = 0

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0
let orderInProgress = false   
let current_running_order = ''

const api_url = process.env.API_URL 
const socket_url = process.env.API_URL_SOCKET 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET 

function resetBot() {
  current_lot = lot_size_array[number_of_time_order_executed];
  botRunning = true;
  current_profit = 0;
  total_profit = 0;
  ordersExecuted = 0;
  buyExecuted = false;
  sellExecuted = false;
  border_price = 0;
  project_error_message = '';
  order_exicuted_at_price = 0;
  futureEmitter.emit("log", { type: "info", message: "Bot reset triggered." });
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
    const message = JSON.parse(data) 
    if (message.type === 'success' && message.message === 'Authenticated') {
      subscribe(ws, 'orders', ['all']);
      subscribe(ws, 'v2/ticker', ['BTCUSD']); 
    } else {
        if(total_error_count>5) { 
            ws.close(1000, 'Too many errors');
        }    
        if(message.type == "v2/ticker"){  
            console.log('spot_price___',message?.close)
            if(current_running_order == 'sell' && message?.close>border_buy_price){
                console.log('');console.log('')
                console.log('==================CLEAR SELL ORDER==================')
                current_running_order = ''
                sendEmail('',`LOSS IN ORDER : ${lot_size_array[number_of_time_order_executed]}`)
            }
            if(current_running_order == '' && message?.close>border_buy_price){
                console.log('');console.log('')
                console.log('==================BUY PROFIT BORDER==================',border_buy_profit_price)
                console.log('==================BUY BORDER==================',border_buy_price)
                console.log('==================BUY ORDER AT : ==================',Math.round(message?.close))
                await cancelAllOpenOrder()
                current_running_order = 'buy'  
                await createOrder('buy',message?.close)
            } 
            if(current_running_order == 'buy' && message?.close<border_sell_price){
                console.log('');console.log('')
                console.log('==================CLEAR BUY ORDER==================')
                current_running_order = ''
                sendEmail('',`LOSS IN ORDER : ${lot_size_array[number_of_time_order_executed]}`)
            }
            if(current_running_order == '' && message?.close<border_sell_price){
                console.log('');console.log('')
                console.log('==================SELL PROFIT BORDER==================',border_sell_profit_price)
                console.log('==================SELL BORDER==================',border_sell_price)
                console.log('==================SELL ORDER AT : ==================',Math.round(message?.close))
                await cancelAllOpenOrder()
                current_running_order = 'sell' 
                await createOrder('sell',message?.close)
            }
 
            if (message?.close > border_buy_profit_price || message?.close < border_sell_profit_price) { 
                console.log('RESER LOOP : ',message?.close,border_buy_profit_price,border_sell_profit_price)
                console.log('cancel_order_on_profit___')
                sendEmail('',`PROFIT IN ORDER : ${lot_size_array[number_of_time_order_executed]}`)
                await cancelAllOpenOrder()
                await resetLoop()
            }

            await triggerOrder(message?.close)
        } 
    } 
  } 
  async function onError(error) {
    await cancelAllOpenOrder()
    console.error('Socket Error:', error.message);
  }
  async function resetLoop(){
    number_of_time_order_executed = 0
    setTimeout(async () => {
        await init()
    }, 5000)
  }
  async function onClose(code, reason) {
    console.log(`Socket closed with code: ${code}, reason: ${reason}`)
    if(code == 1000){
      console.log('cancle all order')
      sendEmail('CODE : 1000',`SOCKET TOO MANY ERROR`)
      await cancelAllOpenOrder()

      setTimeout(() => { // connect again after 1 minute
        total_error_count = 0
        console.log('Reconnecting after long time...')
        wsConnect();
        resetLoop()
      }, 60000);

    }else{
      total_error_count = 0
      sendEmail(`CODE : ${code}`,`SOCKET UNEXPECTED ERROR`)
      setTimeout(() => {
        console.log('Reconnecting...')
        wsConnect();
      }, reconnectInterval);
    }
  }
  
  function sendAuthentication(ws) {
    const method = 'GET';
    const path = '/live';
    const timestamp = Math.floor(Date.now() / 1000).toString();
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
    current_running_order = ''
    const timestamp = Math.floor(Date.now() / 1000)
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
    project_error_message = JSON.stringify(error.response.data||error.message)
    botRunning = false
    return { message: error.message, status: false };
  }
}

function sendEmail(message,subject){
    let mailOptions = {
        from: 'phpspider97@gmail.com',
        to: 'neelbhardwaj97@gmail.com',
        subject: subject,
        html: message
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log('Error:', error);
        }
        console.log('Email sent:', info.response);
    });
}

async function createOrder(bidType,bitcoin_current_price) {
      if(number_of_time_order_executed>2){
        number_of_time_order_executed = 0
      }  
      if(total_error_count>5){
        return true
      }
      // if (orderInProgress) return { message: "Order already in progress", status: false };
      // orderInProgress = true
      try { 
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyParams = {
          product_id: bitcoin_product_id,
          product_symbol: "BTCUSD",
          size: lot_size_array[number_of_time_order_executed],
          side: bidType,   
          order_type: "market_order", 
        };
        //console.log('order_bodyParams___', bitcoin_current_price, bodyParams)
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
          const message_template = `<br /><br /><br />
          <table border="1" cellpadding="8" cellspacing="3">
              <tr>
                  <td>Size</td>
                  <td>:</td>
                  <td>${lot_size_array[number_of_time_order_executed]}</td> 
              </tr>
              <tr>
                  <td>Side</td>
                  <td>:</td>
                  <td>${bidType}</td> 
              </tr>
              <tr>
                  <td>Current Price</td>
                  <td>:</td>
                  <td>${bitcoin_current_price}</td> 
              </tr>
              <tr style='background:green;color:white'>
                  <td>Border Buy Profit Price</td>
                  <td>:</td>
                  <td>${border_buy_profit_price}</td> 
              </tr>
              <tr style='background:green;color:white'>
                  <td>border_buy_price</td>
                  <td>:</td>
                  <td>${border_buy_price}</td> 
              </tr>
              <tr style='background:yellow;color:black'>
                  <td>Border Price</td>
                  <td>:</td>
                  <td>${border_price}</td> 
              </tr> 
              <tr style='background:red;color:white'>
                  <td>Border Sell Price</td>
                  <td>:</td>
                  <td>${border_sell_price}</td> 
              </tr>
              <tr style='background:red;color:white'>
                  <td>Border Sell Profit Price</td>
                  <td>:</td>
                  <td>${border_sell_profit_price}</td> 
              </tr> 
          </table>
          `
          sendEmail(message_template,`CREATE ORDER : ${lot_size_array[number_of_time_order_executed]} - ${bidType}`)

          number_of_time_order_executed++
          return { data: response.data, status: true };
        }

        return { message: "Order failed", status: false };
      } catch (error) {
        sendEmail(JSON.stringify(error.response?.data || error.message),`ERROR CREATE ORDER`)
        console.log('error.message___2_',JSON.stringify(error?.response?.data))
        total_error_count++
        project_error_message = JSON.stringify(error?.response?.data)
        orderInProgress = false; 
        //botRunning = false
        return { message: error?.message, status: false };
      } finally {
        orderInProgress = false;
      }
}

async function getCurrentPriceOfBitcoin() {
  try {
    const response = await axios.get(`${api_url}/v2/tickers?contract_type=perpetual_futures`);
    const btc_ticker_data = response.data.result.find(ticker => ticker.symbol === 'BTCUSD');

    return { data: btc_ticker_data, status: true };
  } catch (error) {
    return { message: error.message, status: false };
  }
}

async function init() { 
    await cancelAllOpenOrder()
    const result = await getCurrentPriceOfBitcoin() 
    if (!result.data.close) return
    const spot_price = Math.round(result.data.close)
    bitcoin_product_id = result.data.product_id
    
    border_buy_price = spot_price + buy_sell_point
    border_buy_profit_price = border_buy_price + buy_sell_profit_point

    border_price = spot_price

    border_sell_price = spot_price - buy_sell_point
    border_sell_profit_price = border_sell_price - buy_sell_profit_point

    order_exicuted_at_price = 0 
    total_error_count = 0  
    
    futureEmitter.emit('log', { type: "init", spot_price });
    console.log('==================BUY PROFIT BORDER==================',border_buy_profit_price)
    console.log('==================BUY BORDER==================',border_buy_price)
    console.log('==================CURRENT PRICE==================',spot_price)
    console.log('==================SELL BORDER==================',border_sell_price)
    console.log('==================SELL PROFIT BORDER==================',border_sell_profit_price)
}

async function triggerOrder(current_price,openPosition) {
  try{
    // Calculate current profit
    if (current_price > border_buy_price) {
      current_profit = ((current_price - border_buy_price) / 1000) * lot_size_array[number_of_time_order_executed];
    } else if (current_price < border_sell_price) {
      current_profit = ((border_sell_price - current_price) / 1000) * lot_size_array[number_of_time_order_executed];
    }

    // Emit updates
    futureEmitter.emit("update", {
      bitcoin_product_id:bitcoin_product_id,
      border_price:border_price,
      border_buy_price:border_buy_price,
      border_buy_profit_price:border_buy_profit_price,
      border_sell_price:border_sell_price,
      border_sell_profit_price:border_sell_profit_price,
      price: current_price,
      lot: lot_size_array[number_of_time_order_executed],
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
 
futureEmitter.on("stop", () => {
  botRunning = false; 
  futureEmitter.emit("log", { type: "warn", message: "Bot has been stopped." });
});

async function startFutureBot() { 
  init()
}

futureEmitter.on("restart", () => {
  resetBot();
});

module.exports = { startFutureBot, futureEmitter };