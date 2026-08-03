'use strict';

const path = require('node:path');

module.exports = {
  joinExample(...parts) {
    return path.posix.join(...parts);
  },
};
