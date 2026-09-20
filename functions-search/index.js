const { getApps, initializeApp } = require('firebase-admin/app');
if (!getApps().length) initializeApp();
exports.searchDatePlaces = require('./localSearch').searchDatePlaces;
