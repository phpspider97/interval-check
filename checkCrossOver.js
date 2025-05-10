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

function detectEmaCrossover(shortEma, longEma) {
    const last = shortEma.length - 1;
    const prev = shortEma.length - 2;

    const prevDiff = shortEma[prev] - longEma[prev];
    const currDiff = shortEma[last] - longEma[last];

    if (prevDiff < 0 && currDiff > 0) return 'bullish';
    if (prevDiff > 0 && currDiff < 0) return 'bearish';
    return null;
}

async function checkForCross() {
    const closes = await fetchCandles();
    if (closes.length < 21) {
        console.log('Not enough data to calculate EMAs.');
        return;
    }

    const shortEma = EMA.calculate({ period: 9, values: closes });
    const longEma = EMA.calculate({ period: 21, values: closes });

    const crossover = detectEmaCrossover(shortEma, longEma);
    if (crossover === 'bullish') {
        sendEmail('🚀 Bullish EMA crossover detected!','🚀 Bullish EMA crossover detected!')
        console.log('🚀 Bullish EMA crossover detected!');
    } else if (crossover === 'bearish') {
        sendEmail('🔻 Bearish EMA crossover detected!','🔻 Bearish EMA crossover detected!')
        console.log('🔻 Bearish EMA crossover detected!');
    } else {
        console.log('ℹ️  No crossover.');
    }
}

// Run every 5 second
setInterval(checkForCross, 5 * 1000)
checkForCross()

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