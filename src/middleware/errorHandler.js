// src/middleware/errorHandler.js
module.exports = (err, req, res, next) => {
  console.error(err);
  const status = err.response?.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
};