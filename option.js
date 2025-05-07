const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const EventEmitter = require('events');
const emitter = new EventEmitter();

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.USER_EMAIL,
      pass: process.env.USER_PASSWORD
    },
  }); 

let bitcoin_product_id;
//let current_lot = [1, 3, 7, 18]
let current_lot = [3, 7, 18, 45]
let current_profit = 0;
let total_profit = 0;
let border_price;
let number_of_time_order_executed = 0;
let bitcoin_current_price = 0

let border_buy_price;
let border_buy_profit_price;

let border_sell_price;
let border_sell_profit_price;
   
let botRunning = true;
let buy_sell_profit_point = 300
let buy_sell_point = 200
let CANCEL_GAP = 200
let PROFIT_GAP = 0
let lot_size_increase = 2
let total_error_count = 0

let order_exicuted_at_price = 0
let project_error_message = ""
let current_balance = 0
let orderInProgress = false  
let isBracketOrderExist = false  
let current_running_order = ''   

const api_url = process.env.API_URL 
const socket_url = process.env.API_URL_SOCKET 
const key = process.env.WEB_KEY
const secret = process.env.WEB_SECRET 

function resetBot() {
  //current_lot = 20;
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
    const message = JSON.parse(data)
    if (message.type === 'success' && message.message === 'Authenticated') {
      subscribe(ws, 'orders', ['all']);
      subscribe(ws, 'v2/ticker', ['BTCUSD']);
      //subscribe(ws, 'positions', ['all']);
    } else {
        
        if(total_error_count>1){
            console.log('total_error_count___',total_error_count)
        }
        
        if(total_error_count>5) { 
            ws.close(1000, 'Too many errors');
        } 
 
        if(message?.bracket_order == null && message?.meta_data?.pnl != undefined){
          console.log(`============= ORDER TRIGGERED ============= `)
          //current_running_order = message.side
        } 
 
        if(message.type == "v2/ticker"){
            if(current_running_order == 'sell' && message?.spot_price<border_sell_price-20){
                console.log('sell_data____',message?.spot_price,'<',border_sell_price)
                current_running_order = 'buy'
                bitcoin_current_price = message?.spot_price
                number_of_time_order_executed++
                await cancelAllOpenOrder('LOSS',message?.spot_price)
                const result = await getCurrentPriceOfBitcoin('call');
                if (!result.status) return;
                await createOrder(result.data.option_data.product_id,result.data.option_data.symbol)
            }
            if(current_running_order == 'buy' && message?.spot_price>border_buy_price+20){
                console.log('buy_data____',message?.spot_price,'>',border_buy_price)
                current_running_order = 'sell'
                bitcoin_current_price = message?.spot_price
                number_of_time_order_executed++
                await cancelAllOpenOrder('LOSS',message?.spot_price)
                const result = await getCurrentPriceOfBitcoin('put');
                if (!result.status) return;
                await createOrder(result.data.option_data.product_id,result.data.option_data.symbol)
            }
              
            if (message?.spot_price > border_buy_profit_price+PROFIT_GAP || message?.spot_price < border_sell_profit_price-PROFIT_GAP) {  
                console.log('profit_data____',border_sell_profit_price,'<',message?.spot_price,'>',border_buy_profit_price)
                bitcoin_current_price = message?.spot_price
                console.log('cancel_order_on_profit___')
                await cancelAllOpenOrder('PROFIT',message?.spot_price)
               await resetLoop()
            }
            //console.log('spot_price___',Math.round(message.spot_price))
            await triggerOrder(message?.spot_price)
        } 
    }
  } 
  async function onError(error) {
    await cancelAllOpenOrder('ERROR',0)
    console.error('Socket Error:', error.message);
  }
  async function resetLoop(){ 
    number_of_time_order_executed = 0
    await init()
  }
  async function onClose(code, reason) {
    console.log(`Socket closed with code: ${code}, reason: ${reason}`)
    
    if(code == 1000){
      console.log('cancle all order')
      await cancelAllOpenOrder('ERROR',1)

      setTimeout(() => { // connect again after 1 minute
        total_error_count = 0
        console.log('Reconnecting after long time...')
        wsConnect();
        resetLoop()
      }, 60000);

    }else{
      total_error_count = 0
      setTimeout(() => {
        console.log('Reconnecting...')
        wsConnect();
      }, reconnectInterval);
    }
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

async function cancelAllOpenOrder(loss_profit,current_price) {
  try {
    sendEmail('',`CANCEL OPTION ORDER AT ${loss_profit} : ${current_price} RANGE : ${border_buy_profit_price} ${border_sell_profit_price}`)
    //current_running_order = ''
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
 
function sendEmail(message,subject){
    let mailOptions = {
        from: 'phpspider97@gmail.com',
        to: 'neelbhardwaj97@gmail.com',
        subject: subject,
        text: JSON.stringify(message)
    };
    
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return console.log('Error:', error);
        }
        console.log('Email sent:', info.response);
    });
}

async function createOrder(product_id,bitcoin_option_symbol) {
    if(total_error_count>5){ 
        return true
    }
     
    if (orderInProgress) return { message: "Order already in progress", status: false };
    orderInProgress = true
    if(number_of_time_order_executed>4){
      number_of_time_order_executed = 0
    }
  try {
   // bidType = (bidType == 'buy')?'sell':'buy'
    const timestamp = Math.floor(Date.now() / 1000);
    const bodyParams = {
      product_id: product_id, 
      product_symbol: bitcoin_option_symbol, 
      size: current_lot[number_of_time_order_executed],
      side: 'sell', 
      order_type: "market_order"
    };
    console.log('order_bodyParams___', current_lot,number_of_time_order_executed, bodyParams)
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
      //number_of_time_order_executed++; 
      sendEmail(bodyParams,`CREATE OPTION ORDER AT ${bitcoin_current_price} RANGE : ${border_buy_profit_price} ${border_sell_profit_price}`)
      return { data: response.data, status: true };
    }

    return { message: "Order failed", status: false };
  } catch (error) {
    console.log('Create order time error : ',error.response?.data || error.message)
    total_error_count++
    project_error_message = JSON.stringify(error?.response?.data)
    orderInProgress = false;
    //await triggerLimitOrderOnBothSide(bitcoin_current_price)
    //botRunning = false
    return { message: error?.message, status: false };
  } finally {
    orderInProgress = false;
  }
}
 

function getAdjustedDate() {
  // Create a Date object with the current time in IST
  const now = new Date();

  // Convert current time to IST by adding the IST offset (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // IST offset in milliseconds
  const istTime = new Date(now.getTime() + istOffset);

  // Check if the current IST time is after 5:30 PM
  if (istTime.getHours() > 17 || (istTime.getHours() === 17 && istTime.getMinutes() >= 30)) {
    // If after 5:30 PM, add one day
    istTime.setDate(istTime.getDate() + 1);
  }

  // Format the date as DD-MM-YYYY
  const day = String(istTime.getDate()).padStart(2, '0');
  const month = String(istTime.getMonth() + 1).padStart(2, '0'); // Months are zero-based
  const year = istTime.getFullYear();

  return `${day}-${month}-${year}`;
}

async function getCurrentPriceOfBitcoin(data_type) {
    try {
      const expiry_date = getAdjustedDate() 
      const response = await axios.get(`${api_url}/v2/tickers/?underlying_asset_symbols=BTC&contract_types=call_options,put_options&states=live&expiry_date=${expiry_date}`);
      const allProducts = response.data.result;
    
      const spot_price = Math.round(allProducts[0].spot_price / 200) * 200
      bitcoin_current_price = Math.round(allProducts[0].spot_price);
      let option_data = []
      if(data_type == 'call'){
            current_running_order = 'buy'
            option_data = allProducts.filter(product =>
                product.contract_type == 'call_options' && product.strike_price == border_buy_price
            );
      }else if(data_type == 'put'){
            current_running_order = 'sell'
            option_data = allProducts.filter(product =>
                product.contract_type == 'put_options' && product.strike_price == border_sell_price
            );
      }else if(data_type == 'current'){
            current_running_order = 'sell'
            option_data = allProducts.filter(product =>
                product.contract_type == 'put_options' && product.strike_price == spot_price-CANCEL_GAP
            );
            console.log('BTC Options:',allProducts[0].spot_price,spot_price,spot_price-CANCEL_GAP);
      }
    
      const bitcoin_option_data = {
          option_data:option_data[0],
          border_buy_price:spot_price,
          border_sell_price:spot_price-CANCEL_GAP
      }
      console.log('bitcoin_buy_sell_price___',spot_price,spot_price-CANCEL_GAP)
      return { data: bitcoin_option_data, status: true };
    } catch (error) {
      console.log('error___',error)
      return { message: error.message, status: false };
    }
  }
  
  async function init() {
    await cancelAllOpenOrder('START',0)
    const result = await getCurrentPriceOfBitcoin('current')
    if (!result.status) return
   
    //bitcoin_current_price = Math.round(result.data.spot_price);
    //bitcoin_product_id = result.data.result.product_id;
    //border_price = markPrice;
  
    border_buy_price = result.data.border_buy_price;
    border_buy_profit_price = bitcoin_current_price + buy_sell_profit_point;
  
    border_sell_price = result.data.border_sell_price;
    border_sell_profit_price = border_sell_price - buy_sell_profit_point;

    //console.log('border_buy_profit_price____',bitcoin_current_price,border_buy_profit_price,border_sell_profit_price)
  
    order_exicuted_at_price = 0 
    total_error_count = 0 
    isBracketOrderExist = false
      
    await createOrder(result.data.option_data.product_id,result.data.option_data.symbol)
   // emitter.emit('log', { type: "init", markPrice });
  }

async function triggerOrder(current_price,openPosition) {
  try{
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
 
emitter.on("stop", () => {
  botRunning = false; 
  emitter.emit("log", { type: "warn", message: "Bot has been stopped." });
});

async function startBot() {
  //setInterval(getBitcoinPriceLoop, 1000);
  init()
}

emitter.on("restart", () => {
  resetBot();
});

module.exports = { startBot, emitter };