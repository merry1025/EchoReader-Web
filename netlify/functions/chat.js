// netlify/functions/chat.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
  // 处理预检请求 (OPTIONS)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // 允许任何域名访问
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "OK",
    };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  try {
    const body = JSON.parse(event.body);
    const userText = body.text;

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(userText);
    const responseText = result.response.text();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // 必须加上这行
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reply: responseText }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "API 请求失败" }),
    };
  }
};