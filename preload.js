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

// macOS PATH workaround
if (process.platform === 'darwin')
    process.env.PATH = ['./node_modules/.bin', '/usr/local/bin', '/opt/homebrew/bin', process.env.PATH].join(':');

const SharedownAPI = (() => {
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
        copyURLToClipboard: null,
        saveAppSettings: null,
        loadAppSettings: null,
        saveAppState: null,
        loadAppState: null,
        upgradeSett: null,
        setShowDlInfo: null,
        isShowDlInfoSet: null,
        showMessage: null,
        setLogging: null,
        openLogsFolder: null,
        openFolder: null,
        deleteUserdataFold: null,
        genID: null,
        openLink: null,
        quitApp: null,
    };

    function _initLogFile() {
        if (!_enableLogs)
            return;

        const logsP = [_logFilePath, _ytdlpLogFilePath];

        if (!_fs.existsSync(_logsFolderPath))
            _fs.mkdirSync(_logsFolderPath);

        _shLogFd = -1;
        _ytdlpLogFd = -1;

        for (const logf of logsP) {
            const old = `${logf}.old`;

            _unlinkSync(old);

            if (_fs.existsSync(logf))
                _fs.renameSync(logf, old);
        }
    }

    function _writeLog(msg, type='shd') {
        if (!_enableLogs)
            return;

        let logFd;

        switch (type) {
            case 'ytdlp':
                if (_ytdlpLogFd === -1)
                    _ytdlpLogFd = _fs.openSync(_ytdlpLogFilePath, 'a');

                logFd = _ytdlpLogFd;
                break;
            default:
                if (_shLogFd === -1)
                    _shLogFd = _fs.openSync(_logFilePath, 'a');

                logFd = _shLogFd;
                break;
        }

        _fs.writeFile(logFd, '\n'+msg+'\n', (err) => {
            if (err)
                console.log(`_writeLog: ${err.message}`);
        });
    }

    function _closeShLogFD() {
        if (!_enableLogs || _shLogFd === -1)
            return;

        _fs.fsyncSync(_shLogFd);
        _fs.closeSync(_shLogFd);
    }

    function _closeYtDlpLogFD() {
        if (!_enableLogs || _ytdlpLogFd === -1)
            return;

        _fs.fsyncSync(_ytdlpLogFd);
        _fs.closeSync(_ytdlpLogFd);
    }

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

    function _getPuppeteerExecutablePath(curExecPath) {
        if (curExecPath.toLowerCase().includes('resources'))
            return curExecPath.replace('app.asar', 'app.asar.unpacked');

        return curExecPath;
    }

    function _getPuppeteerArgs(puppyExePath, userdataFold) {
        const pargs = {
            executablePath: _getPuppeteerExecutablePath(puppyExePath),
            headless: false,
            args: ['--disable-dev-shm-usage']
        };

        if (userdataFold) {
            const dataPath = _path.normalize(_sharedownAppDataPath + '/data');

            if (!_fs.existsSync(dataPath))
                _fs.mkdirSync(dataPath);

            pargs['userDataDir'] = dataPath;
        }

        return pargs;
    }

    async function _sharepointLogin(page, logData) {
        if (logData !== null) {
            if (logData.msid !== '') {
                await page.waitForSelector('input[type="email"]', {timeout: 8000});
                await page.keyboard.type(logData.msid);
                await page.click('input[type="submit"]');
            }

            if (logData.hasOwnProperty('custom'))
                await _loginModule.doLogin(page, logData.custom);
        }

        await page.waitForSelector('video.vjs-tech', {timeout: 600000});

        _startCatchResponse = true;

        await page.evaluate(() => { location.reload(true); }); // reload() is too slow because it waits for an event, lets do this way
    }

    async function _getSpItmUrlFromApiRequest(page) {
        const urlObj = new URL(page.url());
        const pathNameAr = urlObj.pathname.split('/');
        const rootFoldParam = urlObj.searchParams.get('id');
        let resp = null;
        let apiUrl = '';
        let a1 = '';

        if (pathNameAr.length === 0) {
            _writeLog(`_getSpItmUrlFromApiRequest: empty pathNameAr: ${urlObj.pathname}`);
            return '';

        } else if (pathNameAr.length < 6) {
            _writeLog(`_getSpItmUrlFromApiRequest: pathName too short: ${urlObj.pathname}`);
            return '';
        }

        pathNameAr.pop();
        pathNameAr.pop();

        a1 = pathNameAr.join('/');
        apiUrl = `${urlObj.origin}/sites/${pathNameAr[2]}/_api/web/GetList(@a1)/RenderListDataAsStream?@a1='${a1}'&RootFolder=${rootFoldParam}`;

        _writeLog(`_getSpItmUrlFromApiRequest: apiUrl: ${apiUrl}`);

        resp = await page.evaluate(async (url) => {
            return await fetch(url, {method:'post'}).then(res => res.json());
        }, apiUrl);

        _writeLog("_getSpItmUrlFromApiRequest: fetch data:\n" + JSON.stringify(resp));

        return resp['CurrentFolderSpItemUrl'] ?? '';
    }

    function _getDataFromResponseListDataRow(rows, vID) {
        if (!rows || !rows.length) {
            _writeLog('_getDataFromResponseListDataRow: No rows: ' + (rows?.length ?? null));
            return null;
        }

        for (const f of rows) {
            if (f['FileRef'] !== vID)
                continue;

            return f;
        }

        _writeLog(`_getDataFromResponseListDataRow: No match for ${vID}`);
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

        _writeLog(`_getDataFromResponse: no spItmUrl\nvID: ${vID}`);

        altRow = _getDataFromResponseListDataRow(donorRespData.ListData['Row'], vID);
        if (altRow !== null) {
            ret.spItmUrl = altRow['.spItemUrl'] ?? '';

            if (ret.spItmUrl !== '')
                return ret;
        }

        _writeLog(`_getDataFromResponse: no spItmUrl in altRow:\n${altRow}`);

        ret.spItmUrl = await _getSpItmUrlFromApiRequest(puppyPage);

        if (ret.spItmUrl === '')
            _writeLog("_getDataFromResponse: no spItmUrl from api request");

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

        _writeLog('cookies: ' + _removeUserDataFromCookiesForLog(cookiesAr));
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

        _writeLog(`_makeVideoManifestFetchURL: manifest template: ${manifestUrlSchema}`);

        for (let i=0,l=placeholders.length; i<l; ++i) {
            if (placeholderData[i] === '') {
                _writeLog(`_makeVideoManifestFetchURL: make url error: empty value ${placeholders[i]}`);
                hasErr = true;
            }

            if (!manifestUrlSchema.includes(placeholders[i])) {
                _writeLog(`_makeVideoManifestFetchURL: make url error: cannot find ${placeholders[i]}`);
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

        _writeLog("_makeVideoManifestFetchURL:\nurl:"+_hideToken(donorRespData.ListSchema['.driveAccessToken'], urlObj.toString()) +
            '\n\nresp dump:\n'+_tryRemoveUserDataFromRespDumpForLog(donorRespData));

        return {uobj: urlObj, err: hasErr};
    }

    function _makeDirectUrl(donorRespData, vID) {
        const listData = donorRespData.ListData;
        const webUrlAr = donorRespData['WebUrl'].split('/');
        let rootFolder = (new URLSearchParams(listData['FilterLink'] ?? '')).get('RootFolder');
        const ret = {link: '', err: false};

        if (rootFolder === null) {
            const rowData = _getDataFromResponseListDataRow(listData['Row'], vID);

            _writeLog(`_makeDirectUrl: no filterlink in vID:\n${vID}`);

            if (rowData === null) {
                ret.err = true;
                return ret;
            }

            rootFolder = rowData['FileRef'] ?? '';
        }

        ret.link = `${webUrlAr[0]}//${webUrlAr[2]}${rootFolder}`; // https://xxxx...

        _writeLog(`makeDirectUrl:\nrootfolder: ${rootFolder}\nwebUrl: ${webUrlAr}\nfinal: ${ret.link}`);
        return ret;
    }

    function _makeFolderApiURL(folderURL, itemType) {
        const urlObj = new URL(folderURL);
        const folderPath = urlObj.pathname;
        const apiURL = folderPath.replace(/\/sites\/([^\/]+)\/(.*)/, `/sites/$1/_api/web/GetFolderByServerRelativeUrl('$2')/${itemType}`);

        return `${urlObj.origin}${apiURL}`;
    }

    function _getFoldersListInFolder(pageContent) {
        const pre = new DOMParser().parseFromString(pageContent, 'text/html').body.getElementsByTagName('pre');
        const ret = [];
        let xmlDoc;

        if (pre.length === 0) {
            _writeLog(`_getFoldersListInFolder: Unexpected API result:\n${pageContent}`);
            return [];
        }

        xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');

        for (const entry of xmlDoc.querySelectorAll('entry')) {
            const foldNameElm = entry.querySelector('content').getElementsByTagName('d:Name');

            if (foldNameElm.length === 0) {
                _writeLog(`_getFoldersListInFolder: No name found for folder item:\n${entry.innerHTML}`);
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
            _writeLog(`_getVideoURLsInFold: Unexpected API result:\n${pageCont}`);
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
                _writeLog(`_getVideoURLsInFold: No URL for this entry:\n${entry.innerHTML}`);
                continue;
            }

            relUrl = relUrlElm[0].textContent;
            fileExt = _path.extname(relUrl);

            if (fileExt !== '.mp4') {
                _writeLog(`_getVideoURLsInFold: unhandled file format: ${fileExt}`);
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
        const axios = require('axios');
        const resp = await axios.get(donorURLObj.searchParams.get('docid') + '&access_token=' + donorURLObj.searchParams.get('access_token'));

        _writeLog("_getFileName:\ndocid: "+donorURLObj.searchParams.get('docid')+'\n\n' +
            "url: "+_hideToken(donorURLObj.searchParams.get('access_token'), donorURLObj.toString()));

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

    api.runPuppeteerGetVideoData = async (video, loginData, tmout, pLoopTmout, enableUserdataFold, isDirect = false) => {
        const knownResponses = [
            'RenderListDataAsStream?@a1=', 'RenderListDataAsStream?@listUrl',
            'SP.List.GetListDataAsStream?listFullUrl'
        ];
        const puppy = require('puppeteer');
        const puppyTimeout = tmout * 1000;
        let browser = null;

        _startCatchResponse = false;

        try {
            browser = await puppy.launch(_getPuppeteerArgs(puppy.executablePath(), enableUserdataFold));

            const responseList = [];
            const catchResponse = function(resp) {
                if (!_startCatchResponse)
                    return;

                const resType = resp.request().resourceType();

                if (resType === 'fetch' || resType === 'xhr')
                    responseList.push(resp);
            }
            const page = (await browser.pages())[0];
            let matchedResponse = null;
            let donorRespData = null;
            let videoUrl;
            let cookies;
            let title;
            let dlData;
            let vID;

            _initLogFile();
            page.setDefaultTimeout(puppyTimeout);
            page.setDefaultNavigationTimeout(puppyTimeout);
            page.on('response', catchResponse);

            await page.goto(video.url, {waitUntil: 'domcontentloaded'});
            await _sharepointLogin(page, loginData);
            await page.waitForNavigation({waitUntil: 'networkidle0'});
            page.off('response', catchResponse);

            for (const catchedResp of responseList) {
                const respUrl = catchedResp.url();

                for (const knownResp of knownResponses) {
                    if (!respUrl.includes(knownResp))
                        continue;

                    matchedResponse = knownResp;
                        break;
                }

                if (matchedResponse === null)
                    continue;

                donorRespData = await catchedResp.json();
                break;
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

                _writeLog('runPuppeteerGetVideoData: direct mode: linkAr:\n' + JSON.stringify(linkAr));

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

            await browser.close();
            return {m: videoUrl, t: title, c: cookies};

        } catch (e) {
            if (browser)
                await browser.close();

            api.showMessage('error', e.message, 'Puppeteer Error');
            return null;
        }
    }

    api.runPuppeteerGetURLListFromFolder = async (folderURLsList, includeSubFolds, sortType, loginData, tmout, enableUserdataFold) => {
        const puppy = require('puppeteer');
        const puppyTimeout = tmout * 1000;
        let browser = null;

        try {
            browser = await puppy.launch(_getPuppeteerArgs(puppy.executablePath(), enableUserdataFold));

            const page = (await browser.pages())[0];
            const regex = new RegExp(/\/sites\/([^\/]+)/);
            const match = folderURLsList[0].match(regex);
            const ret = {list: []};

            _initLogFile();
            page.setDefaultTimeout(puppyTimeout);
            page.setDefaultNavigationTimeout(puppyTimeout);

            if (match === null || match.length < 2) {
                _writeLog(`runPuppeteerGetURLListFromFolder: Unknown URL format:\n${folderURLsList[0]}`);
                throw new Error(`Unknown folder URL format`);
            }

            await page.goto(folderURLsList[0], {waitUntil: 'domcontentloaded'});
            await _sharepointLogin(page, loginData);
            await page.waitForFunction(`window.location.href.includes('${match[1]}')`);

            for (const folderURL of folderURLsList) {
                const urlObj = new URL(folderURL);

                await _getVideoURLsInFold(ret, page, `${urlObj.origin}${urlObj.pathname}`, includeSubFolds);
            }

            await browser.close();

            return _sortURLsFromFolder(ret.list, sortType);

        } catch (e) {
            if (browser)
                await browser.close();

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

                    _writeLog(`FFMPEG: download filed: exit code ${data.exitCode}`);
                }

                window.dispatchEvent(evt);
                _closeShLogFD();
            });

            ffmpegCmd.on('error', (err) => {
                try {
                    _unlinkSync(outFile);

                } catch (e) {
                    api.showMessage('error', e.message, 'FFmpeg');
                }

                if (!err.message.includes('Exiting normally, received signal 15')) {
                    const failEvt = new CustomEvent('DownloadFail', { detail: err });

                    _writeLog("ffmpegCmd.on(error):\n"+err.log);
                    window.dispatchEvent(failEvt);
                }

                _closeShLogFD();
            });

            _runningProcess = ffmpegCmd.spawn();
            return true;

        } catch (e) {
            api.showMessage('error', e.message, 'FFmpeg');
            _closeShLogFD();
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
                const outFolder = outFPath.dir;

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

            videoProgBar.setAttribute('data-tmp-perc', '0');
            _stoppingProcess = false;

            const ytdlp = spawn('yt-dlp', args);

            ytdlp.stdout.on('data', (data) => {
                if (_stoppingProcess)
                    return;

                _writeLog(data.toString(), 'ytdlp');

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
                _writeLog(data.toString(), 'ytdlp');
            });

            ytdlp.on('close', (code) => {
                try {
                    if (code !== 0) {
                        videoProgBar.style.width = '0%';

                        if (isDirect)
                            _unlinkSync(outFile);
                        else
                            _rmSync(tmpFold);

                        throw new Error("Exit code: " + (code ?? "aborted"));
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

                    _rmSync(tmpFold);

                    if (!found)
                        throw new Error(`Cannot find video file in output folder!\n\nSrc:\n${tmpOutFile}\n\nDest:\n${outFile}`);
                    }

                    window.dispatchEvent(new CustomEvent('DownloadSuccess'));

                } catch (e) {
                    const failEvt = new CustomEvent('DownloadFail', {detail: `YT-dlp error:\n\n${e.message}`});

                    if (isDirect)
                        _unlinkSync(outFile);
                    else
                        _rmSync(tmpFold);

                    _writeLog(`YT-dlp: download failed:\n${e.message}`);
                    window.dispatchEvent(failEvt);

                } finally {
                    _closeShLogFD();
                    _closeYtDlpLogFD();
                }
            });

            _runningProcess = ytdlp;
            return true;

        } catch (e) {
            api.showMessage('error', e.message, 'YT-dlp');
            _closeShLogFD();
            _closeYtDlpLogFD();
        }

        return false;
    }

    api.stopDownload = () => {
        try {
            _stoppingProcess = true;
            _runningProcess?.kill();

        } catch (e) {
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

    api.upgradeSett = (version) => {
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

    api.showMessage = (dtype, msg, dtitle) => ipcRenderer.sendSync('showMessage', {type: dtype, m: msg, title: dtitle});
    api.setLogging = (enableLg) => _enableLogs = enableLg;

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
