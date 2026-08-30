/**
 * This file is part of the Sharedown (https://github.com/kylon/Sharedown).
 * Copyright (c) 2026 Kylon.
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

const {app, ipcMain, dialog, Menu, BrowserWindow, clipboard, shell} = require('electron');
const nodechildproc = require('node:child_process');
const nodepath = require('node:path');
const nodefs = require("node:fs");
const puppy = require("puppeteer");
const isDebug = false;
const isWindows = process.platform === 'win32';
const builtinChromePath = getChromePath();
const appDataPath = `${app.getPath('appData')}/Sharedown`;
const logsPath = nodepath.join(appDataPath, 'logs');
const settingsPath = nodepath.join(appDataPath, 'sharedown.sett');
const statePath = nodepath.join(appDataPath, 'sharedown.state');
const chromeUserdataPath = nodepath.join(appDataPath, 'data');
let puppyBrowser = null;
let logFd = null;
let showDownlInfo = false;
let isDownloadStopped = false;
let downloaderProcess = null;
let mainWindow = null;

if (process.platform === 'darwin') // macOS PATH workaround
    process.env.PATH = `./node_modules/.bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`;

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        minWidth: 350,
        minHeight: 400,
        webPreferences: {
            spellcheck: false,
            devTools: true,
            preload: nodepath.join(__dirname, 'preload.js')
        }
    });

    win.webContents.toggleDevTools();

    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('will-redirect', e => e.preventDefault());
    win.webContents.on('will-frame-navigate', e => e.preventDefault());
    win.webContents.on('will-attach-webview', e => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => { return {action: 'deny'}; });

    win.loadFile(nodepath.join(__dirname, 'sharedown', 'sharedown.html'));
    return win;
}

function getChromePath() {
    try {
        const isLinux = process.platform === 'linux';
        const isMacOS = process.platform === 'darwin';
        const basePath = 'node_modules/puppeteer/chrome';
        const name = isWindows ? 'chrome.exe' : (isMacOS ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' : 'chrome');
        const builtinPath = (() => {
            if (__dirname.toLowerCase().includes('app.asar')) {
                const pkgPath = isWindows ? process.cwd() : (isMacOS ? __dirname : process.env.APPDIR);

                return isMacOS ? nodepath.join(`${pkgPath}.unpacked`, basePath) :
                    nodepath.join(pkgPath, 'resources', 'app.asar.unpacked', basePath);
            }

            return nodepath.join(process.cwd(), basePath);
        })();
        const osPath = nodefs.readdirSync(builtinPath).filter(itm => {
            if (isLinux)
                return itm.startsWith('linux-');
            else if (isMacOS)
                return itm.startsWith('mac-') || itm.startsWith('mac_');
            else if (isWindows)
                return itm.startsWith('win64-');
            else
                return false;
        }).at(0);
        const exePath = nodefs.readdirSync(nodepath.join(builtinPath, osPath)).filter(itm => {
            if (isLinux)
                return itm === 'chrome-linux64';
            else if (isMacOS && (process.arch === 'arm64'))
                return itm === 'chrome-mac-arm64';
            else if (isMacOS)
                return itm === 'chrome-mac-x64';
            else if (isWindows)
                return itm === 'chrome-win64';
            else
                return false;
        }).at(0);

        return nodepath.join(basePath, osPath, exePath, name);

    } catch (e) {
        return '';
    }
}

function getDefaultDownloadPath() {
    return app.getPath('downloads');
}

function writeFileToDisk(data, path, erMsg) {
    try {
        if (!nodefs.existsSync(appDataPath))
            nodefs.mkdirSync(appDataPath, {recursive: true});

        if (!nodefs.existsSync(appDataPath))
            showErrorMessage(`${appDataPath}: not found`);
        else
            nodefs.writeFileSync(path, data, 'utf8');

    } catch (e) {
        showErrorMessage(`${erMsg}\n${e.message}`);
    }
}

function readFileFromDisk(path, erMsg) {
    try {
        if (!nodefs.existsSync(path))
            return '';

        return nodefs.readFileSync(path, 'utf8');

    } catch (e) {
        showErrorMessage(`${erMsg}\n${e.message}`);
    }

    return '';
}

function unlinkSync(path) {
    if (nodefs.existsSync(path))
        nodefs.unlinkSync(path);
}

function rmSync(path, recursive = true) {
    if (nodefs.existsSync(path))
        nodefs.rmSync(path, {recursive: recursive, force: true});
}

function openLogFolder() {
    shell.openPath(logsPath).then(res => {
        if (res !== '')
            showErrorMessage(res);
    });
}

function showMessageBox(mtype, msg) {
    return dialog.showMessageBox(mainWindow, {
        type: mtype,
        message: msg,
        title: 'Sharedown',
        buttons: mtype === 'question' ? ['OK', 'Cancel'] : ['OK']
    });
}

async function showErrorMessage(msg) {
    await showMessageBox('error', msg);
    return 0;
}

async function selectFolderDialog() {
    const {canceled, filePaths} = await dialog.showOpenDialog(mainWindow, {
        title: 'Select output directory',
        properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
        message: 'Output directory',
    });

    return canceled ? '' : filePaths[0];
}

async function selectBrowserDialog() {
    const {canceled, filePaths} = await dialog.showOpenDialog(mainWindow, {
        title: 'Select custom browser executable path',
        properties: ['openFile'],
        message: 'Browser executable path',
    });

    return canceled ? '' : filePaths[0];
}

function hasFFmpeg() {
    try {
        nodechildproc.execSync('ffmpeg -version');
        return true;

    } catch (e) {}

    return false;
}

function hasYTdlp() {
    try {
        nodechildproc.execSync('yt-dlp --help', {stdio: 'ignore'});
        return true;

    } catch (e) {}

    return false;
}

function enableLog() {
    if (logFd !== null)
        return;

    try {
        const logPath = nodepath.join(logsPath, 'sharedown.log');
        const oldLog = nodepath.join(logsPath, 'sharedown_old.log');

        if (!nodefs.existsSync(logsPath))
            nodefs.mkdirSync(logsPath, {recursive: true});

        unlinkSync(oldLog);

        if (nodefs.existsSync(logPath))
            nodefs.renameSync(logPath, oldLog);

        logFd = nodefs.openSync(logPath, 'a');

    } catch (e) {
        showErrorMessage(`Failed to enable logging\n${e.message}`);
    }
}

function disableLog() {
    if (logFd === null)
        return;

    try {
        nodefs.fsyncSync(logFd);
        nodefs.closeSync(logFd);
        logFd = null;

    } catch (e) {
        showErrorMessage(`Failed to disable logging\n${e.message}`);
    }
}

function writeLog(msg) {
    if (logFd === null)
        return;

    try {
        nodefs.writeSync(logFd, `\n${msg}\n`);
    } catch (e) {
        console.log(`writeLog: ${e.message}`);
    }
}

function waitForTimeout(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function saveYtdlpTempFragsFolder(tmpPath, filename) {
    try {
        if (!nodefs.existsSync(tmpPath)) {
            writeLog('no temp folder, skip..');
            return;
        }

        const savedTmpName = `${tmpPath}_${nodepath.parse(filename).name}`;
        let savedTmpFName = savedTmpName;
        let i = 1;

        while (nodefs.existsSync(savedTmpFName))
            savedTmpFName = `${savedTmpName}_${i++}`;

        nodefs.renameSync(tmpPath, savedTmpFName);

    } catch (e) {
        writeLog(`failed to rename yt-dlp temp folder:\n${e.message}`);
    }
}

function makeOutputDirectory(opath) {
    try {
        opath = opath === '' ? getDefaultDownloadPath() : nodepath.normalize(opath);

        if (!nodefs.existsSync(opath))
            nodefs.mkdirSync(opath, {recursive: true});

        return nodefs.existsSync(opath);

    } catch (e) {
        showErrorMessage(e.message);
    }

    return false;
}

function browserDisconnectedEvt() {
    puppyBrowser?.close();
    puppyBrowser = null;
}

function getPuppeteerArgs(customBrowserPath, hasUserdata) {
    const puppyArgs = {
        executablePath: customBrowserPath === '' ? builtinChromePath : customBrowserPath,
        headless: false,
        args: ['--disable-dev-shm-usage']
    };

    if (puppyArgs.executablePath === '')
        throw new Error('failed to find browser executable');

    if (hasUserdata && customBrowserPath === '') {
        const dataPath = nodepath.join(appDataPath, 'data');

        if (!nodefs.existsSync(dataPath))
            nodefs.mkdirSync(dataPath, {recursive: true});

        puppyArgs['userDataDir'] = dataPath;
    }

    return puppyArgs;
}

async function getFullFolderUrl(page, url, match) {
    if (url.split(`/${match}/`).at(1)?.includes('/'))
        return new URL(url);

    // short url?
    await page.goto(url);
    await page.waitForFunction(`window.location.href.includes('/${match}/')`);

    const pageUrl = page.url();

    if (pageUrl.includes('id=')) {
        const pUrl = new URL(pageUrl);
        const idData = pUrl.searchParams.get('id').split(`/${match}/`);

        return new URL(`${pUrl.origin}/:f:/r${idData[0]}/${match}/${idData[1]}?csf=1&web=1`);
    }

    writeLog(`unable to get folder for ${pageUrl}`);
    return null;
}

function getDataFromResponseListDataRow(rows, vID) {
    if (!rows || rows.length === 0) {
        writeLog('no rows in response');
        return null;
    }

    for (const f of rows) {
        if (f['FileRef'] !== vID)
            continue;

        return f;
    }

    writeLog(`getDataFromResponseListDataRow: no match for ${vID}`);
    return null;
}

async function getSpItmUrlFromApiRequest(page) {
    const urlObj = new URL(page.url());
    const pathNameAr = urlObj.pathname.split('/');
    const rootFoldParam = urlObj.searchParams.get('id');
    let resp = null;
    let apiUrl;

    if (pathNameAr.length === 0) {
        writeLog(`empty pathNameAr: ${urlObj.pathname}`);
        return '';

    } else if (pathNameAr.length < 6) {
        writeLog(`pathName too short: ${urlObj.pathname}`);
        return '';
    }

    pathNameAr.pop();
    pathNameAr.pop();

    apiUrl = new URL(`${urlObj.origin}/sites/${pathNameAr[2]}/_api/web/GetList(@a1)/RenderListDataAsStream`);

    apiUrl.searchParams.set('@a1', `'${pathNameAr.join('/')}'`);
    apiUrl.searchParams.set('RootFolder', rootFoldParam ?? '');

    writeLog(`apiUrl: ${apiUrl}`);

    resp = await page.evaluate(async (url) => {
        return await fetch(url, {method:'post'}).then(res => res.json());
    }, apiUrl.toString());

    if (isDebug)
        writeLog("fetch data:\n" + JSON.stringify(resp));

    return resp['CurrentFolderSpItemUrl'] ?? '';
}

async function getDataFromResponse(donorRespData, puppyPage, vID) {
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

    writeLog(`no spItmUrl\nvID: ${vID}`);

    altRow = getDataFromResponseListDataRow(donorRespData.ListData['Row'], vID);
    if (altRow !== null) {
        ret.spItmUrl = altRow['.spItemUrl'] ?? '';

        if (ret.spItmUrl !== '')
            return ret;
    }

    writeLog(`no spItmUrl in altRow:\n${altRow}`);

    ret.spItmUrl = await getSpItmUrlFromApiRequest(puppyPage);
    if (ret.spItmUrl === '')
        writeLog("no spItmUrl from api request");

    return ret;
}

function getDataFromCookies(cookies) {
    const ret = {rtfa: '', fedauth: ''};

    for (const c of cookies) {
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

    return ret;
}

async function getFileName(donorURLObj) {
    const docid = donorURLObj.searchParams.get('docid');
    const tok = donorURLObj.searchParams.get('access_token');
    const axios = require('axios');
    let resp;

    if (isDebug)
        writeLog(`docid: ${docid}\nurl: ${donorURLObj.toString()}`);

    resp = await axios.get(`${docid}&access_token=${tok}`);

    return resp.data.hasOwnProperty('name') ? resp.data['name'] : '';
}

function makeFolderApiURL(folderURL, itemType) {
    const urlObj = new URL(folderURL);
    const apiURL = urlObj.pathname.replace(/\/:f:\/[a-z]\/([a-zA-Z0-9]+)\/([^\/]+)\/(.*)/, `/$1/$2/_api/web/GetFolderByServerRelativeUrl('$3')/${itemType}`);

    return `${urlObj.origin}${apiURL}`;
}

function makeDirectUrl(donorRespData, vID) {
    const listData = donorRespData.ListData;
    const webUrlAr = donorRespData['WebUrl'].split('/');
    let rootFolder = (new URLSearchParams(listData['FilterLink'] ?? '')).get('RootFolder');
    const ret = {link: '', err: false};

    if (rootFolder === null) {
        const rowData = getDataFromResponseListDataRow(listData['Row'], vID);

        writeLog(`no filterlink in vID:\n${vID}`);

        if (rowData === null) {
            ret.err = true;
            return ret;
        }

        rootFolder = rowData['FileRef'] ?? '';
    }

    ret.link = `${webUrlAr[0]}//${webUrlAr[2]}${rootFolder}`; // https://xxxx...

    writeLog(`makeDirectUrl:\nrootfolder: ${rootFolder}\nwebUrl: ${webUrlAr}\nfinal: ${ret.link}`);
    return ret;
}

async function makeVideoManifestFetchURL(donorRespData, puppyPage, vID) {
    const placeholders = ['{.mediaBaseUrl}', '{.fileType}', '{.callerStack}', '{.spItemUrl}', '{.driveAccessToken}'];
    const placeholderData = Object.values(await getDataFromResponse(donorRespData, puppyPage, vID));
    let manifestUrlSchema = donorRespData.ListSchema[".videoManifestUrl"];
    let hasErr = false;
    let urlObj;

    writeLog(`manifest template: ${manifestUrlSchema}`);

    for (let i=0,l=placeholders.length; i<l; ++i) {
        if (placeholderData[i] === '') {
            writeLog(`make url error: empty value ${placeholders[i]}`);
            hasErr = true;
        }

        if (!manifestUrlSchema.includes(placeholders[i])) {
            writeLog(`make url error: cannot find ${placeholders[i]}`);
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

    if (isDebug)
        writeLog(`url:\n${urlObj.toString()}\nresp dump:\n${donorRespData}`);

    return {uobj: urlObj, err: hasErr};
}

function sortURLsFromFolder(videoList, sortType) {
    const sorted = [];
    const ret = [];

    if (sortType !== 0) {
        for (const vObj of videoList) {
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
        sorted.splice(0, sorted.length, ...videoList);
    }

    for (const svObj of sorted)
        ret.push(svObj.url);

    return ret;
}

function getPreTagListFromFolderResult(html, renderer) {
    return new Promise(res => {
        renderer.send('getPreTagListFolderHtml', html);
        ipcMain.once('preTagListFolderHtml', (e, preList) => res(preList));
    });
}

function getFolderListInFolder(pageContent, renderer) {
    return new Promise(res => {
        renderer.send('getFolderListInFolder', pageContent);
        ipcMain.once('folderListInFolder', (e, nameList) => res(nameList));
    });
}

function parseVideoListInFolder(pageContent, urlOrigin, renderer) {
    return new Promise(res => {
        renderer.send('getVideosInFold', pageContent, urlOrigin);
        ipcMain.once('videosInFold', (e, videoList) => res(videoList));
    });
}

async function getVideosInFold(puppyPage, pageURL, recursive, renderer) {
    const urlOrigin = new URL(pageURL).origin;
    const videoList = [];
    let ret;

    if (recursive) {
        await puppyPage.goto(makeFolderApiURL(pageURL, 'Folders'), {waitUntil: 'domcontentloaded'});

        const folderList = await getFolderListInFolder(await puppyPage.content(), renderer);

        for (const folder of folderList)
            videoList.push(...(await getVideosInFold(puppyPage, `${pageURL}/${folder}`, recursive, renderer)));
    }

    await puppyPage.goto(makeFolderApiURL(pageURL, 'Files'), {waitUntil: 'domcontentloaded'});

    ret = await parseVideoListInFolder(await puppyPage.content(), urlOrigin, renderer);
    if (ret === null)
        throw new Error('unexpected files API result');

    videoList.push(...ret);

    return videoList;
}

async function getURLListFromFolder(e, folderList, recursive, sortType, settings) {
    try {
        if (puppyBrowser === null)
            puppyBrowser = await puppy.launch(getPuppeteerArgs(settings.customChromePath, settings.userdataFold));

        const regex = new RegExp(/\/:f:\/[a-z]\/([a-zA-Z0-9_\-\.]+)\/([^\/]+)/);
        const pages = await puppyBrowser.pages();
        const page = pages[0];
        const match = folderList.at(0)?.match(regex) ?? null;
        let videoList = [];

        if (pages.length > 1)
            await pages[1].close();

        if (match === null || match.length < 2) {
            writeLog(`no wait match for:\n${folderList[0]}`);
            throw new Error(`Unknown folder URL`);

        } else {
            writeLog(`matched: ${match}\nwill wait for match: ${match[1]}`);
        }

        if (settings.keepBrowserOpen) {
            puppyBrowser.off('disconnected', browserDisconnectedEvt);
            puppyBrowser.on('disconnected', browserDisconnectedEvt);
        }

        page.setDefaultTimeout(0);
        page.setDefaultNavigationTimeout(0);

        await page.goto(folderList[0], {waitUntil: 'domcontentloaded'});
        await page.waitForFunction(`window.location.href.includes('/${match[1]}/')`);

        for (const folderURL of folderList) {
            const umatch = folderURL.match(regex);
            let urlObj;

            if (umatch === null || umatch.length < 2) {
                writeLog(`no match for folder url, skip:\n${folderURL}`);
                continue;
            }

            urlObj = await getFullFolderUrl(page, folderURL, umatch[1]);
            if (urlObj === null) {
                writeLog(`unknown folder url format, skip:\n${folderURL}`);
                continue;
            }

            videoList.push(...(await getVideosInFold(page, `${urlObj.origin}${urlObj.pathname}`, recursive, e.sender)));
        }

        if (!settings.keepBrowserOpen) {
            await puppyBrowser.close();
            puppyBrowser = null;
        }

        return sortURLsFromFolder(videoList, sortType);

    } catch (e) {
        if (!settings.keepBrowserOpen && puppyBrowser) {
            await puppyBrowser.close();
            puppyBrowser = null;
        }

        writeLog(`getURLListFromFolder: error\n${e.message}`);
        showErrorMessage(e.message);
        return null;
    }
}

async function getVideoData(video, settings) {
    try {
        if (puppyBrowser === null)
            puppyBrowser = await puppy.launch(getPuppeteerArgs(settings.customChromePath, settings.userdataFold));

        const knownResponses = ['RenderListDataAsStream?@a1=', 'RenderListDataAsStream?@listUrl', 'SP.List.GetListDataAsStream?listFullUrl'];
        const isDirect = settings.downloader === 'direct';
        const responseList = [];
        const catchResponse = resp => {
            const reqst = resp.request();
            const resType = reqst.resourceType();
            const method = reqst.method().toLowerCase();

            if ((resType === 'fetch' || resType === 'xhr') && (method === 'post' || method === 'get'))
                responseList.push(resp);
        }
        const pages = await puppyBrowser.pages();
        const page = pages[0];
        let donorRespData = null;
        let videoUrl;
        let cookies;
        let title;
        let dlData;
        let vID;

        if (pages.length > 1)
            await pages[1].close();

        if (settings.keepBrowserOpen) {
            puppyBrowser.off('disconnected', browserDisconnectedEvt)
            puppyBrowser.on('disconnected', browserDisconnectedEvt);
        }

        if (settings.customChromePath)
            writeLog('WARNING: custom browser executable!');

        page.setDefaultTimeout(0);
        page.setDefaultNavigationTimeout(0);
        writeLog(`getVideoData: goto ${video.url}`);
        page.on('response', catchResponse);
        await page.goto(video.url, {waitUntil: 'domcontentloaded'});
        await page.waitForSelector('.StreamWebApp-container');
        await page.reload();
        await waitForTimeout(3000); // tricky part, pause a bit to allow catch event to catch
        page.off('response', catchResponse);

        for (const catched of responseList) {
            const respUrl = catched.url();
            let matchedResponse = null;

            donorRespData = null;

            for (const knownResp of knownResponses) {
                if (!respUrl.includes(knownResp))
                    continue;

                matchedResponse = knownResp;
                break;
            }

            if (matchedResponse === null)
                continue;
            else if (isDebug)
                writeLog(`matched response:\n${matchedResponse}`);

            try {
                donorRespData = await catched.json();
                break;

            } catch(e) {
                writeLog(`no json body on catched response: ${respUrl}\n${e.message}`);
            }
        }

        if (donorRespData === null)
            throw new Error("unable to find a valid donor response!");

        vID = (new URL(page.url())).searchParams.get('id')?.trim();
        dlData = isDirect ? makeDirectUrl(donorRespData, vID) : (await makeVideoManifestFetchURL(donorRespData, page, vID));

        if (dlData.err)
            throw new Error(`no video data found in matched response`);

        if (isDirect) {
            const linkAr = dlData.link.split('/');

            videoUrl = dlData.link;
            title = '';

            writeLog(`direct mode: linkAr:\n${JSON.stringify(linkAr)}`);

            if (linkAr.length > 0) {
                cookies = getDataFromCookies(await page.browserContext().cookies());
                title = linkAr[linkAr.length - 1];
            }
        } else {
            const manifestURLObj = dlData.uobj;

            title = await getFileName(manifestURLObj);
            videoUrl = manifestURLObj.toString();
            cookies = null;
        }

        if (!settings.keepBrowserOpen) {
            await puppyBrowser.close();
            puppyBrowser = null;
        }

        return {m: videoUrl, t: title, c: cookies};

    } catch (e) {
        if (!settings.keepBrowserOpen && puppyBrowser) {
            await puppyBrowser.close();
            puppyBrowser = null;
        }

        writeLog(`getVideoData: error\n${e.message}`);
        showErrorMessage(e.message);
    }

    return null;
}

function getUniqueOutputFilePath(outFolder, fileName) {
    const outPath = outFolder === '' ? getDefaultDownloadPath() : outFolder;
    const file = nodepath.normalize(nodepath.join(outPath, nodepath.parse(fileName).name));
    let tmpFile = file;
    let i = 1;

    while (nodefs.existsSync(`${tmpFile}.mp4`))
        tmpFile = `${file}_${i++}`;

    return `${tmpFile}.mp4`;
}

function getParsedVideoDuration(xml, renderer) {
    return new Promise(res => {
        renderer.send('getVideoDuration', xml);
        ipcMain.once('videoDuration', (e, rawDuration) => res(rawDuration));
    });
}

async function getVideoDuration(manifestFetchURL, renderer) {
    const iso8601Parse = require('iso8601-duration');
    const axios = require('axios');
    const resp = await axios.get(manifestFetchURL);
    const rawDuration = await getParsedVideoDuration(resp.data, renderer);
    const duration = iso8601Parse.parse(rawDuration);

    return Math.ceil(iso8601Parse.toSeconds(duration));
}

async function ffmpegDownload(e, videoData, video, outFile) {
    try {
        const args = ['-i', videoData.m, '-c', 'copy', outFile];
        const totalTime = await getVideoDuration(videoData.m, e.sender);

        isDownloadStopped = false;
        downloaderProcess = nodechildproc.spawn('ffmpeg', args);

        downloaderProcess.stdout.on('data', data => writeLog(data.toString()));

        downloaderProcess.stderr.on('data', data => {
            const outStr = data.toString();

            if (isDownloadStopped || !outStr.startsWith('frame'))
                return;

            const timeMatch = outStr.match(/time=([0-9:]+)/);

            if (timeMatch !== null && timeMatch.length) {
                const timeData = timeMatch[1].split(':');
                const sec = parseInt(timeData[0], 10) * 3600 + parseInt(timeData[1], 10) * 60 + parseInt(timeData[2], 10);

                e.sender.send('downloadProg', Math.floor((sec / totalTime) * 100));
            }

            if (showDownlInfo)
                e.sender.send('detailedProg', outStr);
        });

        downloaderProcess.on('close', (code) => {
            if (code !== 0) {
                const isAborted = isDownloadStopped || code === null;

                e.sender.send('downloadProg', 0);
                unlinkSync(outFile);
                writeLog(`FFMPEG: download failed, ${code}`);

                if (!isAborted)
                    e.sender.send('downloadFail', 'FFMPEG error');

                downloaderProcess = null;
                return;
            }

            e.sender.send('downloadSuccess');
            downloaderProcess = null;
        });

        return true;

    } catch (e) {
        writeLog(`FFmpeg: error\n${e.message}`);
        showErrorMessage(e.message);
    }

    return false;
}

function onYtdlpData(data, ipcSender) {
    if (isDownloadStopped)
        return;

    const out = data.toString();
    const isProgress = out.includes('[download]');
    const match = out.match(/\s(\d+.\d+)%\s.*/);

    writeLog(out);

    if (!isProgress || match === null || match.length < 2)
        return;

    ipcSender.send('downloadProg', Math.floor(parseInt(match[1], 10)));

    if (showDownlInfo)
        ipcSender.send('detailedProg', match[0]);
}

function ytdlpDownloadDirect(e, videoData, video, outFile, settings) {
    try {
        const cookieH = `Cookie: FedAuth=${videoData.c.fedauth}; rtFa=${videoData.c.rtfa}`;
        const args = ['--no-part', '-N', settings.directN.toString(), '--add-header', cookieH, '-o', outFile, (new URL(videoData.m)).toString()];

        isDownloadStopped = false;
        downloaderProcess = nodechildproc.spawn('yt-dlp', args);

        downloaderProcess.stdout.on('data', data => onYtdlpData(data, e.sender));
        downloaderProcess.stderr.on('data', data => writeLog(data.toString()));

        downloaderProcess.on('close', (code) => {
            const isAborted = isDownloadStopped || code === null;

            try {
                if (code !== 0) {
                    e.sender.send('reset');
                    throw new Error("Exit code: " + (isAborted ? "aborted" : code));
                }

                e.sender.send('downloadSuccess');

            } catch (e) {
                unlinkSync(outFile);
                writeLog(`YT-dlp: download failed:\n${e.message}`);

                if (!isAborted)
                    e.sender.send('downloadFail', `YT-dlp error:\n\n${e.message}`);

            } finally {
                downloaderProcess = null;
            }
        });

        return true;

    } catch (e) {
        showErrorMessage(e.message);
    }

    return false;
}

function ytdlpDownload(e, videoData, video, outFile, settings) {
    if (videoData.c !== null)
        return ytdlpDownloadDirect(e, videoData, video, outFile, settings);

    try {
        const outFPath = nodepath.parse(outFile);
        const tmpFold = nodepath.normalize(nodepath.join(settings.ytdlpTmpOut === '' ? outFPath.dir : settings.ytdlpTmpOut, 'sharedownTmp'));
        const filename = outFPath.base;
        const tmpOutFile = nodepath.join(tmpFold, filename);
        const args = ['--no-part', '-N', settings.ytdlpN.toString(), '-o', tmpOutFile, '-v', videoData.m];

        rmSync(tmpFold);
        nodefs.mkdirSync(tmpFold);

        isDownloadStopped = false;
        downloaderProcess = nodechildproc.spawn('yt-dlp', args);

        downloaderProcess.stdout.on('data', data => onYtdlpData(data, e.sender));
        downloaderProcess.stderr.on('data', data => writeLog(data.toString()));

        downloaderProcess.on('close', (code) => {
            const isAborted = isDownloadStopped || code === null;

            try {
                if (code !== 0) {
                    e.sender.send('downloadProg', 0);
                    throw new Error("Exit code: " + (isAborted ? "aborted" : code));
                }

                const files = nodefs.readdirSync(tmpFold);
                let found = false;

                for (const f of files) {
                    if (!f.includes(filename))
                        continue;

                    nodefs.copyFileSync(tmpOutFile, outFile);
                    found = true;
                    break;
                }

                if (!found)
                    throw new Error(`Cannot find video file in output folder!\n\nSrc:\n${tmpOutFile}\n\nDest:\n${outFile}`);

                e.sender.send('downloadSuccess');

            } catch (e) {
                if (!isAborted && settings.keepYtdlpTmpOnFail)
                    saveYtdlpTempFragsFolder(tmpFold, filename);

                writeLog(`YT-dlp: download failed:\n${e.message}`);

                if (!isAborted)
                    e.sender.send('downloadFail', `YT-dlp error:\n\n${e.message}`);

            } finally {
                rmSync(tmpFold);
                downloaderProcess = null;
            }
        });

        return true;

    } catch (e) {
        showErrorMessage(e.message);
    }

    return false;
}

function stopDownload() {
    if (downloaderProcess === null)
        return;

    try {
        isDownloadStopped = true;

        if (isWindows) {
            nodechildproc.spawn('taskkill', ['/pid', downloaderProcess.pid, '/f', '/t']);

        } else if (!downloaderProcess.kill()) {
            throw new Error('Failed to send kill signal to download process');
        }

        downloaderProcess = null;

    } catch (e) {
        writeLog(`stopDownload: error\n${e.message}`);
        showErrorMessage(e.message);
    }
}

app.whenReady().then(() => {
    ipcMain.on('quit', () => app.quit());
    ipcMain.on('clipboard', (e, txt) => clipboard.writeText(txt));
    ipcMain.on('writeAppSett', (e, data) => writeFileToDisk(data, settingsPath, 'Failed to write settings'));
    ipcMain.on('writeAppState', (e, data) => writeFileToDisk(data, statePath, 'Failed to write state'));
    ipcMain.on('rmUserdataDir', () => rmSync(chromeUserdataPath));
    ipcMain.on('openLogsFolder', openLogFolder);
    ipcMain.on('enableLog', enableLog);
    ipcMain.on('disableLog', disableLog);
    ipcMain.on('writeLog', (e, msg) => writeLog(msg));
    ipcMain.on('setShowDlInfo', (e, enable) => {showDownlInfo = enable});
    ipcMain.on('stopDownload', stopDownload);

    ipcMain.handle('errorMessage', (e, msg) => showErrorMessage(msg));
    ipcMain.handle('folderDialog', selectFolderDialog);
    ipcMain.handle('browserDialog', selectBrowserDialog);
    ipcMain.handle('loadAppSett', () => readFileFromDisk(settingsPath, 'Failed to load settings'));
    ipcMain.handle('loadAppState', () => readFileFromDisk(statePath, 'Failed to load state'));
    ipcMain.handle('defaultDownloadPath', getDefaultDownloadPath);
    ipcMain.handle('hasFfmpeg', hasFFmpeg);
    ipcMain.handle('hasYtdlp', hasYTdlp);
    ipcMain.handle('makeOutDir', (e, path) => makeOutputDirectory(path));
    ipcMain.handle('getUrlListFromFold', getURLListFromFolder);
    ipcMain.handle('getVideoData', (e, video, settings) => getVideoData(video, settings));
    ipcMain.handle('getUniqueOutFilePath', (e, outFolder, fileName) => getUniqueOutputFilePath(outFolder, fileName));
    ipcMain.handle('ffmpegDownload', ffmpegDownload);
    ipcMain.handle('ytdlpDownload', ytdlpDownload);

    mainWindow = createWindow();
    Menu.setApplicationMenu(null);

    app.on('activate', function() {
        if (BrowserWindow.getAllWindows().length === 0)
            mainWindow = createWindow();
    });
});

app.on('window-all-closed', function() {
    if (process.platform !== 'darwin')
        app.quit()
});
