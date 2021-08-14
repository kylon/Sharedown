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
    const _logFilePath = _path.normalize(_sharedownAppDataPath+'/sharedownLog.log');
    let _runningProcess = null;
    let _stoppingProcess = false;
    let _enableLogs = false;

    const api = {
        sharedownLoginModule: {
            getModuleList: _loginModule.getModuleList(),
            setModule: idx => _loginModule.setLoginModule(idx),
            getFields: () => { return _loginModule.getLoginModuleFields(); }
        },
        hasFFmpeg: null,
        hasYTdlp: null,
        runPuppeteerGetManifestAndTitle: null,
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
        showMessage: null,
        setLogging: null,
        openLogsFolder: null,
        md5sum: null,
        openLink: null,
        quitApp: null,
    };

    function _initLogFile() {
        const oldF = _logFilePath+'.old';

        if (_fs.existsSync(oldF))
            _fs.unlinkSync(oldF);

        if (_fs.existsSync(_logFilePath))
            _fs.renameSync(_logFilePath, oldF)
    }

    function _writeLog(msg) {
        if (!_enableLogs)
            return;

        _fs.appendFileSync(_logFilePath, '\n'+msg+'\n\n');
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

    function _getPuppeteerExecutablePath(curExecPath) {
        if (curExecPath.toLowerCase().includes('resources'))
            return curExecPath.replace('app.asar', 'app.asar.unpacked');

        return curExecPath;
    }

    async function _sharepointLogin(puppeteerPage, logData) {
        await puppeteerPage.waitForSelector('input[type="email"]');

        if (logData.msid !== '') {
            await puppeteerPage.keyboard.type(logData.msid);
            await puppeteerPage.click('input[type="submit"]');
        }

        if (logData.hasOwnProperty('custom'))
            await _loginModule.doLogin(puppeteerPage, logData.custom);
    }

    function _makeVideoManifestFetchURL(donorRespData) {
        const replaceAr = [
            '{.mediaBaseUrl}', donorRespData.ListSchema['.mediaBaseUrl'] ?? '',
            '{.fileType}', 'mp4', // cant find this
            '{.callerStack}', donorRespData.ListSchema['.callerStack'] ?? '',
            '{.spItemUrl}', donorRespData.ListData['CurrentFolderSpItemUrl'] ?? '',
            '{.driveAccessToken}', donorRespData.ListSchema['.driveAccessToken'] ?? ''
        ];
        let manifestUrlSchema = donorRespData.ListSchema[".videoManifestUrl"];
        let urlObj;

        _writeLog("_makeVideoManifestFetchURL: manifest template: "+manifestUrlSchema);

        for (let i=0,l=replaceAr.length; i<l; i+=2)
            manifestUrlSchema = manifestUrlSchema.replace(replaceAr[i], replaceAr[i+1]);

        urlObj = new URL(manifestUrlSchema);

        urlObj.searchParams.set('action', 'Access');
        urlObj.searchParams.set('part', 'Index');
        urlObj.searchParams.set('format', 'dash');
        urlObj.searchParams.set('useScf', 'True');
        urlObj.searchParams.set('pretranscode', '0');
        urlObj.searchParams.set('transcodeahead', '0');

        _writeLog("_makeVideoManifestFetchURL:\nurl:"+_hideToken(donorRespData.ListSchema['.driveAccessToken'], urlObj.toString())+'\n\nresp dump:\n'+_tryRemoveUserDataFromRespDumpForLog(donorRespData));

        return urlObj;
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

    api.runPuppeteerGetManifestAndTitle = async (video, loginData, tmout) => {
        const puppy = require('puppeteer');
        const puppyTimeout = tmout * 1000;
        let browser = null;

        try {
            browser = await puppy.launch({
                executablePath: _getPuppeteerExecutablePath(puppy.executablePath()),
                headless: false,
                args: ['--disable-dev-shm-usage']
            });

            const page = (await browser.pages())[0];
            let donorResponse;
            let donorRespData;
            let manifestURLObj;
            let title;

            _initLogFile();
            page.setDefaultNavigationTimeout(puppyTimeout);

            await page.goto(video.url, {waitUntil: 'networkidle0'});
            await _sharepointLogin(page, loginData);

            donorResponse = await page.waitForResponse(response => {
                return response.url().includes('RenderListDataAsStream?@a1=');
            }, {timeout: puppyTimeout});
            donorRespData = await donorResponse.json();

            manifestURLObj = _makeVideoManifestFetchURL(donorRespData);
            title = await _getFileName(manifestURLObj);

            await browser.close();
            return {m: manifestURLObj.toString(), t: title};

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
            });

            ffmpegCmd.on('success', (data) => {
                let evt;

                if (data.exitCode === 0)
                    evt = new CustomEvent('DownloadSuccess');
                else
                    evt = new CustomEvent('DownloadFail', { detail: `Exit code: ${data.exitCode}` });

                window.dispatchEvent(evt);

            });

            ffmpegCmd.on('error', (err) => {
                if (!err.message.includes('Exiting normally, received signal 15')) {
                    const failEvt = new CustomEvent('DownloadFail', { detail: err });

                    _writeLog("ffmpegCmd.on(error):\n"+err.log);
                    window.dispatchEvent(failEvt);

                    try {
                        if (_fs.existsSync(outFile))
                            _fs.unlinkSync(outFile);

                    } catch (e) {
                        api.showMessage('error', e.message, 'FFmpeg');
                    }
                }
            });

            _runningProcess = ffmpegCmd.spawn();
            return true;

        } catch (e) { api.showMessage('error', e.message, 'FFmpeg'); }

        return false;
    }

    api.downloadWithYtdlp = (videoData, video, outFile) => {
        const { spawn } = require('child_process');

        try {
            const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
            const pathAr = outFile.split(_path.sep);
            const filename = pathAr[pathAr.length - 1];

            pathAr.pop();

            const outFolder = pathAr.join(_path.sep);
            const tmpFold = _path.normalize(_path.join(outFolder, 'sharedownTmp'));
            const tmpOutFile = _path.normalize(_path.join(tmpFold, filename));

            if (_fs.existsSync(tmpFold))
                _fs.rmSync(tmpFold, {force: true, recursive: true});

            _fs.mkdirSync(tmpFold);
            videoProgBar.setAttribute('data-tmp-perc', '0');
            _stoppingProcess = false;

            const ytdlp = spawn('yt-dlp', ['-N', '5', '-o', tmpOutFile, '-v', videoData.m, '--no-part']);

            ytdlp.stdout.on('data', (data) => {
                if (_stoppingProcess)
                    return;

                const regex = new RegExp(/\s(\d+.\d+)%\s/);
                const out = data.toString();
                const isProgress = out.includes('[download]');
                const match = out.match(regex);

                if (!isProgress || match === null || match.length < 2)
                    return;

                const curPerc = videoProgBar.style.width;
                const curPercInt = curPerc ? parseInt(curPerc.substring(0, curPerc.length-1), 10) : 0;
                const perc = Math.floor(parseInt(match[1], 10) / 2);
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
            });

            ytdlp.stderr.on('data', (data) => {
                _writeLog('ytdlp log: \n\n'+data.toString());
            });

            ytdlp.on('close', (code) => {
                    try {
                        if (code !== 0) {
                            _fs.rmSync(tmpFold, { force: true, recursive: true });
                            videoProgBar.style.width = '0%'; // windows workaround

                            if (code !== null)
                                throw new Error(`Exit code: ${code}`);

                            return;
                        }

                        const evt = new CustomEvent('DownloadSuccess');
                        const files = _fs.readdirSync(tmpFold);
                        let found = false;

                        for (const f of files) {
                            if (!f.includes(filename))
                                continue;

                            _fs.copyFileSync(_path.resolve(tmpOutFile), _path.resolve(outFile));
                            found = true;
                            break;
                        }

                        _fs.rmSync(_path.resolve(tmpFold), { force: true, recursive: true });

                        if (!found)
                            throw new Error(`Unable to copy video file to output folder!\n\nSrc:\n${tmpOutFile}\n\nDest:\n${outFile}`);

                        window.dispatchEvent(evt);

                    } catch (e) {
                        const failEvt = new CustomEvent('DownloadFail', {detail: `YT-dlp error:\n\n${e.message}`});

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

    api.saveAppState = data => {
        return _writeSettingsToDisk(data, _sharedownStateFile, "Unable to save Sharedown state");
    }

    api.loadAppState = () => {
        return _loadSettingsFromDisk(_sharedownStateFile, "Unable to load Sharedown state");
    }

    api.showMessage = (dtype, msg, dtitle) => ipcRenderer.sendSync('showMessage', {type: dtype, m: msg, title: dtitle});

    api.setLogging = (enableLg) => _enableLogs = enableLg;

    api.openLogsFolder = () => {
        shell.openPath(_sharedownAppDataPath).then(res => {
            if (res !== '')
                ipcRenderer.sendSync('showMessage', res);
        });
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

    Object.freeze(api);
    return api;
})();

contextBridge.exposeInMainWorld('sharedown', SharedownAPI);
