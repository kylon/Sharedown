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

const {contextBridge, ipcRenderer, shell} = require('electron');
const nodepath = require("node:path");
const nodefs = require("node:fs");
const puppy = require("puppeteer");
const SHDMainCMD = require('./sharedown/enums/shdMainCMD');
const MessageType = require('./sharedown/enums/messageType');
const isDebug = false;
const isWindows = process.platform === 'win32';
const builtinChromePath = getChromePath();
const appDataPath = `${sendMainIPC({cmd: SHDMainCMD.AppDataPath})}/Sharedown`;
const logsPath = nodepath.join(appDataPath, 'logs');
const settingsPath = nodepath.join(appDataPath, 'sharedown.sett');
const statePath = nodepath.join(appDataPath, 'sharedown.state');
const chromeUserdataPath = nodepath.join(appDataPath, 'data');
let puppyBrowser = null;
let logFd = null;
let showDownlInfo = false;
let isDownloadStopped = false;
let downloaderProcess = null;

if (process.platform === 'darwin') // macOS PATH workaround
    process.env.PATH = `./node_modules/.bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`;

function getChromePath() {
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
    const osPaths = nodefs.readdirSync(builtinPath).filter(itm => {
        if (isLinux)
            return itm.startsWith('linux-');
        else if (isMacOS)
            return itm.startsWith('mac-') || itm.startsWith('mac_');
        else if (isWindows)
            return itm.startsWith('win64-');
        else
            return false;
    });

    if (osPaths.length === 0)
        return '';

    const exePaths = nodefs.readdirSync(nodepath.join(builtinPath, osPaths[0])).filter(itm => {
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
    });

    if (exePaths.length === 0)
        return '';

    return nodepath.join(basePath, osPaths[0], exePaths[0], name);
}

function sendMainIPC(obj) {
    return ipcRenderer.sendSync('shdipcmain', obj);
}

function unlinkSync(path) {
    if (nodefs.existsSync(path))
        nodefs.unlinkSync(path);
}

function rmSync(path, recursive = true) {
    if (nodefs.existsSync(path))
        nodefs.rmSync(path, {recursive: recursive, force: true});
}

function deleteUserdataFold() {
    rmSync(chromeUserdataPath);
}

function openLogFolder() {
    shell.openPath(logsPath).then(res => {
        if (res !== '')
            showMessage(MessageType.Error, res);
    });
}

async function openLink(l) {
    await shell.openExternal(l);
}

function hasFFmpeg() {
    const proc = require('node:child_process');

    try {
        proc.execSync('ffmpeg -version');
        return true;

    } catch (e) {}

    return false;
}

function hasYTdlp() {
    const proc = require('node:child_process');

    try {
        proc.execSync('yt-dlp --help', {stdio: 'ignore'});
        return true;

    } catch (e) {}

    return false;
}

function showMessage(msgType, msg) {
    return sendMainIPC({
        cmd: SHDMainCMD.MessageBox,
        type: msgType,
        content: msg
    });
}

function quitApp() {
    sendMainIPC({cmd: SHDMainCMD.QuitApp});
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
        showMessage(MessageType.Error, `Failed to enable logging\n${e.message}`);
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
        showMessage(MessageType.Error, `Failed to disable logging\n${e.message}`);
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

function copyURLToClipboard(url) {
    sendMainIPC({cmd: SHDMainCMD.Clipboard, str: url});
}

function isShowDlInfoSet() {
    return showDownlInfo;
}

function setShowDlInfo(enable) {
    showDownlInfo = enable;
}

function writeFileToDisk(data, path, erMsg) {
    try {
        if (!nodefs.existsSync(appDataPath))
            nodefs.mkdirSync(appDataPath, {recursive: true});

        if (!nodefs.existsSync(appDataPath))
            return false;

        nodefs.writeFileSync(path, data, 'utf8');
        return true;

    } catch (e) {
        showMessage(MessageType.Error, `${erMsg}\n${e.message}`);
    }

    return false;
}

function readFileFromDisk(path, erMsg) {
    try {
        if (!nodefs.existsSync(path))
            return '';

        return nodefs.readFileSync(path, 'utf8');

    } catch (e) {
        showMessage(MessageType.Error, `${erMsg}\n${e.message}`);
    }

    return '';
}

function selectFolderDialog() {
    return sendMainIPC({cmd: SHDMainCMD.OutputDirDialog});
}

function selectCustomBrowserDialog() {
    return sendMainIPC({cmd: SHDMainCMD.CustomBrowserDialog});
}

function setYTdlpProgressForDirect(rexMatch, videoProgBar) {
    const perc = Math.floor(parseInt(rexMatch[1], 10));

    videoProgBar.style.width = perc > 100 ? '100%' : `${perc}%`;
}

function setYTdlpProgressForManifest(rexMatch, videoProgBar) {
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

function saveAppSettings(data) {
    return writeFileToDisk(data, settingsPath, "Unable to save Sharedown settings");
}

function loadAppSettings() {
    return readFileFromDisk(settingsPath, "Unable to load Sharedown settings");
}

function saveAppState(data) {
    return writeFileToDisk(data, statePath, "Unable to save Sharedown state");
}

function loadAppState() {
    return readFileFromDisk(statePath, "Unable to load Sharedown state");
}

function getDefaultDownloadPath() {
    return nodepath.normalize(sendMainIPC({cmd: SHDMainCMD.DownloadPath}))
}

function makeOutputDirectory(opath) {
    try {
        opath = opath === '' ? getDefaultDownloadPath() : nodepath.normalize(opath);

        if (!nodefs.existsSync(opath))
            nodefs.mkdirSync(opath, {recursive: true});

        return nodefs.existsSync(opath);

    } catch (e) {
        showMessage(MessageType.Error, e.message);
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
        const dataPath = nodepath.normalize(`${appDataPath}/data`);

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

function getFolderListInFolder(pageContent) {
    const pre = new DOMParser().parseFromString(pageContent, 'text/html').body.getElementsByTagName('pre');
    const ret = [];
    let xmlDoc;

    if (pre.length === 0) {
        writeLog(`getFoldersListInFolder: Unexpected API result:\n${pageContent}`);
        return [];
    }

    xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');

    for (const entry of xmlDoc.querySelectorAll('entry')) {
        const foldName = entry.querySelector('content').getElementsByTagName('d:Name');

        if (foldName.length === 0) {
            writeLog(`getFoldersListInFolder: No name found for folder item:\n${entry.innerHTML}`);
            continue;
        }

        ret.push(foldName[0].textContent);
    }

    return ret;
}

async function getVideosInFold(puppyPage, pageURL, recursive) {
    const urlOrigin = new URL(pageURL).origin;
    let videoList = [];
    let pageCont;
    let xmlDoc;
    let pre;

    if (recursive) {
        await puppyPage.goto(makeFolderApiURL(pageURL, 'Folders'), {waitUntil: 'domcontentloaded'});

        for (const folder of getFolderListInFolder(await puppyPage.content()))
            videoList.push(...(await getVideosInFold(puppyPage, `${pageURL}/${folder}`, recursive)));
    }

    await puppyPage.goto(makeFolderApiURL(pageURL, 'Files'), {waitUntil: 'domcontentloaded'});

    pageCont = await puppyPage.content();
    pre = new DOMParser().parseFromString(pageCont, 'text/html').body.getElementsByTagName('pre');

    if (pre.length === 0) {
        writeLog(`getVideosInFold: Unexpected API result:\n${pageCont}`);
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
            writeLog(`getVideosInFold: No URL for this entry:\n${entry.innerHTML}`);
            continue;
        }

        relUrl = relUrlElm[0].textContent;
        fileExt = nodepath.extname(relUrl);

        if (fileExt !== '.mp4') {
            writeLog(`getVideosInFold: unhandled file format: ${fileExt}`);
            continue;
        }

        videoList.push({
            url: `${urlOrigin}${relUrl}`,
            created: timeCreatedElm.length === 0 ? 0 : new Date(timeCreatedElm[0].textContent).getTime(),
            lastModf: timeLastModfElm.length === 0 ? 0 : new Date(timeLastModfElm[0].textContent).getTime()
        });
    }

    return videoList;
}

async function getURLListFromFolder(folderList, recursive, sortType, settings) {
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

            videoList.push(...(await getVideosInFold(page, `${urlObj.origin}${urlObj.pathname}`, recursive)));
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
        showMessage(MessageType.Error, e.message);
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
        showMessage(MessageType.Error, e.message);
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

async function getVideoDuration(manifestFetchURL) {
    const iso8601Parse = require('iso8601-duration');
    const axios = require('axios');
    const parser = new DOMParser();
    const resp = await axios.get(manifestFetchURL);
    const manifest = parser.parseFromString(resp.data, 'text/xml');
    const rawDuration = manifest.getElementsByTagName('MPD')[0].getAttribute('mediaPresentationDuration');
    const duration = iso8601Parse.parse(rawDuration);

    return Math.ceil(iso8601Parse.toSeconds(duration));
}

async function downloadWithFFmpeg(videoData, video, outFile) {
    try {
        const {FFmpegCommand, FFmpegInput, FFmpegOutput} = require('fessonia')();
        const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
        const videoProgBarTx = videoProgBar.parentNode.querySelector('.progtext');
        const ffmpegInput = new FFmpegInput(videoData.m);
        const ffmpegOutput = new FFmpegOutput(outFile, new Map([
            ['c:v', 'copy'],
            ['c:a', 'copy'],
            ['crf', '26']
        ]));
        const ffmpegCmd = new FFmpegCommand();
        const totalTime = await getVideoDuration(videoData.m);

        ffmpegCmd.addInput(ffmpegInput);
        ffmpegCmd.addOutput(ffmpegOutput);

        isDownloadStopped = false;

        ffmpegCmd.on('update', (data) => {
            if (isDownloadStopped)
                return;

            const sec = Math.floor(data.out_time_ms / 1000);
            const prog = Math.floor((sec / totalTime) * 100);

            videoProgBar.style.width = prog >= 100 ? '100%' : `${prog}%`;

            if (showDownlInfo)
                videoProgBarTx.textContent = `frame: ${data.frame}, speed: ${data.speed}, estimated time: ${sec}`;
        });

        ffmpegCmd.on('success', (data) => {
            if (data.exitCode === 0) {
                window.dispatchEvent(new CustomEvent('DownloadSuccess'));

            } else {
                window.dispatchEvent(new CustomEvent('DownloadFail', {detail: `Exit code: ${data.exitCode}`}));
                writeLog(`FFMPEG: download filed: exit code ${data.exitCode}`);
            }
        });

        ffmpegCmd.on('error', (err) => {
            try {
                unlinkSync(outFile);

            } catch (e) {
                writeLog(`ffmpegCmd.on(error):\n${e.message}`);
                showMessage(MessageType.Error, e.message);
            }

            if (!err.message.includes('Exiting normally, received signal 15')) {
                window.dispatchEvent(new CustomEvent('DownloadFail', {detail: err}));
                writeLog(`ffmpegCmd.on(error):\n${err.log}`);
            }
        });

        downloaderProcess = ffmpegCmd.spawn();
        return true;

    } catch (e) {
        writeLog(`FFmpeg: error\n${e.message}`);
        showMessage(MessageType.Error, e.message);
    }

    return false;
}

function downloadWithYtdlp(videoData, video, outFile, settings) {
    const {spawn} = require('node:child_process');

    try {
        const videoProgBar = document.querySelector(`[data-video-id="${video.id}"]`).querySelector('.progress-bar');
        const videoProgBarTx = videoProgBar.parentNode.querySelector('.progtext');
        const args = ['--no-part'];
        const isDirect = videoData.c !== null;
        let tmpFold = null;
        let tmpOutFile = null;
        let filename = null;

        isDownloadStopped = false;

        if (!isDirect) {
            const outFPath = nodepath.parse(outFile);
            const outFolder = settings.ytdlpTmpOut === '' ? outFPath.dir : settings.ytdlpTmpOut;

            filename = outFPath.base;
            tmpFold = nodepath.normalize(nodepath.join(outFolder, 'sharedownTmp'));
            tmpOutFile = nodepath.normalize(nodepath.join(tmpFold, filename));

            rmSync(tmpFold);
            nodefs.mkdirSync(tmpFold);
            args.push('-N', settings.ytdlpN.toString(), '-o', tmpOutFile, '-v', videoData.m);

        } else {
            const cookieH = `Cookie: FedAuth=${videoData.c.fedauth}; rtFa=${videoData.c.rtfa}`;

            args.push('-N', settings.directN.toString(), '--add-header', cookieH, '-o', outFile, (new URL(videoData.m)).toString());
        }

        videoProgBar.setAttribute('data-tmp-perc', '0');

        downloaderProcess = spawn('yt-dlp', args);

        downloaderProcess.stdout.on('data', (data) => {
            if (isDownloadStopped)
                return;

            const out = data.toString();
            const isProgress = out.includes('[download]');
            const match = out.match(/\s(\d+.\d+)%\s.*/);

            writeLog(out);

            if (!isProgress || match === null || match.length < 2)
                return;

            if (isDirect)
                setYTdlpProgressForDirect(match, videoProgBar);
            else
                setYTdlpProgressForManifest(match, videoProgBar);

            if (showDownlInfo)
                videoProgBarTx.textContent = match[0];
        });

        downloaderProcess.stderr.on('data', (data) => {
            writeLog(data.toString());
        });

        downloaderProcess.on('close', (code) => {
            const isAborted = isDownloadStopped || code === null;

            try {
                if (code !== 0) {
                    videoProgBar.style.width = '0%';
                    throw new Error("Exit code: " + (isAborted ? "aborted" : code));
                }

                if (!isDirect) {
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
                }

                window.dispatchEvent(new CustomEvent('DownloadSuccess'));

            } catch (e) {
                if (isDirect)
                    unlinkSync(outFile);
                else if (!isAborted && settings.keepYtdlpTmpOnFail)
                    saveYtdlpTempFragsFolder(tmpFold, filename);

                writeLog(`YT-dlp: download failed:\n${e.message}`);

                if (!isAborted)
                    window.dispatchEvent(new CustomEvent('DownloadFail', {detail: `YT-dlp error:\n\n${e.message}`}));

            } finally {
                rmSync(tmpFold);
                downloaderProcess = null;
            }
        });

        return true;

    } catch (e) {
        showMessage(MessageType.Error, e.message);
    }

    return false;
}

function stopDownload() {
    if (downloaderProcess === null)
        return;

    try {
        isDownloadStopped = true;

        if (isWindows) {
            const {spawn} = require('node:child_process');

            spawn('taskkill', ['/pid', downloaderProcess.pid, '/f', '/t']);

        } else if (!downloaderProcess.kill()) {
            throw new Error('Failed to send kill signal to download process');
        }

        downloaderProcess = null;

    } catch (e) {
        writeLog(`stopDownload: error\n${e.message}`);
        showMessage(MessageType.Error, e.message);
    }
}

contextBridge.exposeInMainWorld('sharedown', {
    enums: {
        MessageType: MessageType
    },
    deleteUserdataFold,
    openLogFolder,
    openLink,
    hasFFmpeg,
    hasYTdlp,
    showMessage,
    quitApp,
    enableLog,
    disableLog,
    writeLog,
    copyURLToClipboard,
    isShowDlInfoSet,
    setShowDlInfo,
    selectFolderDialog,
    selectCustomBrowserDialog,
    saveAppSettings,
    loadAppSettings,
    saveAppState,
    loadAppState,
    getDefaultDownloadPath,
    makeOutputDirectory,
    getURLListFromFolder,
    getVideoData,
    getUniqueOutputFilePath,
    downloadWithFFmpeg,
    downloadWithYtdlp,
    stopDownload
});
