/**
 * This file is part of the Sharedown (https://github.com/kylon/Sharedown).
 * Copyright (c) 2021 Kylon.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
"use strict";

const { contextBridge, ipcRenderer, shell } = require('electron');
const isWindows = process.platform === 'win32';
const isLinux = process.platform === 'linux';
const isMacOS = process.platform === 'darwin';
const isMacOSArm = isMacOS && (process.arch === 'arm64');

// macOS PATH workaround
if (isMacOS)
    process.env.PATH = ['./node_modules/.bin', '/usr/local/bin', '/opt/homebrew/bin', process.env.PATH].join(':');

const SharedownAPI = (() => {
    const _isAppPackage = __dirname.toLowerCase().includes('app.asar');
    const _LoginModule = require('./sharedown/loginModules/loginModule');
    const _path = require('node:path');
    const _fs = require('node:fs');
    const _loginModule = new _LoginModule();
    const _sharedownAppDataPath = ipcRenderer.sendSync('sharedown-sync', {cmd: 'getAppDataPath'}) + '/Sharedown';
    const _sharedownStateFile = _path.normalize(_sharedownAppDataPath+'/sharedown.state');
    const _sharedownSettFile = _path.normalize(_sharedownAppDataPath+'/sharedown.sett');
    const _chromeUserdataPath = _path.normalize(_sharedownAppDataPath+'/data');
    const _logsFolderPath = _path.normalize(_sharedownAppDataPath+'/logs');
    const _logFilePath = _path.normalize(_logsFolderPath+'/sharedownLog.log');
    const _ytdlpLogFilePath = _path.normalize(_logsFolderPath+'/ytdlp.log');
    let _puppyBrowser = null;
    let _showDownlInfo = false;
    let _runningProcess = null;
    let _stoppingProcess = false;
    let _startCatchResponse = false;
    let _enableLogs = false;
    let _shLogFd = -1;
    let _ytdlpLogFd = -1;

    const api = {
        sharedownLoginModule: {
            getModuleList: _loginModule.getModuleList(),
            setModule: idx => _loginModule.setLoginModule(idx),
            getFields: () => _loginModule.getLoginModuleFields(),
            getFieldsCount: () => _loginModule.getLoginModuleFieldsCount()
        },
        hasFFmpeg: null,
        hasYTdlp: null,
        keytarSaveLogin: null,
        keytarGetLogin: null,
        keytarRemoveLogin: null,
        runPuppeteerGetVideoData: null,
        runPuppeteerGetURLListFromFolder: null,
        downloadWithFFmpeg: null,
        downloadWithYtdlp: null,
        stopDownload: null,
        makeOutputDirectory: null,
        getNormalizedUniqueOutputFilePath: null,
        getDefaultOutputFolder: null,
        showSelectFolderDialog: null,
        showSelectChromeBinDialog: null,
        copyURLToClipboard: null,
        saveAppSettings: null,
        loadAppSettings: null,
        saveAppState: null,
        loadAppState: null,
        upgradeSett: null,
        setShowDlInfo: null,
        isShowDlInfoSet: null,
        showMessage: null,
        enableLogs: null,
        disableLogs: null,
        writeLog: null,
        openLogsFolder: null,
        openFolder: null,
        deleteUserdataFold: null,
        genID: null,
        openLink: null,
        quitApp: null,
        flushAndCloseLogs: null,
        getWindowTitle: null
    };

    function _hideToken(token, str) {
        return str.replaceAll(token, '<hidden>');
    }

    function _tryRemoveUserDataFromRespDumpForLog(respData) {
        const rows = respData.ListData['Row'];
        let i = 0;

        for (const row of rows) {
            delete respData.ListData['Row'][i]['SharedWithUsers'];
            ++i;
        }

        for (const k of Object.keys(respData.ListSchema)) {
            if (k.includes('Token'))
                respData.ListSchema[k] = '<hidden>';
        }

        return JSON.stringify(respData);
    }

    function _removeUserDataFromCookiesForLog(cookiesData) {
        const ret = [];

        for (const c of cookiesData)
            ret.push(c.name);

        return JSON.stringify(ret);
    }

    function _waitForTimeout(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function _getChromeOSFolder(file) {
        if (isLinux)
            return file.startsWith('linux-');
        else if (isMacOS)
            return file.startsWith('mac-') || file.startsWith('mac_');
        else if (isWindows)
            return file.startsWith('win64-');
        else
            return false;
    }

    function _getChromeOSExeFolder(file) {
        if (isLinux)
            return file === 'chrome-linux64';
        else if (isMacOSArm)
            return file === 'chrome-mac-arm64';
        else if (isMacOS)
            return file === 'chrome-mac-x64';
        else if (isWindows)
            return file === 'chrome-win64';
        else
            return false;
    }

    function _getPuppeteerExecutablePath() {
        const basePath = process.cwd();
        let chromeDirPath = '/node_modules/puppeteer/chrome';
        let ret = '';

        if (_isAppPackage) {
            const pkgBasePath = isWindows ? basePath : (isMacOS ? __dirname : process.env.APPDIR);

            if (isMacOS)
                chromeDirPath = _path.join(`${pkgBasePath}.unpacked`, chromeDirPath);
            else
                chromeDirPath = _path.join(pkgBasePath, 'resources', 'app.asar.unpacked', chromeDirPath);

        } else {
            chromeDirPath = _path.join(basePath, chromeDirPath);
        }

        try {
            const chromeExe = isWindows ? 'chrome.exe' : (isMacOS ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' : 'chrome');
            const osFold = (_fs.readdirSync(chromeDirPath).filter(file => _getChromeOSFolder(file)))[0];
            const osExeFold = (_fs.readdirSync(_path.join(chromeDirPath, osFold)).filter(file => _getChromeOSExeFolder(file)))[0];

            ret = _path.join(chromeDirPath, osFold, osExeFold, chromeExe);

        } catch (e) {
            api.writeLog(`_getPuppeteerExecutablePath:\n${e.message}`);
        }

        return ret;
    }

    function _getPuppeteerArgs(customChromeExePath, userdataFold) {
        const pargs = {
            executablePath: (customChromeExePath === '' ? _getPuppeteerExecutablePath() : customChromeExePath),
            headless: false,
            args: ['--disable-dev-shm-usage']
        };

        if (pargs.executablePath === '')
            throw new Error('failed to find chromium executable');

        if (userdataFold) {
            const dataPath = _path.normalize(_sharedownAppDataPath + '/data');

            if (!_fs.existsSync(dataPath))
                _fs.mkdirSync(dataPath, {recursive: true});

            pargs['userDataDir'] = dataPath;
        }

        return pargs;
    }

    async function _waitForVideoPlayer(page) {
        const start = Date.now();
        const maxTime = 600000;
        let playerHandle = null;

        while (!playerHandle) {
            try {
                const isPuppyDead = _puppyBrowser === null || !_puppyBrowser.isConnected();

                if (isPuppyDead || (Date.now() - start) >= maxTime) {
                    api.writeLog(`_waitForVideoPlayer: stopped, dead: ${isPuppyDead}`);
                    return false;
                }

                await _waitForTimeout(650);

                playerHandle = await page.$('.StreamWebApp-container');

            } catch(e) {
                api.writeLog(`_waitForVideoPlayer: ignore:\n${e.message}`);
            }
        }

        await playerHandle.dispose();
        return true;
    }

    async function _sharepointLogin(page, logData, isFoldImport) {
        api.writeLog('_sharepointLogin: start login procedure');

        if (logData !== null) {
            api.writeLog('_sharepointLogin: has login data');

            if (logData.msid !== '') {
                api.writeLog('_sharepointLogin: has msid');
                await page.waitForSelector('input[type="email"]', {timeout: 8000});
                await page.keyboard.type(logData.msid);
                await page.click('input[type="submit"]');
            }

            if (logData.hasOwnProperty('custom')) {
                api.writeLog('_sharepointLogin: has auto-login');
                await _loginModule.doLogin(page, logData.custom);
            }
        }

        if (!isFoldImport) {
            const ret = await _waitForVideoPlayer(page);

            if (ret !== true)
                throw new Error('Unable to find video player element: browser disconnected or timed out');

            _startCatchResponse = true;

            await page.evaluate(() => { location.reload(true); }); // reload() is too slow because it waits for an event, lets do this way
        }
    }

    async function _getSpItmUrlFromApiRequest(page) {
        const urlObj = new URL(page.url());
        const pathNameAr = urlObj.pathname.split('/');
        const rootFoldParam = urlObj.searchParams.get('id');
        let resp = null;
        let apiUrl = '';
        let a1 = '';

        if (pathNameAr.length === 0) {
            api.writeLog(`_getSpItmUrlFromApiRequest: empty pathNameAr: ${urlObj.pathname}`);
            return '';

        } else if (pathNameAr.length < 6) {
            api.writeLog(`_getSpItmUrlFromApiRequest: pathName too short: ${urlObj.pathname}`);
            return '';
        }

        pathNameAr.pop();
        pathNameAr.pop();

        a1 = pathNameAr.join('/');
        apiUrl = `${urlObj.origin}/sites/${pathNameAr[2]}/_api/web/GetList(@a1)/RenderListDataAsStream?@a1='${a1}'&RootFolder=${rootFoldParam}`;

        api.writeLog(`_getSpItmUrlFromApiRequest: apiUrl: ${apiUrl}`);

        resp = await page.evaluate(async (url) => {
            return await fetch(url, {method:'post'}).then(res => res.json());
        }, apiUrl);

        api.writeLog("_getSpItmUrlFromApiRequest: fetch data:\n" + JSON.stringify(resp));

        return resp['CurrentFolderSpItemUrl'] ?? '';
    }

    function _getDataFromResponseListDataRow(rows, vID) {
        if (!rows || !rows.length) {
            api.writeLog('_getDataFromResponseListDataRow: No rows: ' + (rows?.length ?? null));
            return null;
        }

        for (const f of rows) {
            if (f['FileRef'] !== vID)
                continue;

            return f;
        }

        api.writeLog(`_getDataFromResponseListDataRow: No match for ${vID}`);
        return null;
    }

    async function _getDataFromResponse(donorRespData, puppyPage, vID) {
        const ret = {
            'mediaBaseUrl': donorRespData.ListSchema['.mediaBaseUrl'] ?? '',
            'fileType': 'mp4', // should be fine
            'callerStack': donorRespData.ListSchema['.callerStack'] ?? '',
            'spItmUrl': donorRespData.ListData['CurrentFolderSpItemUrl'] ?? '',
            'token': donorRespData.ListSchema['.driveAccessToken'] ?? '',
        };
        let altRow;

        if (ret.spItmUrl !== '')
            return ret;

        api.writeLog(`_getDataFromResponse: no spItmUrl\nvID: ${vID}`);

        altRow = _getDataFromResponseListDataRow(donorRespData.ListData['Row'], vID);
        if (altRow !== null) {
            ret.spItmUrl = altRow['.spItemUrl'] ?? '';

            if (ret.spItmUrl !== '')
                return ret;
        }

        api.writeLog(`_getDataFromResponse: no spItmUrl in altRow:\n${altRow}`);

        ret.spItmUrl = await _getSpItmUrlFromApiRequest(puppyPage);

        if (ret.spItmUrl === '')
            api.writeLog("_getDataFromResponse: no spItmUrl from api request");

        return ret;
    }

    function _getDataFromCookies(cookiesAr) {
        const ret = {rtfa: '', fedauth: ''};

        for (const c of cookiesAr) {
            switch (c.name) {
                case 'rtFa':
                    ret.rtfa = c.value;
                    break;
                case 'FedAuth':
                    ret.fedauth = c.value;
                    break;
                default:
                    break;
            }
        }

        api.writeLog('cookies: ' + _removeUserDataFromCookiesForLog(cookiesAr));
        return ret;
    }

    async function _makeVideoManifestFetchURL(donorRespData, puppyPage, vID) {
        const placeholders = [
            '{.mediaBaseUrl}', '{.fileType}', '{.callerStack}', '{.spItemUrl}', '{.driveAccessToken}',
        ];
        const placeholderData = Object.values(await _getDataFromResponse(donorRespData, puppyPage, vID));
        let manifestUrlSchema = donorRespData.ListSchema[".videoManifestUrl"];
        let hasErr = false;
        let urlObj;

        api.writeLog(`_makeVideoManifestFetchURL: manifest template: ${manifestUrlSchema}`);

        for (let i=0,l=placeholders.length; i<l; ++i) {
            if (placeholderData[i] === '') {
                api.writeLog(`_makeVideoManifestFetchURL: make url error: empty value ${placeholders[i]}`);
                hasErr = true;
            }

            if (!manifestUrlSchema.includes(placeholders[i])) {
                api.writeLog(`_makeVideoManifestFetchURL: make url error: cannot find ${placeholders[i]}`);
                hasErr = true;
            }

            manifestUrlSchema = manifestUrlSchema.replace(placeholders[i], placeholderData[i]);
        }

        urlObj = new URL(manifestUrlSchema);

        urlObj.searchParams.set('action', 'Access');
        urlObj.searchParams.set('part', 'Index');
        urlObj.searchParams.set('format', 'dash');
        urlObj.searchParams.set('useScf', 'True');
        urlObj.searchParams.set('pretranscode', '0');
        urlObj.searchParams.set('transcodeahead', '0');

        api.writeLog("_makeVideoManifestFetchURL:\nurl:" + _hideToken(donorRespData.ListSchema['.driveAccessToken'], urlObj.toString()) +
                    '\nresp dump:\n' + _tryRemoveUserDataFromRespDumpForLog(donorRespData));

        return {uobj: urlObj, err: hasErr};
    }

    function _makeDirectUrl(donorRespData, vID) {
        const listData = donorRespData.ListData;
        const webUrlAr = donorRespData['WebUrl'].split('/');
        let rootFolder = (new URLSearchParams(listData['FilterLink'] ?? '')).get('RootFolder');
        const ret = {link: '', err: false};

        if (rootFolder === null) {
            const rowData = _getDataFromResponseListDataRow(listData['Row'], vID);

            api.writeLog(`_makeDirectUrl: no filterlink in vID:\n${vID}`);

            if (rowData === null) {
                ret.err = true;
                return ret;
            }

            rootFolder = rowData['FileRef'] ?? '';
        }

        ret.link = `${webUrlAr[0]}//${webUrlAr[2]}${rootFolder}`; // https://xxxx...

        api.writeLog(`makeDirectUrl:\nrootfolder: ${rootFolder}\nwebUrl: ${webUrlAr}\nfinal: ${ret.link}`);
        return ret;
    }

    async function _getFullFolderUrl(page, url, match) {
        if (!url.split(`/${match}/`).at(1).includes('/')) { // short url?
            await page.goto(url);
            await page.waitForFunction(`window.location.href.includes('/${match}/')`);

            const pageUrl = page.url();

            if (pageUrl.includes('id=')) {
                const pUrl = new URL(pageUrl);
                const idData = pUrl.searchParams.get('id').split(`/${match}/`);

                return new URL(`${pUrl.origin}/:f:/r${idData[0]}/${match}/${idData[1]}?csf=1&web=1`);

            } else {
                api.writeLog(`_getFullFolderUrl: unable to get folder for ${pageUrl}`);
                return null;
            }
        }

        return new URL(url);
    }

    function _makeFolderApiURL(folderURL, itemType) {
        const urlObj = new URL(folderURL);
        const folderPath = urlObj.pathname;
        const apiURL = folderPath.replace(/\/:f:\/[a-z]\/([a-zA-Z0-9]+)\/([^\/]+)\/(.*)/, `/$1/$2/_api/web/GetFolderByServerRelativeUrl('$3')/${itemType}`);

        return `${urlObj.origin}${apiURL}`;
    }

    function _getFoldersListInFolder(pageContent) {
        const pre = new DOMParser().parseFromString(pageContent, 'text/html').body.getElementsByTagName('pre');
        const ret = [];
        let xmlDoc;

        if (pre.length === 0) {
            api.writeLog(`_getFoldersListInFolder: Unexpected API result:\n${pageContent}`);
            return [];
        }

        xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');

        for (const entry of xmlDoc.querySelectorAll('entry')) {
            const foldNameElm = entry.querySelector('content').getElementsByTagName('d:Name');

            if (foldNameElm.length === 0) {
                api.writeLog(`_getFoldersListInFolder: No name found for folder item:\n${entry.innerHTML}`);
                continue;
            }

            ret.push(foldNameElm[0].textContent);
        }

        return ret;
    }

    async function _getVideoURLsInFold(vURLsList, puppyPage, pageURL, includeSubFolds) {
        const urlOrigin = new URL(pageURL).origin;
        let pageCont;
        let xmlDoc;
        let pre;

        if (includeSubFolds) {
            await puppyPage.goto(_makeFolderApiURL(pageURL, 'Folders'), {waitUntil: 'domcontentloaded'});

            const folders = _getFoldersListInFolder(await puppyPage.content());

            for (const folder of folders)
                await _getVideoURLsInFold(vURLsList, puppyPage, `${pageURL}/${folder}`, includeSubFolds);
        }

        await puppyPage.goto(_makeFolderApiURL(pageURL, 'Files'), {waitUntil: 'domcontentloaded'});

        pageCont = await puppyPage.content();
        pre = new DOMParser().parseFromString(pageCont, 'text/html').body.getElementsByTagName('pre');

        if (pre.length === 0) {
            api.writeLog(`_getVideoURLsInFold: Unexpected API result:\n${pageCont}`);
            throw new Error('Unexpected API result');
        }

        xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');

        for (const entry of xmlDoc.querySelectorAll('entry')) {
            const entryContent = entry.querySelector('content');
            const relUrlElm = entryContent.getElementsByTagName('d:ServerRelativeUrl');
            const timeCreatedElm = entryContent.getElementsByTagName('d:TimeCreated');
            const timeLastModfElm = entryContent.getElementsByTagName('d:TimeLastModified');
            let relUrl;
            let fileExt;

            if (relUrlElm.length === 0) {
                api.writeLog(`_getVideoURLsInFold: No URL for this entry:\n${entry.innerHTML}`);
                continue;
            }

            relUrl = relUrlElm[0].textContent;
            fileExt = _path.extname(relUrl);

            if (fileExt !== '.mp4') {
                api.writeLog(`_getVideoURLsInFold: unhandled file format: ${fileExt}`);
                continue;
            }

            vURLsList.list.push({
                url: `${urlOrigin}${relUrl}`,
                created: timeCreatedElm.length === 0 ? 0 : new Date(timeCreatedElm[0].textContent).getTime(),
                lastModf: timeLastModfElm.length === 0 ? 0 : new Date(timeLastModfElm[0].textContent).getTime()
            });
        }
    }

    async function _getFileName(donorURLObj) {
        const docid = donorURLObj.searchParams.get('docid');
        const tok = donorURLObj.searchParams.get('access_token');
        const axios = require('axios');
        let resp;

        api.writeLog(`_getFileName:\ndocid: ${docid}\nurl: ` + _hideToken(tok, donorURLObj.toString()));

        resp = await axios.get(`${docid}&access_token=${tok}`);

        return resp.data.hasOwnProperty('name') ? resp.data['name'] : '';
    }

    async function _getVideoDuration(manifestFetchURL) {
        const iso8601Parse = require('iso8601-duration');
        const axios = require('axios');
        const parser = new DOMParser();
        const resp = await axios.get(manifestFetchURL);
        const manifest = parser.parseFromString(resp.data, 'text/xml');
        const rawDuration = manifest.getElementsByTagName('MPD')[0].getAttribute('mediaPresentationDuration');
        const duration = iso8601Parse.parse(rawDuration);

        return Math.ceil(iso8601Parse.toSeconds(duration));
    }

    function _setYTdlpProgressForManifest(rexMatch, videoProgBar) {
        const curPerc = videoProgBar.style.width;
        const curPercInt = curPerc ? parseInt(curPerc.substring(0, curPerc.length-1), 10) : 0;
        const perc = Math.floor(parseInt(rexMatch[1], 10) / 2);
        const fperc = perc < 0 ? 0 : perc;
        let ffperc = fperc;

        if (curPercInt >= 50) { // merge audio download progress to current progress
            const oldPerc = parseInt(videoProgBar.getAttribute('data-tmp-perc'), 10);

            ffperc = curPercInt;

            if (fperc < 50 && fperc > oldPerc) {
                ffperc = curPercInt + Math.abs(oldPerc-fperc);

                videoProgBar.setAttribute('data-tmp-perc', fperc.toString(10));
            }
        }

        if (ffperc > curPercInt)
            videoProgBar.style.width = ffperc > 100 ? '100%' : `${ffperc}%`;
    }

    function _setYTdlpProgressForDirect(rexMatch, videoProgBar) {
        const perc = Math.floor(parseInt(rexMatch[1], 10));

        videoProgBar.style.width = perc > 100 ? '100%' : `${perc}%`;
    }

    function _setYtdlpRateLimit(unit, value, args) {
        let v = parseInt(value, 10);

        if (v === 0 || isNaN(v))
            return;
        else if (unit === 'm')
            v *= 1024 * 1024;
        else if (unit === 'k')
            v *= 1024;

        args.push('-r', v);
    }

    function _saveYtdlpTempFragsFolder(tmpPath, filename) {
        try {
            if (!_fs.existsSync(tmpPath)) {
                api.writeLog('_saveYtdlpTempFragsFolder: no temp folder, skip..');
                return;
            }

            const fnameNoExt = _path.parse(filename).name;
            const savedTmpName = `${tmpPath}_${fnameNoExt}`;
            let savedTmpFName = savedTmpName;
            let i = 1;

            while (_fs.existsSync(savedTmpFName))
                savedTmpFName = `${savedTmpName}_${i++}`;

            _fs.renameSync(tmpPath, savedTmpFName);

        } catch (e) {
            api.writeLog(`_saveYtdlpTempFragsFolder: failed to rename yt-dlp temp folder:\n${e.message}`);
        }
    }

    function _writeSettingsToDisk(data, path, erMsg) {
        try {
            if (!_fs.existsSync(_sharedownAppDataPath))
                _fs.mkdirSync(_sharedownAppDataPath, {recursive: true});

            if (!_fs.existsSync(_sharedownAppDataPath))
                return false;

            _fs.writeFileSync(path, data, 'utf8');
            return true;

        } catch (e) { api.showMessage('error', `${erMsg}\n${e.message}`, 'I/O Error'); }

        return false;
    }

    function _loadSettingsFromDisk(path, erMsg) {
        try {
            if (!_fs.existsSync(path))
                return '';

            return _fs.readFileSync(path, 'utf8');

        } catch (e) { api.showMessage('error', `${erMsg}\n${e.message}`, 'I/O Error'); }

        return '';
    }

    function _rmSync(path, recur = true) {
        if (_fs.existsSync(path))
            _fs.rmSync(path, {recursive: recur, force: true});
    }

    function _unlinkSync(path) {
        if (_fs.existsSync(path))
            _fs.unlinkSync(path);
    }

    function _browserDisconnectedEvt() {
        _puppyBrowser?.close();
        _puppyBrowser = null;
    }

    function _sortURLsFromFolder(vURLsList, sortType) {
        const sorted = [];
        const ret = [];

        if (sortType !== 0) {
            for (const vObj of vURLsList) {
                let idx = 0;

                for (const sObj of sorted) {
                    if ((sortType === 1 && vObj.created < sObj.created) ||
                            (sortType === 2 && vObj.lastModf < sObj.lastModf) ||
                            (sortType === 3 && vObj.url.normalize() < sObj.url.normalize()))
                        break;

                    ++idx;
                }

                sorted.splice(idx, 0, vObj);
            }
        } else {
            sorted.splice(0, sorted.length, ...vURLsList);
        }

        for (const svObj of sorted)
            ret.push(svObj.url);

        return ret;
    }

    api.hasFFmpeg = () => {
        const proc = require('node:child_process');

        try {
            proc.execSync('ffmpeg -version');
            return true;

        } catch (e) {}

        return false;
    }

    api.hasYTdlp = () => {
        const proc = require('node:child_process');

        // old yt-dlp
        try {
            proc.execSync('yt-dlp -help', {stdio: 'ignore'});
            return true;

        } catch (e) {}

        try {
            proc.execSync('yt-dlp --help', {stdio: 'ignore'});
            return true;

        } catch (e) {}

        return false;
    }

    api.keytarSaveLogin = async (credentials) => {
        const kt = require('keytar');

        if (credentials.msid !== '') {
            await kt.setPassword('sharedown', 'msid', credentials.msid).catch(e => {
                api.showMessage('error', e.message, 'keytar error');
            });
        }

        if (credentials.lm !== '') {
            await kt.setPassword('sharedown', 'loginmodule', credentials.lm).catch(e => {
                api.showMessage('error', e.message, 'keytar error');
            });
        }
    }

    api.keytarGetLogin = async () => {
        const kt = require('keytar');
        const id = await kt.getPassword('sharedown', 'msid').catch(e => {
            api.showMessage('error', e.message, 'keytar error');
        });
        const loginMod = await kt.getPassword('sharedown', 'loginmodule').catch(e => {
            api.showMessage('error', e.message, 'keytar error');
        });

        return {
            msid: id,
            lm: loginMod?.split(':') ?? null
        }
    }

    api.keytarRemoveLogin = async () => {
        const kt = require('keytar');

        await kt.deletePassword('sharedown', 'msid');
        await kt.deletePassword('sharedown', 'loginmodule');
    }

    api.runPuppeteerGetVideoData = async (video, loginData, settings) => {
        const knownResponses = [
            'RenderListDataAsStream?@a1=', 'RenderListDataAsStream?@listUrl',
            'SP.List.GetListDataAsStream?listFullUrl'
        ];
        const puppy = require('puppeteer');
        const puppyTimeout = settings.timeout * 1000;
        const isDirect = settings.downloader === 'direct';
        let ret = null;

        _startCatchResponse = false;

        try {
            if (_puppyBrowser === null)
                _puppyBrowser = await puppy.launch(_getPuppeteerArgs(settings.customChromePath, settings.userdataFold));

            const responseList = [];
            const catchResponse = function(resp) {
                if (!_startCatchResponse)
                    return;

                const reqst = resp.request();
                const resType = reqst.resourceType();
                const method = reqst.method().toLowerCase();

                if ((resType === 'fetch' || resType === 'xhr') && (method === 'post' || method === 'get'))
                    responseList.push(resp);
            }
            const page = (await _puppyBrowser.pages())[0];
            let matchedResponse = null;
            let donorRespData = null;
            let videoUrl;
            let cookies;
            let title;
            let dlData;
            let vID;

            if (settings.keepBrowserOpen) {
                _puppyBrowser.off('disconnected', _browserDisconnectedEvt)
                _puppyBrowser.on('disconnected', _browserDisconnectedEvt);
            }

            if (settings.customChromePath)
                api.writeLog('WARNING: custom chrome executable, Sharedown may not work as expected!');

            page.setDefaultTimeout(puppyTimeout);
            page.setDefaultNavigationTimeout(puppyTimeout);
            page.on('response', catchResponse);

            api.writeLog(`runPuppeteerGetVideoData: goto ${video.url}`);

            await page.goto(video.url, {waitUntil: 'domcontentloaded'});
            await _sharepointLogin(page, loginData, false);
            await page.waitForNavigation({waitUntil: 'networkidle0'});
            page.off('response', catchResponse);

            for (const catchedResp of responseList) {
                const respUrl = catchedResp.url();

                donorRespData = null;

                for (const knownResp of knownResponses) {
                    if (!respUrl.includes(knownResp))
                        continue;

                    matchedResponse = knownResp;
                    break;
                }

                if (matchedResponse === null)
                    continue;

                try {
                    donorRespData = await catchedResp.json();
                    break;

                } catch(e) {
                    api.writeLog(`runPuppeteerGetVideoData: no json body on catched response: ${respUrl}\n${e.message}`);
                    matchedResponse = null;
                    continue;
                }
            }

            if (donorRespData === null)
                throw new Error("Unable to find a valid donor response!");

            vID = (new URL(page.url())).searchParams.get('id')?.trim();
            dlData = isDirect ? _makeDirectUrl(donorRespData, vID) : (await _makeVideoManifestFetchURL(donorRespData, page, vID));

            if (dlData.err)
                throw new Error(`no video data found in ${matchedResponse}`);

            if (isDirect) {
                const linkAr = dlData.link.split('/');

                videoUrl = dlData.link;
                title = '';

                api.writeLog('runPuppeteerGetVideoData: direct mode: linkAr:\n' + JSON.stringify(linkAr));

                if (linkAr.length > 0) {
                    cookies = _getDataFromCookies(await page.cookies());
                    title = linkAr[linkAr.length - 1];
                }
            } else {
                const manifestURLObj = dlData.uobj;

                title = await _getFileName(manifestURLObj);
                videoUrl = manifestURLObj.toString();
                cookies = null;
            }

            if (!settings.keepBrowserOpen) {
                await _puppyBrowser.close();
                _puppyBrowser = null;
            }

            ret = {m: videoUrl, t: title, c: cookies};

        } catch (e) {
            if (!settings.keepBrowserOpen && _puppyBrowser) {
                await _puppyBrowser.close();
                _puppyBrowser = null;
            }

            api.writeLog(`runPuppeteerGetVideoData: error\n${e.message}`);
            api.showMessage('error', e.message, 'Puppeteer Error');
        }

        return ret;
    }

    api.runPuppeteerGetURLListFromFolder = async (folderURLsList, includeSubFolds, sortType, loginData, settings) => {
        const puppy = require('puppeteer');
        const puppyTimeout = settings.timeout * 1000;

        try {
            if (_puppyBrowser === null)
                _puppyBrowser = await puppy.launch(_getPuppeteerArgs('', settings.userdataFold));

            const page = (await _puppyBrowser.pages())[0];
            const regex = new RegExp(/\/:f:\/[a-z]\/([a-zA-Z0-9\_\-\.]+)\/([^\/]+)/);
            const match = folderURLsList.at(0)?.match(regex) ?? null;
            const ret = {list: []};

            if (match === null || match.length < 2) {
                api.writeLog(`runPuppeteerGetURLListFromFolder: no wait match for:\n${folderURLsList[0]}`);
                throw new Error(`Unknown folder URL`);

            } else {
                api.writeLog(`runPuppeteerGetURLListFromFolder: matched: ${match}\nwill wait for match: ${match[1]}`);
            }

            if (settings.keepBrowserOpen) {
                _puppyBrowser.off('disconnected', _browserDisconnectedEvt);
                _puppyBrowser.on('disconnected', _browserDisconnectedEvt);
            }

            api.writeLog("runPuppeteerGetURLListFromFolder: start");
            page.setDefaultTimeout(puppyTimeout);
            page.setDefaultNavigationTimeout(puppyTimeout);

            await page.goto(folderURLsList[0], {waitUntil: 'domcontentloaded'});
            await _sharepointLogin(page, loginData, true);
            await page.waitForFunction(`window.location.href.includes('/${match[1]}/')`);

            for (const folderURL of folderURLsList) {
                const umatch = folderURL.match(regex);
                let urlObj;

                if (umatch === null || umatch.length < 2) {
                    api.writeLog(`runPuppeteerGetURLListFromFolder: no match for folder url, skip:\n${folderURL}`);
                    continue;
                }

                urlObj = await _getFullFolderUrl(page, folderURL, umatch[1]);

                if (urlObj === null) {
                    api.writeLog(`runPuppeteerGetURLListFromFolder: unknown folder url format, skip:\n${folderURL}`);
                    continue;
                }

                await _getVideoURLsInFold(ret, page, `${urlObj.origin}${urlObj.pathname}`, includeSubFolds);
            }

            if (!settings.keepBrowserOpen) {
                await _puppyBrowser.close();
                _puppyBrowser = null;
            }

            return _sortURLsFromFolder(ret.list, sortType);

        } catch (e) {
            if (!settings.keepBrowserOpen && _puppyBrowser) {
                await _puppyBrowser.close();
                _puppyBrowser = null;
            }

            api.writeLog(`runPuppeteerGetURLListFromFolder: error\n${e.message}`);
            api.showMessage('error', e.message, 'Puppeteer Error');
            return null;
        }
    }

    api.downloadWithFFmpeg = async (videoData, video, outFile) => {
        try {
            const { FFmpegCommand, FFmpegInput, FFmpegOutput } = require('fessonia')();
            const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
            const videoProgBarTx = videoProgBar.parentNode.querySelector('.progtext');
            const ffmpegInput = new FFmpegInput(videoData.m);
            const ffmpegOutput = new FFmpegOutput(outFile, new Map([
                ['c:v', 'copy'],
                ['c:a', 'copy'],
                ['crf', '26']
            ]));
            const ffmpegCmd = new FFmpegCommand();
            const totalTime = await _getVideoDuration(videoData.m);

            ffmpegCmd.addInput(ffmpegInput);
            ffmpegCmd.addOutput(ffmpegOutput);

            _stoppingProcess = false;

            ffmpegCmd.on('update', (data) => {
                if (_stoppingProcess)
                    return;

                const sec = Math.floor(data.out_time_ms / 1000);
                const prog = Math.floor((sec / totalTime) * 100).toString(10);

                videoProgBar.style.width = prog >= 100 ? '100%' : `${prog}%`;

                if (_showDownlInfo) {
                    const dlInfo = `frame: ${data.frame}, speed: ${data.speed}, bitrate: ${data.bitrate}, estimated time: ${sec}`;

                    videoProgBarTx.textContent = dlInfo;
                }
            });

            ffmpegCmd.on('success', (data) => {
                let evt;

                if (data.exitCode === 0) {
                    evt = new CustomEvent('DownloadSuccess');
                } else {
                    evt = new CustomEvent('DownloadFail', {detail: `Exit code: ${data.exitCode}`});

                    api.writeLog(`FFMPEG: download filed: exit code ${data.exitCode}`);
                }

                window.dispatchEvent(evt);
            });

            ffmpegCmd.on('error', (err) => {
                try {
                    _unlinkSync(outFile);

                } catch (e) {
                    api.writeLog(`ffmpegCmd.on(error):\n${e.message}`);
                    api.showMessage('error', e.message, 'FFmpeg');
                }

                if (!err.message.includes('Exiting normally, received signal 15')) {
                    const failEvt = new CustomEvent('DownloadFail', { detail: err });

                    api.writeLog("ffmpegCmd.on(error):\n" + err.log);
                    window.dispatchEvent(failEvt);
                }
            });

            _runningProcess = ffmpegCmd.spawn();
            return true;

        } catch (e) {
            api.writeLog(`FFmpeg: error\n${e.message}`);
            api.showMessage('error', e.message, 'FFmpeg');
        }

        return false;
    }

    api.downloadWithYtdlp = (videoData, video, outFile, settings) => {
        const { spawn } = require('node:child_process');

        try {
            const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
            const videoProgBarTx = videoProgBar.parentNode.querySelector('.progtext');
            const args = ['--no-part'];
            const isDirect = videoData.c !== null;
            let tmpFold = null;
            let tmpOutFile = null;
            let filename = null;

            if (!isDirect) {
                const outFPath = _path.parse(outFile);
                const outFolder = settings.ytdlpTmpOut === '' ? outFPath.dir : settings.ytdlpTmpOut;

                filename = outFPath.base;
                tmpFold = _path.normalize(_path.join(outFolder, 'sharedownTmp'));
                tmpOutFile = _path.normalize(_path.join(tmpFold, filename));

                _rmSync(tmpFold);
                _fs.mkdirSync(tmpFold);
                args.push('-N', settings.ytdlpN.toString(), '-o', tmpOutFile, '-v', videoData.m);

            } else {
                const cookieH = `Cookie: FedAuth=${videoData.c.fedauth}; rtFa=${videoData.c.rtfa}`;
                const vurl = (new URL(videoData.m)).toString();

                args.push('-N', settings.directN.toString(), '--add-header', cookieH, '-o', outFile, vurl);
            }

            _setYtdlpRateLimit(settings.ytdlpRateLimitU, settings.ytdlpRateLimit, args);
            videoProgBar.setAttribute('data-tmp-perc', '0');
            _stoppingProcess = false;

            const ytdlp = spawn('yt-dlp', args);

            ytdlp.stdout.on('data', (data) => {
                if (_stoppingProcess)
                    return;

                api.writeLog(data.toString(), 'ytdlp');

                const regex = new RegExp(/\s(\d+.\d+)%\s.*/);
                const out = data.toString();
                const isProgress = out.includes('[download]');
                const match = out.match(regex);

                if (!isProgress || match === null || match.length < 2)
                    return;

                if (isDirect)
                    _setYTdlpProgressForDirect(match, videoProgBar);
                else
                    _setYTdlpProgressForManifest(match, videoProgBar);

                if (_showDownlInfo)
                    videoProgBarTx.textContent = match[0];
            });

            ytdlp.stderr.on('data', (data) => {
                api.writeLog(data.toString(), 'ytdlp');
            });

            ytdlp.on('close', (code) => {
                const isAborted = _stoppingProcess || code === null;

                try {
                    if (code !== 0) {
                        videoProgBar.style.width = '0%';
                        throw new Error("Exit code: " + (isAborted ? "aborted" : code));
                    }

                    if (!isDirect) {
                        const files = _fs.readdirSync(tmpFold);
                        let found = false;

                        for (const f of files) {
                            if (!f.includes(filename))
                                continue;

                            _fs.copyFileSync(tmpOutFile, outFile);
                            found = true;
                            break;
                        }

                        if (!found)
                            throw new Error(`Cannot find video file in output folder!\n\nSrc:\n${tmpOutFile}\n\nDest:\n${outFile}`);
                    }

                    window.dispatchEvent(new CustomEvent('DownloadSuccess'));

                } catch (e) {
                    if (isDirect)
                        _unlinkSync(outFile);
                    else if (!isAborted && settings.keepYtdlpTmpOnFail)
                        _saveYtdlpTempFragsFolder(tmpFold, filename);

                    api.writeLog(`YT-dlp: download failed:\n${e.message}`);

                    if (!isAborted) {
                        const failEvt = new CustomEvent('DownloadFail', {detail: `YT-dlp error:\n\n${e.message}`});

                        window.dispatchEvent(failEvt);
                    }
                } finally {
                    _rmSync(tmpFold);
                }
            });

            _runningProcess = ytdlp;
            return true;

        } catch (e) {
            api.showMessage('error', e.message, 'YT-dlp');
        }

        return false;
    }

    api.stopDownload = () => {
        if (_runningProcess === null)
            return;

        try {
            _stoppingProcess = true;

            if (isWindows) {
                const { spawn } = require('node:child_process');

                spawn('taskkill', ['/pid', _runningProcess.pid, '/f', '/t']);

            } else if (!_runningProcess.kill()) {
                throw new Error('Failed to send kill signal to download process');
            }

            _runningProcess = null;

        } catch (e) {
            api.writeLog(`stopDownload: error\n${e.message}`);
            api.showMessage('error', e.message, 'Stop download error');
        }
    }

    api.makeOutputDirectory = outFold => {
        try {
            outFold = _path.normalize(outFold);

            if (!_fs.existsSync(outFold))
                _fs.mkdirSync(outFold, {recursive: true});

            return _fs.existsSync(outFold);

        } catch (e) { api.showMessage('error', e.message, 'Output directory I/O Error'); }

        return false;
    }

    api.getNormalizedUniqueOutputFilePath = (outFolder, fileName) => {
        let p = _path.normalize(_path.join(outFolder, fileName));
        const name = p.substring(0, p.length - 4);
        let i = 1;

        while (_fs.existsSync(p))
            p = name + " " + (i++) + '.mp4';

        return _path.extname(p) !== '.mp4' ? p.substring(0, p.length - 3) + 'mp4' : p;
    }

    api.getDefaultOutputFolder = () => {
        const downloadsPath = ipcRenderer.sendSync('sharedown-sync', { cmd: 'getDownloadsPath' });

        return _path.normalize(_path.join(downloadsPath, 'sharedownVideos'));
    }

    api.showSelectFolderDialog = () => {
        return ipcRenderer.sendSync('sharedown-sync', {cmd: 'selectFoldDialog'});
    }

    api.showSelectChromeBinDialog = () => {
        return ipcRenderer.sendSync('sharedown-sync', {cmd: 'selectChromeBinDialog'});
    }

    api.copyURLToClipboard = (url) => {
        const clipboardy = require('clipboardy');

        clipboardy.writeSync(url);
    }

    api.saveAppSettings = data => {
        return _writeSettingsToDisk(data, _sharedownSettFile, "Unable to save Sharedown settings");
    }

    api.loadAppSettings = () => {
        return _loadSettingsFromDisk(_sharedownSettFile, "Unable to load Sharedown settings");
    }

    api.upgradeForSettingsUpgrade = (version) => {
        if (version < 4) {
            const _ologFilePath = _path.normalize(_sharedownAppDataPath+'/sharedownLog.log');
            const oldF = _ologFilePath+'.old';

            _unlinkSync(oldF);

            if (_fs.existsSync(_logFilePath))
                _unlinkSync(_ologFilePath);
        }
    }

    api.setShowDlInfo = state => {
        _showDownlInfo = state;
    }

    api.isShowDlInfoSet = () => {
        return _showDownlInfo;
    }

    api.saveAppState = data => {
        return _writeSettingsToDisk(data, _sharedownStateFile, "Unable to save Sharedown state");
    }

    api.loadAppState = () => {
        return _loadSettingsFromDisk(_sharedownStateFile, "Unable to load Sharedown state");
    }

    api.openFolder = (fold) => {
        shell.openPath(fold).then(res => {
            if (res !== '')
                api.showMessage('error', res);
        });
    }

    api.openLogsFolder = () => {
        api.openFolder(_logsFolderPath);
    }

    api.deleteUserdataFold = () => {
        _rmSync(_chromeUserdataPath);
    }

    api.genID = () => {
        const crypto = require('node:crypto');

        return crypto.randomBytes(5).toString("hex");
    }

    api.openLink = async l => {
        await shell.openExternal(l);
    }

    api.quitApp = () => {
        ipcRenderer.sendSync('sharedown-sync', {cmd: 'quit'});
    }

    api.getWindowTitle = () => {
        try {
            const titleStr = require('./version.js');

            return titleStr;

        } catch (e) {
            return `${process.env.npm_package_name} ${process.env.npm_package_version}`;
        }
    }

    api.showMessage = (dtype, msg, dtitle) => ipcRenderer.sendSync('showMessage', {type: dtype, m: msg, title: dtitle});

    api.enableLogs = () => {
        if (_enableLogs)
            return true;

        try {
            if (!_fs.existsSync(_logsFolderPath))
                _fs.mkdirSync(_logsFolderPath, {recursive: true});

            for (const logf of [_logFilePath, _ytdlpLogFilePath]) {
                const old = `${logf}.old`;

                _unlinkSync(old);

                if (_fs.existsSync(logf))
                    _fs.renameSync(logf, old);
            }

            _shLogFd = _fs.openSync(_logFilePath, 'a');
            _ytdlpLogFd = _fs.openSync(_ytdlpLogFilePath, 'a');

            _enableLogs = true;

        } catch (e) {
            api.showMessage('error', `Failed to enable logging\n${e.message}`, 'Sharedown Error');
        }

        return _enableLogs;
    }

    api.disableLogs = () => {
        if (!_enableLogs)
            return false;

        try {
            _fs.closeSync(_shLogFd);
            _fs.closeSync(_ytdlpLogFd);

            _enableLogs = false;

        } catch (e) {
            api.showMessage('error', `Failed to disable logging\n${e.message}`, 'Sharedown Error');
        }

        return _enableLogs;
    }

    api.writeLog = (msg, type='shd') => {
        if (!_enableLogs)
            return;

        let logFd;

        switch (type) {
            case 'ytdlp':
                logFd = _ytdlpLogFd;
                break;
            default:
                logFd = _shLogFd;
                break;
        }

        _fs.writeFile(logFd, '\n'+msg+'\n', (err) => {
            if (err)
                console.log(`writeLog: ${err.message}`);
        });
    }

    api.flushAndCloseLogs = () => {
        if (!_enableLogs)
            return;

        try {
            _fs.fsyncSync(_shLogFd);
            _fs.fsyncSync(_ytdlpLogFd);
            api.disableLogs();

        } catch (e) {
            console.log(`failed to flushAndCloseLogs, ${e?.message}`);
        }
    }

    Object.freeze(api);
    return api;
})();

ipcRenderer.on('appmenu', async (e, args) => {
    switch (args.cmd) {
        case 'about':
            ipcRenderer.send('sharedown-async', {cmd: 'showabout'});
            break;
        case 'aexit':
            SharedownAPI.quitApp();
            break;
        default:
            window.dispatchEvent(new CustomEvent('appmenu', {detail: args}));
            break;
    }
});

contextBridge.exposeInMainWorld('sharedown', SharedownAPI);
