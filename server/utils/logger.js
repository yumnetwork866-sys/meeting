const formatErrorMessage = (error) => {
  if (!error) {
    return 'Unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  return error.message || String(error);
};

const logError = (scope, error) => {
  console.error(`[${scope}] ${formatErrorMessage(error)}`);
};

const logDebug = (scope, message) => {
  if (process.env.LOG_LEVEL === 'debug') {
    console.log(`[${scope}] ${message}`);
  }
};

module.exports = {
  logDebug,
  logError,
};
