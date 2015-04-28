/*jslint node: true */
'use strict';

var lintlovin = require('lintlovin');

module.exports = function (grunt) {
  lintlovin.initConfig(grunt, {}, {
    jsFiles: [
      'workers/**/*.js',
      '!workers/node_modules/**/*.js',
    ],
    spaceFiles: [
      '*.json',
      '!environment.config.json',
    ],
    integrationWatch : true,
  });
};
