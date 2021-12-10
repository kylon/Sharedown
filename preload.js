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
if (process.platform === 'darwin' && !process.env.PATH.includes('node_modules'))
    process.env.PATH = ['./node_modules/.bin', '/usr/local/bin', process.env.PATH].join(':');

const SharedownAPI = (() => {
    const _LoginModule = require('./sharedown/loginModules/loginModule');
    const _path = require('path');
    const _fs = require('fs');
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
    let _enableLogs = false;

    const api = {
        sharedownLoginModule: {
            getModuleList: _loginModule.getModuleList(),
            setModule: idx => _loginModule.setLoginModule(idx),
            getFields: () => _loginModule.getLoginModuleFields(),
            getFieldsCount: () => _loginModule.getLoginModuleFieldsCount()
        },
        hasFFmpeg: null,
        hasYTdlp: null,
        runPuppeteerGetVideoData: null,
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
        md5sum: null,
        openLink: null,
        quitApp: null,
    };

    function _initLogFile() {
        const logsP = [_logFilePath, _ytdlpLogFilePath];

        if (!_fs.existsSync(_logsFolderPath))
            _fs.mkdirSync(_logsFolderPath);

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

        let logf;

        switch (type) {
            case 'ytdlp':
                logf = _ytdlpLogFilePath;
                break;
            default:
                logf = _logFilePath;
                break;
        }

        _fs.appendFileSync(logf, '\n'+msg+'\n\n');
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

        if (userdataFold)
            pargs['userDataDir'] = _path.normalize(_sharedownAppDataPath+'/data');

        return pargs;
    }

    async function _sharepointLogin(puppeteerPage, logData) {
        if (logData === null)
            return;

        if (logData.msid !== '') {
            await puppeteerPage.waitForSelector('input[type="email"]', {timeout: 8000});
            await puppeteerPage.keyboard.type(logData.msid);
            await puppeteerPage.click('input[type="submit"]');
        }

        if (logData.hasOwnProperty('custom'))
            await _loginModule.doLogin(puppeteerPage, logData.custom);
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

    function _getDataFromResponse(donorRespData, vID) {
        const ret = {
            'mediaBaseUrl': donorRespData.ListSchema['.mediaBaseUrl'] ?? '',
            'fileType': 'mp4', // should be fine
            'callerStack': donorRespData.ListSchema['.callerStack'] ?? '',
            'spItmUrl': donorRespData.ListData['CurrentFolderSpItemUrl'] ?? '',
            'token': donorRespData.ListSchema['.driveAccessToken'] ?? '',
        };

        if (ret.spItmUrl !== '')
            return ret;

        _writeLog(`_getDataFromResponse: no spItmUrl\nvID: ${vID}`);

        const rowData = _getDataFromResponseListDataRow(donorRespData.ListData['Row'], vID);
        if (rowData === null)
            return ret;

        ret.spItmUrl = rowData['.spItemUrl'] ?? '';

        _writeLog(`_getDataFromResponse: row spItemUrl: ${ret.spItmUrl}`);
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

    function _makeVideoManifestFetchURL(donorRespData, vID) {
        const placeholders = [
            '{.mediaBaseUrl}', '{.fileType}', '{.callerStack}', '{.spItemUrl}', '{.driveAccessToken}',
        ];
        const placeholderData = Object.values(_getDataFromResponse(donorRespData, vID));
        let manifestUrlSchema = donorRespData.ListSchema[".videoManifestUrl"];
        let hasErr = false;
        let urlObj;

        _writeLog("_makeVideoManifestFetchURL: manifest template: "+manifestUrlSchema);

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

    api.hasFFmpeg = () => {
        const proc = require('child_process');

        try {
            proc.execSync('ffmpeg -version').toString();
            return true;

        } catch (e) {}

        return false;
    }

    api.hasYTdlp = () => {
        const proc = require('child_process');

        try {
            proc.execSync('yt-dlp -help').toString();
            return true;

        } catch (e) {}

        return false;
    }

    api.runPuppeteerGetVideoData = async (video, loginData, tmout, enableUserdataFold, isDirect = false) => {
        const knownResponses = ['a1=', 'listUrl'];
        const puppy = require('puppeteer');
        const puppyTimeout = tmout * 1000;
        let browser = null;

        try {
            browser = await puppy.launch(_getPuppeteerArgs(puppy.executablePath(), enableUserdataFold));

            const page = (await browser.pages())[0];
            let donorResponse;
            let donorRespData;
            let videoUrl;
            let cookies;
            let title;
            let ret;

            _initLogFile();
            page.setDefaultNavigationTimeout(puppyTimeout);

            await page.goto(video.url, {waitUntil: 'domcontentloaded'});
            await _sharepointLogin(page, loginData);

            for (const type of knownResponses) {
                donorResponse = await page.waitForResponse(response => {
                    return response.url().includes(`RenderListDataAsStream?@${type}`);
                }, {timeout: puppyTimeout});
                donorRespData = await donorResponse.json();

                const vID = (new URL(page.url())).searchParams.get('id')?.trim();

                ret = isDirect ? _makeDirectUrl(donorRespData, vID) : _makeVideoManifestFetchURL(donorRespData, vID);
                if (!ret.err)
                    break;

                _writeLog(`no video data found in ${type}`);
                await page.reload({ waitUntil: 'domcontentloaded'});
            }

            if (isDirect) {
                const linkAr = ret.link.split('/');

                videoUrl = ret.link;
                title = '';

                _writeLog('runPuppeteerGetVideoData: direct mode: linkAr:\n' + JSON.stringify(linkAr));

                if (linkAr.length > 0) {
                    cookies = _getDataFromCookies(await page.cookies());
                    title = linkAr[linkAr.length - 1];
                }
            } else {
                const manifestURLObj = ret.uobj;

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

    api.downloadWithFFmpeg = async (videoData, video, outFile) => {
        try {
            const { FFmpegCommand, FFmpegInput, FFmpegOutput } = require('@tedconf/fessonia')();
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
            });

            _runningProcess = ffmpegCmd.spawn();
            return true;

        } catch (e) { api.showMessage('error', e.message, 'FFmpeg'); }

        return false;
    }

    api.downloadWithYtdlp = (videoData, video, outFile, settings) => {
        const { spawn } = require('child_process');

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
                    const evt = new CustomEvent('DownloadSuccess');
                    let found = false;
                    let files;

                    if (code !== 0) {
                        videoProgBar.style.width = '0%'; // windows workaround

                        if (isDirect)
                            _unlinkSync(outFile);
                        else
                            _rmSync(tmpFold);

                        throw new Error("Exit code: " + (code ?? "aborted"));
                    }

                    if (isDirect) {
                        window.dispatchEvent(evt);
                        return;
                    }

                    files = _fs.readdirSync(tmpFold);
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

                    window.dispatchEvent(evt);

                } catch (e) {
                    const failEvt = new CustomEvent('DownloadFail', {detail: `YT-dlp error:\n\n${e.message}`});

                    if (isDirect)
                        _unlinkSync(outFile);
                    else
                        _rmSync(tmpFold);

                    _writeLog(`YT-dlp: download failed:\n${e.message}`);
                    window.dispatchEvent(failEvt);
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

    api.md5sum = s => {
        const md5 = require('md5');

        return md5(s);
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
