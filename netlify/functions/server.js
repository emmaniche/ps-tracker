// Netlify function wrapper — exposes the Express app under /.netlify/functions/server
const serverless = require("serverless-http");
const { app } = require("../../server.js");

exports.handler = serverless(app);
