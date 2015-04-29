/* jshint node: true */
/* global -Promise */

'use strict';

var urlModule = require('url');

var cheerio = require('cheerio');
var request = require('request');
var pkg = require('./package.json');
var defaultUserAgent = pkg.name + '/' + pkg.version + (pkg.homepage ? ' (' + pkg.homepage + ')' : '');
var AWS, sqs;

request = request.defaults({
  pool: {maxSockets: Infinity},
  timeout: 8000,
  followRedirect: false,
});

var ogTypes = [
  'video',
  'music',
  'article',
  'book',
  'profile',
];

var sendAWSResponse = function (aws, result, callback) {
  if (!sqs) {
    AWS = require('aws-sdk');
    AWS.config.apiVersion = '2015-01-30';
    sqs = new AWS.SQS();
  }

  var params = {
    MessageBody: JSON.stringify(result),
    QueueUrl: aws,
  };

  sqs.sendMessage(params, function (err, data) {
    if (err) {
      console.log('Error sending result', err, err.stack);
    } else {
      console.log('Sent result for', result.result.url, '–', data);
    }
    callback();
  });
};

var createRequestHeaders = function (options) {
  return {
    'User-Agent' : ((options.userAgent || '') + ' ' + defaultUserAgent).trim(),
    'Accept' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
};

var isEmptyObject = function (obj) {
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      return false;
    }
  }
  return true;
};

var convertValue = function (typeTag, rootTag, property, value, baseUrl) {
  value = value ? value.trim() : '';

  if (value === '') {
    return '';
  }

  if (['url', 'secure_url', 'image', 'video', 'audio'].indexOf(property || rootTag) !== -1) {
    return urlModule.resolve(baseUrl, value);
  }

  if (['width', 'height'].indexOf(property) !== -1) {
    return parseInt(value, 10);
  }

  return value;
};

var normalizeOGData = function (og) {
  var setUrlAsValue = function (item) {
    if (!item.properties) {
      return item;
    }
    if (item.properties.url) {
      item.value = item.properties.url;
      delete item.properties.url;
    } else if (!item.value && item.properties.secure_url) {
      item.value = item.properties.secure_url;
      delete item.properties.secure_url;
    }
    if (isEmptyObject(item.properties)) {
      delete item.properties;
    }
    return item;
  };

  var normalize = function (data, key, method) {
    if (Array.isArray(data[key])) {
      data[key] = data[key].map(method).filter(function (row) {
        return row.value !== undefined && row.value !== '';
      });
    }
    return og;
  };

  og = normalize(og, 'image', setUrlAsValue);
  og = normalize(og, 'video', setUrlAsValue);
  og = normalize(og, 'audio', setUrlAsValue);

  for (var key in og) {
    if (og.hasOwnProperty(key) && isEmptyObject(og[key])) {
      delete og[key];
    }
  }

  return og;
};

var extract = function (url, html) {
  var $ = cheerio.load(html);
  var currentRootTag;
  var currentRootName;
  var ogType;
  var data = {
    metaProperties: {},
    links: {},
  };

  var extractOG = function (localData, elem) {
    var $elem = $(elem);
    var value = $elem.attr('content');
    var property = $elem.attr('property').split(':');
    var typeTag = property[0];
    var rootTag = property[1];
    var metaTag = property[2];

    if (!rootTag || metaTag === '') {
      return localData;
    }

    value = convertValue(typeTag, rootTag, metaTag, value, data.baseUrl);

    if (!metaTag || rootTag !== currentRootName) {
      currentRootName = rootTag;
      currentRootTag = {};
      localData[rootTag] = localData[rootTag] || [];
      localData[rootTag].push(currentRootTag);
    }

    if (metaTag) {
      if (currentRootTag && value !== '') {
        currentRootTag.properties = currentRootTag.properties || {};
        currentRootTag.properties[metaTag] = value;
      }
    } else if (value !== '') {
      currentRootTag.value = value;
    } else {
      localData[rootTag].pop();
      currentRootTag = false;
    }

    return localData;
  };

  try {
    data.baseUrl = $('base').attr('href');
  } catch (e) {
    console.log('Error parsing HTML', e, e.stack);
    return e;
  }

  data.baseUrl = data.baseUrl ? urlModule.resolve(url, data.baseUrl) : url;

  data.og = $('meta[property^="og:"]').get().reduce(extractOG, {});
  data.og = normalizeOGData(data.og);

  ogType = data.og.type ? data.og.type[0].value.split('.')[0] : false;
  if (ogType && ogTypes.indexOf(ogType) !== -1) {
    currentRootTag = false;
    data.ogType = data.og.type[0].value;
    data.ogTypeData = $('meta[property^="' + ogType + ':"]').get().reduce(extractOG, {});
  }

  $('meta[property^="fb:"]').each(function () {
    var $this = $(this);
    var value = $this.attr('content');
    var property = $this.attr('property');

    data.metaProperties[property] = data.metaProperties[property] || [];
    data.metaProperties[property].push(value);
  });

  $('meta[name^="twitter:"], meta[name="generator"]').each(function () {
    var $this = $(this);
    var value = $this.attr('content');
    var property = $this.attr('name');

    data.metaProperties[property] = data.metaProperties[property] || [];
    data.metaProperties[property].push(value);
  });

  $('head > link[rel]').each(function () {
    var attributes = ['hreflang', 'title', 'type'];

    var $this = $(this);
    var relations = $this.attr('rel').split(' ');
    var value = {};

    value.href = $this.attr('href');

    if (!value.href) {
      return;
    }

    value.href = urlModule.resolve(data.baseUrl, value.href);

    attributes.forEach(function (attributeName) {
      var attribute = $this.attr(attributeName);
      if (attribute) {
        value[attributeName] = attribute;
      }
    });

    relations.forEach(function (relation) {
      relation = relation.trim().toLowerCase();

      if (relation === '') {
        return;
      }

      data.links[relation] = data.links[relation]  || [];
      data.links[relation].push(value);
    });
  });

  return data;
};
var fetch = function (url, meta, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  } else {
    options = options || {};
  }

  request({
    url: url,
    headers: createRequestHeaders(options),
  }, function (err, res, body) {
    var result = {
      url: url,
      meta: meta,
    };

    if (!err && res.statusCode > 299) {
      if (res.statusCode < 400 && res.headers.location) {
        result.redirect = urlModule.resolve(url, res.headers.location);
      } else {
        err = new Error('Invalid response. Code ' + res.statusCode);
      }
    }
    if (!err && !result.redirect) {
      result.data = extract(url, body);
      if (result.data instanceof Error) {
        err = result.data;
        delete result.data;
      }
    }

    if (err) {
      return callback(err ? err.message : null, result);
    }

    callback(null, result);
  });
};
var fetchBatch = function (request, callback) {
  var aws;

  if (callback.done) {
    aws = request.aws;
  }

  var batch = request.batch;

  if (!request.batch || !Array.isArray(batch)) {
    throw new Error('Unknown input data');
  }

  var options = request.options;
  var remaining = batch.length;
  var batchResult = [];

  var handleCallback = function (err, result) {
    var next = function () {
      remaining -= 1;

      if (remaining < 1) {
        if (aws) {
          callback.done(null, 'Fetched ' + batch.length + ' items');
        } else {
          callback(batchResult);
        }
      }
    };

    result = {
      err: err,
      result: result,
    };

    if (aws) {
      sendAWSResponse(aws, result, next);
    } else {
      batchResult.push(result);
      next();
    }
  };

  batch.forEach(function (item) {
    if (item.url) {
      if (aws) {
        console.log('Fetching', item.url);
      }
      fetch(item.url, item.meta || {}, options, handleCallback);
    }
  });
};

module.exports = {
  extract: extract,
  fetch: fetch,
  fetchBatch: fetchBatch,
};
