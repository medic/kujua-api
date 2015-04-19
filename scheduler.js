var _ = require('underscore'),
    CronJob = require('cron').CronJob,
    usageStats = require('./schedules/usage-stats'),
    statsSubmission = require('./schedules/stats-submission');

var wrapAsync = function(fn, name) {
  return function() {
    fn(function(err) {
      if (err) {
        return console.error('Cron job \'' + name + '\' failed:', err);
      }
      console.log('Cron job \'' + name + '\' completed successfully');
    });
  };
};

module.exports = {
  init: function() {

    // collect usage stats at 3am each day
    new CronJob('0 0 3 * * *', wrapAsync(usageStats.go, 'usageStats')).start();

    // submit usage stats at 4am each day
    new CronJob('0 0 4 * * *', wrapAsync(statsSubmission.go, 'statsSubmission')).start();

  }
};