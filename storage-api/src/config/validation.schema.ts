import * as Joi from 'joi';

/**
 * Validate biến môi trường lúc khởi động (mục 3). Thiếu biến bắt buộc -> app
 * fail fast ngay thay vì lỗi mơ hồ lúc chạy. Các biến AI/HF là optional vì
 * fallback/nhánh phụ có thể chưa cấu hình ở giai đoạn đầu.
 */
export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  WEB_ORIGIN: Joi.string().default('http://localhost:4200'),

  DATABASE_URL: Joi.string().required(),
  DIRECT_URL: Joi.string().optional().allow(''),

  SUPABASE_JWT_SECRET: Joi.string().required(),
  SUPABASE_URL: Joi.string().uri().optional().allow(''),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().optional().allow(''),

  R2_ACCOUNT_ID: Joi.string().required(),
  R2_BUCKET: Joi.string().required(),
  R2_REGION: Joi.string().default('auto'),
  R2_ENDPOINT: Joi.string().optional().allow(''),
  R2_ACCESS_KEY_ID: Joi.string().required(),
  R2_SECRET_ACCESS_KEY: Joi.string().required(),
  R2_PUBLIC_BASE_URL: Joi.string().optional().allow(''),

  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  MAX_FILE_SIZE_MB: Joi.number().default(2048),
  CHUNK_SIZE_MB: Joi.number().default(8),
  RATE_LIMIT: Joi.string().valid('on', 'off').default('off'),

  TRASH_RETENTION_DAYS: Joi.number().default(30),
  SHARE_CONTENT_TTL_SECONDS: Joi.number().default(600),
  SHARE_BASE_URL: Joi.string().optional().allow(''),
  SHARE_SESSION_SECRET: Joi.string().optional().allow(''),

  GEMINI_API_KEY: Joi.string().optional().allow(''),
  GEMINI_EMBEDDING_MODEL: Joi.string().default('gemini-embedding-001'),
  GEMINI_OCR_MODEL: Joi.string().default('gemini-3.5-flash'),
  BAZAARLINK_API_KEY: Joi.string().optional().allow(''),
  BAZAARLINK_BASE_URL: Joi.string().optional().allow(''),
  BAZAARLINK_EMBEDDING_MODEL: Joi.string().default('openai/text-embedding-3-small'),

  HF_API_KEY: Joi.string().optional().allow(''),
  HF_BASE_URL: Joi.string().default('https://router.huggingface.co'),
  HF_BGE_MODEL: Joi.string().default('BAAI/bge-m3'),
  HF_RERANKER_MODEL: Joi.string().default('BAAI/bge-reranker-v2-m3'),
  HF_ENABLE_SIGLIP: Joi.string().valid('true', 'false').default('false'),
});
