exports.default = function () {
    const fs = require('fs');

    try {
        fs.unlinkSync('version.js');

    } catch (err) {
        console.error('Build: failed to delete version.js, ' + err);
    }
}
  