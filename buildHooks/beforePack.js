exports.default = async function(context) {
    const fs = require('fs');

    try {
        fs.writeFileSync('version.js', `const title = "${context.packager.appInfo.productName} ${context.packager.appInfo.version}"; module.exports = title;`);

    } catch (err) {
        console.error('Build: failed to write version.js, ' + err);
    }
}
  