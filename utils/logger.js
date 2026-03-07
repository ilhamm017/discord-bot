const winston = require("winston");
const path = require("path");

const logDir = path.resolve(process.cwd(), "logs");

// Format kustom untuk log console yang lebih rapi
const safeStringify = (obj) => {
  const cache = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) return "[Circular]";
      cache.add(value);
    }
    return value;
  }, 2);
};

// Format kustom untuk log console yang lebih rapi
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = "";
    if (Object.keys(meta).length > 0) {
      // Jika meta adalah error, tampilkan stack trace
      const error = meta instanceof Error ? meta : (meta.error instanceof Error ? meta.error : null);
      if (error) {
        metaStr = `\n${error.stack}`;
      } else if (meta.stack) {
        metaStr = `\n${meta.stack}`;
      } else {
        try {
          metaStr = `\n${safeStringify(meta)}`;
        } catch (e) {
          metaStr = `\n[Serialization Error: ${e.message}]`;
        }
      }
    }
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// Format JSON untuk file log agar mudah diparsing mesin jika perlu
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug",
  format: fileFormat,
  transports: [
    // Simpan semua log level error ke error.log
    new winston.transports.File({
      dirname: logDir,
      filename: "error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Simpan semua log (info ke atas) ke combined.log
    new winston.transports.File({
      dirname: logDir,
      filename: "combined.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

const shouldLogToConsole =
  process.env.LOG_TO_STDOUT === "1" ||
  process.env.LOG_TO_STDOUT === "true" ||
  process.env.NODE_ENV !== "production";

// Di Docker production kita tetap bisa paksa log ke stdout lewat LOG_TO_STDOUT.
if (shouldLogToConsole) {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

module.exports = logger;
