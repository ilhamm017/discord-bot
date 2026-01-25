const fs = require("fs");
const path = require("path");
const util = require("util");

const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const levelNames = Object.keys(levels);
const isNodemon = Boolean(process.env.NODEMON || process.env.nodemon);
const logDir = path.resolve(process.cwd(), "logs");

let currentLevel = levels.info;
let logToFile = !isNodemon;
let logDirReady = false;

function setLevel(level) {
  if (!level) return;
  const key = String(level).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(levels, key)) {
    currentLevel = levels[key];
  }
}

function setLogToFile(value) {
  if (typeof value === "boolean") {
    logToFile = value;
  }
}

function configure(options = {}) {
  if (options.level) setLevel(options.level);
  if (typeof options.logToFile === "boolean") {
    logToFile = options.logToFile;
  }
}

function shouldLog(level) {
  return levels[level] >= currentLevel;
}

function ensureLogDir() {
  if (logDirReady) return;
  fs.mkdirSync(logDir, { recursive: true });
  logDirReady = true;
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function formatMeta(meta) {
  if (meta === undefined || meta === null) return "";
  if (meta instanceof Error) {
    return ` | ${meta.stack || meta.message}`;
  }
  if (typeof meta === "object") {
    return ` | ${util.inspect(meta, { depth: 4, breakLength: 160 })}`;
  }
  return ` | ${String(meta)}`;
}

function formatLine(level, message, meta) {
  const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
  const msg = message instanceof Error ? message.message : String(message);
  return `[${ts}] [${level.toUpperCase()}] ${msg}${formatMeta(meta)}`;
}

function writeLine(level, line) {
  const output = `${line}\n`;
  if (level === "error") {
    process.stderr.write(output);
  } else {
    process.stdout.write(output);
  }

  if (!logToFile) return;
  try {
    ensureLogDir();
    const filePath = path.join(logDir, `bot-${getDateStamp()}.log`);
    fs.appendFile(filePath, output, (err) => {
      if (err) {
        process.stderr.write(
          `[logger] Failed to write log file: ${err.message}\n`
        );
      }
    });
  } catch (error) {
    process.stderr.write(
      `[logger] Failed to initialize log directory: ${error.message}\n`
    );
  }
}

function log(level, message, meta) {
  if (!Object.prototype.hasOwnProperty.call(levels, level)) return;
  if (!shouldLog(level)) return;
  writeLine(level, formatLine(level, message, meta));
}

function debug(message, meta) {
  log("debug", message, meta);
}

function info(message, meta) {
  log("info", message, meta);
}

function warn(message, meta) {
  log("warn", message, meta);
}

function error(message, meta) {
  log("error", message, meta);
}

if (process.env.LOG_LEVEL) {
  setLevel(process.env.LOG_LEVEL);
}

if (process.env.LOG_TO_FILE !== undefined) {
  setLogToFile(
    ["1", "true", "yes", "on"].includes(
      String(process.env.LOG_TO_FILE).toLowerCase()
    )
  );
}

module.exports = {
  configure,
  debug,
  error,
  info,
  setLevel,
  setLogToFile,
  warn,
};
