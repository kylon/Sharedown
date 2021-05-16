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

const { contextBridge, ipcRenderer } = require('electron');

// macOS PATH workaround
if (process.platform === 'darwin' && !process.env.PATH.includes('node_modules'))
    process.env.PATH = ['./node_modules/.bin', '/usr/local/bin', process.env.PATH].join(':');

const SharedownAPI = (() => {
    const _LoginModule = require('./sharedown/loginModules/loginModule');
    const _path = require('path');
    const _loginModule = new _LoginModule();
    const _sharedownAppDataPath = ipcRenderer.sendSync('sharedown-sync', {cmd: 'getAppDataPath'}) + '/Sharedown';
    const _sharedownStateFile = _path.normalize(_sharedownAppDataPath+'/sharedown.state');
    const _sharedownSettFile = _path.normalize(_sharedownAppDataPath+'/sharedown.sett');
    let _runningProcess = null;

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
        md5sum: null,
        quitApp: null,
    };

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

        for (let i=0,l=replaceAr.length; i<l; i+=2)
            manifestUrlSchema = manifestUrlSchema.replace(replaceAr[i], replaceAr[i+1]);

        urlObj = new URL(manifestUrlSchema);

        urlObj.searchParams.set('action', 'Access');
        urlObj.searchParams.set('part', 'Index');
        urlObj.searchParams.set('format', 'dash');
        urlObj.searchParams.set('useScf', 'True');
        urlObj.searchParams.set('pretranscode', '0');
        urlObj.searchParams.set('transcodeahead', '0');

        return urlObj;
    }

    async function _getFileName(donorURLObj) {
        const axios = require('axios');
        const resp = await axios.get(donorURLObj.searchParams.get('docid') + '&access_token=' + donorURLObj.searchParams.get('access_token'));

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
        const fs = require('fs');

        try {
            if (!fs.existsSync(_sharedownAppDataPath))
                fs.mkdirSync(_sharedownAppDataPath, {recursive: true});

            if (!fs.existsSync(_sharedownAppDataPath))
                return false;

            fs.writeFileSync(path, data, 'utf8');
            return true;

        } catch (e) { api.showMessage('error', `${erMsg}\n${e.message}`, 'I/O Error'); }

        return false;
    }

    function _loadSettingsFromDisk(path, erMsg) {
        const fs = require('fs');

        try {
            if (!fs.existsSync(path))
                return '';

            return fs.readFileSync(path, 'utf8');

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

    api.runPuppeteerGetManifestAndTitle = async (video, loginData) => {
        const puppy = require('puppeteer');
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

            await page.goto(video.url, {waitUntil: 'networkidle0'});
            await _sharepointLogin(page, loginData);

            donorResponse = await page.waitForResponse(response => {
                return response.url().includes('RenderListDataAsStream?@a1=');
            });
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
                ['crf', '25']
            ]));
            const ffmpegCmd = new FFmpegCommand();
            const totalTime = await _getVideoDuration(videoData.m);

            ffmpegCmd.addInput(ffmpegInput);
            ffmpegCmd.addOutput(ffmpegOutput);

            ffmpegCmd.on('update', (data) => {
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
                    const fs = require('fs');

                    const failEvt = new CustomEvent('DownloadFail', { detail: err });

                    window.dispatchEvent(failEvt);

                    try {
                        if (fs.existsSync(outFile))
                            fs.unlinkSync(outFile);

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
        const dompurify = require('dompurify');
        const path = require('path');
        const fs = require('fs');

        try {
            const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
            const logsContainer = document.querySelector('#stderrCont');
            const pathAr = outFile.split(path.sep);
            const filename = pathAr[pathAr.length - 1];

            pathAr.pop();

            const outFolder = pathAr.join(path.sep);
            const tmpFold = path.normalize(path.join(outFolder, 'sharedownTmp'));
            const tmpOutFile = path.normalize(path.join(tmpFold, filename));

            if (fs.existsSync(tmpFold))
                fs.rmSync(tmpFold, {force: true, recursive: true});

            fs.mkdirSync(tmpFold);
            videoProgBar.setAttribute('data-tmp-perc', '0');
            logsContainer.innerHTML = '';

            const ytdlp = spawn('yt-dlp', ['-N', '5', '-o', tmpOutFile, '-v', videoData.m, '--no-part']);

            ytdlp.stdout.on('data', (data) => {
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
                logsContainer.innerHTML += dompurify.sanitize(`${data}<br><br>`);
            });

            ytdlp.on('close', (code) => {
                    try {
                        if (code !== 0) {
                            fs.rmSync(tmpFold, { force: true, recursive: true });
                            videoProgBar.style.width = '0%'; // windows workaround

                            if (code !== null)
                                throw new Error(`Exit code: ${code}`);

                            return;
                        }

                        const evt = new CustomEvent('DownloadSuccess');
                        const files = fs.readdirSync(tmpFold);
                        let found = false;

                        for (const f of files) {
                            if (!f.includes(filename))
                                continue;

                            fs.copyFileSync(path.resolve(tmpOutFile), path.resolve(outFile));
                            found = true;
                            break;
                        }

                        fs.rmSync(path.resolve(tmpFold), { force: true, recursive: true });

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
            _runningProcess?.kill();

        } catch (e) {
            api.showMessage('error', e.message, 'Stop download error');
        }
    }

    api.makeOutputDirectory = outFold => {
        const fs = require('fs');

        try {
            outFold = _path.normalize(outFold);

            if (!fs.existsSync(outFold))
                fs.mkdirSync(outFold, {recursive: true});

            return fs.existsSync(outFold);

        } catch (e) { api.showMessage('error', e.message, 'Output directory I/O Error'); }

        return false;
    }

    api.getNormalizedUniqueOutputFilePath = (outFolder, fileName) => {
        const fs = require('fs');
        let p = _path.normalize(_path.join(outFolder, fileName));
        const name = p.substring(0, p.length - 4);
        let i = 1;

        while (fs.existsSync(p))
            p = name + " " + (i++) + '.mp4';

        return _path.extname(p) !== '.mp4' ? p.substring(0, p.length - 3) + 'mp4' : p;
    }

    api.getDefaultOutputFolder = () => {
        const path = require('path');
        const downloadsPath = ipcRenderer.sendSync('sharedown-sync', { cmd: 'getDownloadsPath' });

        return path.normalize(path.join(downloadsPath, 'sharedownVideos'));
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

    api.md5sum = s => {
        const md5 = require('md5');

        return md5(s);
    }

    api.quitApp = () => {
        ipcRenderer.sendSync('sharedown-sync', {cmd: 'quit'});
    }

    Object.freeze(api);
    return api;
})();

contextBridge.exposeInMainWorld('sharedown', SharedownAPI);
