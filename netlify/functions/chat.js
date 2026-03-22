// netlify/functions/chat.js
const { GoogleGenerativeAI } = require("@google/generativeai");

exports.handler = async function(event, context) {
  // 这里可以安全地读取环境变量，因为这段代码运行在 Netlify 的服务器上，而不是用户的浏览器里
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  try {
    // 解析前端传过来的文本
    const body = JSON.parse(event.body);
    const userText = body.text;

    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
    const result = await model.generateContent(userText);
    const responseText = result.response.text();

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: responseText }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API 请求失败" }),
    };
  }
};