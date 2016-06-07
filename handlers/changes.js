var _ = require('underscore'),
    auth = require('../auth'),
    config = require('../config'),
    serverUtils = require('../server-utils'),
    db = require('../db'),
    ALL_KEY = [ '_all' ], // key in the doc_by_place view for records everyone can access
    UNASSIGNED_KEY = [ '_unassigned' ]; // key in the doc_by_place view for unassigned records

var getViewKeys = function(req, userCtx, callback) {
  auth.getFacilityId(req, userCtx, function(err, facilityId) {
    if (err) {
      return callback(err);
    }
    var keys = [ ALL_KEY ];
    if (facilityId) {
      keys.push([ facilityId ]);
    }
    if (config.get('district_admins_access_unallocated_messages') &&
        auth.hasAllPermissions(userCtx, 'can_view_unallocated_data_records')) {
      keys.push(UNASSIGNED_KEY);
    }
    callback(null, keys);
  });
};

var getUsersDocIds = function(req, userCtx, callback) {
  getViewKeys(req, userCtx, function(err, keys) {
    if (err) {
      return callback(err);
    }
    db.medic.view('medic', 'doc_by_place', { keys: keys }, function(err, viewResult) {
      if (err) {
        return callback(err);
      }
      var ids = _.pluck(viewResult.rows, 'id');
      ids.push('resources');
      ids.push('org.couchdb.user:' + userCtx.name);
      callback(null, ids);
    });
  });
};

var getChanges = function(req, ids, callback) {
  var params = _.pick(req.query, 'timeout', 'style', 'heartbeat', 'since', 'feed', 'limit', 'filter');
  // we cannot call 'changes' because our query string might be too long for get
  db.request({
    db: db.settings.db,
    path: '_changes',
    qs: params,
    body: { doc_ids: ids },
    method: 'POST'
  }, callback);
};

var prepareResponse = function(req, res, changes, verifiedIds) {
  var allowed = _.every(changes.results, function(change) {
    return change.deleted || _.contains(verifiedIds, change.id);
  });
  if (!allowed) {
    return serverUtils.error({ code: 403, message: 'Forbidden' }, req, res);
  }
  res.json(changes);
};

var getRequestIds = function(req, callback) {
  if (req.body && req.body.doc_ids) {
    // POST request
    return callback(null, req.body.doc_ids);
  }
  if (req.query && req.query.doc_ids) {
    // GET request
    try {
      return callback(null, JSON.parse(req.query.doc_ids));
    } catch(e) {
      return callback({ code: 400, message: 'Invalid doc_ids param' });
    }
  }
  return callback(null, []);
};

module.exports = function(proxy, req, res) {
  auth.getUserCtx(req, function(err, userCtx) {
    if (err) {
      return serverUtils.error(err, req, res);
    }
    if (auth.hasAllPermissions(userCtx, 'can_access_directly') ||
        (req.query.filter === '_doc_ids' && req.query.doc_ids === '["_design/medic"]')) {
      proxy.web(req, res);
    } else {
      getUsersDocIds(req, userCtx, function(err, viewIds) {
        if (err) {
          return serverUtils.error(err, req, res);
        }
        getRequestIds(req, function(err, requestIds) {
          if (err) {
            return serverUtils.error(err, req, res);
          }
          var ids = _.union(requestIds, viewIds);
          getChanges(req, ids, function(err, changes) {
            if (err) {
              return serverUtils.error(err, req, res);
            }
            prepareResponse(req, res, changes, viewIds);
          });
        });
      });
    }
  });
};