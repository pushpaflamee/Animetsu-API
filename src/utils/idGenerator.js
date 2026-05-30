// src/utils/idGenerator.js
const { ObjectId } = require('mongodb');
exports.generate = () => new ObjectId().toHexString();