const _ = require('lodash');
const util = require('util');
const Redis = require('ioredis');
const tough = require('tough-cookie');

const Store = tough.Store;
const Cookie = tough.Cookie;
const permutePath = tough.permutePath;
const permuteDomain = tough.permuteDomain;

let redisClient = null;

class CookieStore extends Store {
  constructor(id = 'default', opts) {
    super();

    this.idx = {};
    this.id = id;
    this.synchronous = true;

    if (redisClient === null) {
      redisClient = new Redis(opts);
    }

    this.loadFromRepository(this.id, dataJson => {
      if (dataJson) this.idx = dataJson;
    });
  }

  getKeyName() {
    return this.id;
  }

  findCookie(domain, path, key, cb) {
    return redisClient.get(this.id, (err, data) => {
      if (err) return cb(err);

      const parsed = JSON.parse(data);
      const value = tough.fromJSON(_.get(parsed, [domain, path, key], null));
      return cb(err, value);
    });
  }

  findCookies(domain, path, cb) {
    var results = [];
    if (!domain) {
      return cb(null, []);
    }
    var pathMatcher;
    if (!path) {
      pathMatcher = function matchAll(domainIndex) {
        for (var curPath in domainIndex) {
          var pathIndex = domainIndex[curPath];
          for (var key in pathIndex) {
            results.push(pathIndex[key]);
          }
        }
      };
    } else if (path === '/') {
      pathMatcher = function matchSlash(domainIndex) {
        var pathIndex = domainIndex['/'];
        if (!pathIndex) {
          return;
        }
        for (var key in pathIndex) {
          results.push(pathIndex[key]);
        }
      };
    } else {
      var paths = permutePath(path) || [path];
      pathMatcher = function matchRFC(domainIndex) {
        paths.forEach(function(curPath) {
          var pathIndex = domainIndex[curPath];
          if (!pathIndex) {
            return;
          }
          for (var key in pathIndex) {
            results.push(pathIndex[key]);
          }
        });
      };
    }
    var domains = permuteDomain(domain) || [domain];
    var idx = this.idx;
    domains.forEach(function(curDomain) {
      var domainIndex = idx[curDomain];
      if (!domainIndex) {
        return;
      }
      pathMatcher(domainIndex);
    });
    cb(null, results);
  }

  putCookie(cookie, cb) {
    if (!this.idx[cookie.domain]) {
      this.idx[cookie.domain] = {};
    }
    if (!this.idx[cookie.domain][cookie.path]) {
      this.idx[cookie.domain][cookie.path] = {};
    }

    this.idx[cookie.domain][cookie.path][cookie.key] = cookie;

    this.saveToRepository(this.id, this.idx, () => {
      cb(null);
    });
  }

  removeCookie(domain, path, key, cb) {
    if (this.idx[domain] && this.idx[domain][path] && this.idx[domain][path][key]) {
      delete this.idx[domain][path][key];
    }
    this.saveToRepository(this.id, this.idx, function() {
      cb(null);
    });
  }

  saveToRepository(id, data, cb) {
    var dataJson = JSON.stringify(data);
    redisClient.set(id, dataJson);
    cb();
  }

  loadFromRepository(id, cb) {
    redisClient.get(id, function(err, data) {
      if (err) throw err;
      var dataJson = data ? JSON.parse(data) : null;
      for (var domainName in dataJson) {
        for (var pathName in dataJson[domainName]) {
          for (var cookieName in dataJson[domainName][pathName]) {
            dataJson[domainName][pathName][cookieName] = tough.fromJSON(
              JSON.stringify(dataJson[domainName][pathName][cookieName])
            );
          }
        }
      }
      cb(dataJson);
    });
  }

  updateCookie(oldCookie, newCookie, cb) {
    this.putCookie(newCookie, cb);
  }

  getAllCookies(domain, path, cb) {
    this.findCookies(domain, path, function(err, cookies) {
      if (err) return cb(err);

      cookies.sort(function(a, b) {
        return (a.creationIndex || 0) - (b.creationIndex || 0);
      });

      cb(null, cookies);
    });
  }
}

module.exports = CookieStore;
