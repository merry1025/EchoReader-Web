const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async function(event, context) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  try {
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