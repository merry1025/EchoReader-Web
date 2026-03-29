const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
  // 1. 处理跨域预检请求
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "OK",
    };
  }

  // 2. 检查环境变量是否真的读取到了
  if (!process.env.GEMINI_API_KEY) {
    console.error("严重错误：环境变量 GEMINI_API_KEY 为空！");
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: "后端未检测到 Gemini API Key" }),
    };
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  try {
    // 3. 尝试解析前端发来的数据
    const body = JSON.parse(event.body);
    const userText = body.text;

    if (!userText) {
      throw new Error("前端发送的文本为空");
    }

    // 4. 调用大模型
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });
    const result = await model.generateContent(userText);
    const responseText = result.response.text();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ reply: responseText }),
    };

  } catch (error) {
    // 💡 关键修改：强制在 Netlify 后台打印真实错误！
    console.error("🔥🔥🔥 后端执行崩溃，详细原因：", error);
    
    return {
      statusCode: 500,
      headers: { 
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      // 💡 关键修改：把真实的错误信息发回给前端浏览器显示！
      body: JSON.stringify({ error: `详细报错: ${error.message}` }),
    };
  }
};