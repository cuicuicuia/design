const dotenv = require('dotenv');

dotenv.config();

const config = {
  pg: {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '123456',
    database: process.env.PG_DB || 'hotrank',
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    db: Number(process.env.REDIS_DB || 0),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  email: {
    host: process.env.EMAIL_HOST || '',
    port: Number(process.env.EMAIL_PORT || 465),
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
  },
  ai: {
    openaiUrl:
      process.env.OPENAI_API_URL ||
      'https://api.openai.com/v1/chat/completions',
    openaiKey: process.env.OPENAI_API_KEY || '',
    geminiUrl:
      process.env.GEMINI_API_URL ||
      'https://generativelanguage.googleapis.com/v1beta/models/',
    geminiKey: process.env.GEMINI_API_KEY || '',
    // 阿里云百炼（千问/通义）兼容 OpenAI 接口，仅需调整 base_url 与 API Key
    // 华北2(北京): https://dashscope.aliyuncs.com/compatible-mode/v1
    // 新加坡: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    // 美国弗吉尼亚: https://dashscope-us.aliyuncs.com/compatible-mode/v1
    qwenBaseUrl:
      process.env.QWEN_BASE_URL ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    qwenKey: process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || 'sk-be040123cced4b84bbf0a6ebe66a5065',
    pricingJson: process.env.AI_PRICING_JSON || '',
  },
  server: {
    port: Number(process.env.PORT || 8000),
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
};

module.exports = { config };

