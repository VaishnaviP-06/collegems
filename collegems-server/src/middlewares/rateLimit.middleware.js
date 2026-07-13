import rateLimit from "express-rate-limit";

// Login limiter (strict) - Now using environment variables
export const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_WINDOW_MS) || 15 * 60 * 1000, // 15 min default
  max: parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5,
  message: {
    success: false,
    message: process.env.LOGIN_RATE_LIMIT_MESSAGE || "Too many login attempts. Try again later.",
  },
  skipSuccessfulRequests: process.env.LOGIN_SKIP_SUCCESS === 'true',
});

// Register limiter (moderate) - Now using environment variables
export const registerLimiter = rateLimit({
  windowMs: parseInt(process.env.REGISTER_WINDOW_MS) || 60 * 60 * 1000, // 1 hour default
  max: parseInt(process.env.REGISTER_MAX_ATTEMPTS) || 10,
  message: {
    success: false,
    message: process.env.REGISTER_RATE_LIMIT_MESSAGE || "Too many registrations. Try again later.",
  },
});

// API limiter (default) - New with environment support
export const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_WINDOW_MS) || 60 * 1000, // 1 minute default
  max: parseInt(process.env.API_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: process.env.API_RATE_LIMIT_MESSAGE || "Too many API requests. Please slow down.",
  },
});

// Reset password limiter - New with environment support
export const resetPasswordLimiter = rateLimit({
  windowMs: parseInt(process.env.RESET_PASSWORD_WINDOW_MS) || 60 * 60 * 1000, // 1 hour default
  max: parseInt(process.env.RESET_PASSWORD_MAX_ATTEMPTS) || 3,
  message: {
    success: false,
    message: process.env.RESET_PASSWORD_MESSAGE || "Too many password reset attempts. Try again later.",
  },
});

// OTP limiter - New with environment support
export const otpLimiter = rateLimit({
  windowMs: parseInt(process.env.OTP_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes default
  max: parseInt(process.env.OTP_MAX_ATTEMPTS) || 3,
  message: {
    success: false,
    message: process.env.OTP_MESSAGE || "Too many OTP requests. Try again later.",
  },
});

// Export default for backward compatibility
export default {
  loginLimiter,
  registerLimiter,
  apiLimiter,
  resetPasswordLimiter,
  otpLimiter,
};