const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { startBot, emitter } = require("./index");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static HTML
app.use(express.static(path.join(__dirname, "public")));

// Emit updates via socket
emitter.on("update", (data) => {
  io.emit("update", data);
  const now = Date.now();
  if (!lastConsoleUpdate || now - lastConsoleUpdate > 1000) {
    console.clear();
    console.log("📈 Bitcoin Trading Bot - Live Stats");
    console.table({
      "Current Price": data.price,
      "Lot Size": data.lot,
      "Current Profit": data.profit,
      "Total Profit": data.totalProfit,
      "Orders Executed": data.ordersExecuted,
    });
    lastConsoleUpdate = now;
  }
});

emitter.on("log", (data) => {
  io.emit("log", data);
});

io.on("connection", (socket) => {
  console.log("🟢 Client connected");
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
  startBot();
});
