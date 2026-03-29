// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 初始化 Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 1. 提供 AI 分析的 API 接口
app.post('/api/chat', async (req, res) => {
  try {
    const userText = req.body.text;
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(userText);
    
    res.json({ reply: result.response.text() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "API 请求失败" });
  }
});

// 2. 托管前端打包后的静态文件 (Vite 默认输出到 dist 目录)
app.use(express.static(path.join(__dirname, 'dist')));

// 3. 捕捉所有其他路由，返回 index.html (支持 React Router 单页应用)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`EchoReader 服务器已启动，运行在端口: ${PORT}`);
});