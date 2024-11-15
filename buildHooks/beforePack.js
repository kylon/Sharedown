function getPuppyPlatform(electronPlat, arch) {
    const {BrowserPlatform} = require('@puppeteer/browsers');
    const {Arch} = require('builder-util');

    if (electronPlat === 'darwin' && arch === Arch.arm64)
        return BrowserPlatform.MAC_ARM;
    else if (electronPlat === 'darwin')
        return BrowserPlatform.MAC;
    else if (electronPlat === 'win32' && arch === Arch.x64)
        return BrowserPlatform.WIN64;
    else if (electronPlat === 'linux')
        return BrowserPlatform.LINUX;
    else
        throw new Error(`BeforePack hook: unknown platform: ${electronPlat}:${arch}`);
}

exports.default = async function(context) {
    const {install, Browser, resolveBuildId, makeProgressCallback} = require('@puppeteer/browsers');
    const {PUPPETEER_REVISIONS} = require('puppeteer-core/internal/revisions.js');
    const {join} = require('node:path');
    const fs = require('node:fs');

    try {
        const puppyPath = join(__dirname, '..', 'node_modules', 'puppeteer');
        const platf = getPuppyPlatform(context.electronPlatformName, context.arch);

        fs.rmSync(join(puppyPath, 'chrome'), {force: true, recursive: true});
        fs.rmSync(join(puppyPath, 'chrome-headless-shell'), {force: true, recursive: true});

        for (const _browser of [Browser.CHROME, Browser.CHROMEHEADLESSSHELL]) {
            const _buildId = await resolveBuildId(_browser, platf, (PUPPETEER_REVISIONS[_browser] || 'latest'));
            const res = await install({
                browser: _browser,
                buildId: _buildId,
                cacheDir: puppyPath,
                downloadProgressCallback: makeProgressCallback(_browser, _buildId),
                platform: platf,
                unpack: true
            });

            console.log(`${_browser} (${res.buildId}) downloaded to ${res.path}`);
        }

        fs.writeFileSync('version.js', `const title = "${context.packager.appInfo.productName} ${context.packager.appInfo.version}"; module.exports = title;`);

    } catch (err) {
        console.error('BeforePack hook: failed, ' + err);
    }
}
