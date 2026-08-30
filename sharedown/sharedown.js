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

const electron = window.sharedown;
const globalSettings = {
    version: 19,
    outputPath: '',
    downloader: 'yt-dlp',
    ytdlpTmpOut: '',
    keepYtdlpTmpOnFail: false,
    ytdlpN: 4,
    directN: 4,
    retryOnFail: false,
    userdataFold: false,
    logging: false,
    customChromePath: '',
    keepBrowserOpen: false,
};
let objCache = {};

function makeObjCache() {
    const settModal = document.getElementById('sharedownsett');

    return {
        downQueObj: new downloadQue(),
        downloading: null,
        downloadingProgBar: null,
        downloadingProgBarTx: null,
        downloadingOutPath: '',
        showDetailedProgress: false,
        template: document.getElementById('videoitem').content,
        addVideoURLsList: document.getElementById('vurlslist'),
        addURLsModalInstance: new bootstrap.Modal(document.getElementById('urlsaddmodal')),
        importURLsFoldList: document.getElementById('furlslist'),
        importURLsFoldModalInstance: new bootstrap.Modal(document.getElementById('foldimportmodal')),
        settingsModal: settModal,
        settingsDownldrOpts: settModal.querySelectorAll('.downldr-opt'),
        settingsModalSaveMsg: new Notification(settModal.querySelector('#gsett-succ-str')),
        downlStartBtn: document.getElementById('start-dwnl'),
        downlStopBtn: document.getElementById('stop-dwnl'),
        downQueElm: document.getElementById('dque'),
        queLenElm: document.getElementById('quelen'),
        completeCElm: document.getElementById('completec'),
        loadingScr: document.getElementById('loadingscr'),
        bodyElm: document.querySelector('body')
    };
}

async function selectOutputFolderDialog(elm) {
    const path = await electron.selectFolderDialog();

    if (path === '')
        return;

    const inpt = elm.parentElement.querySelector('.outpath');

    inpt.value = path[0];
    inpt.setAttribute('title', path[0]);
}

async function selectCustomBrowserDialog(elm) {
    const path = await electron.selectCustomBrowserDialog();

    if (path === '')
        return;

    const inpt = elm.parentElement.querySelector('.binpath');

    inpt.value = path[0];
    inpt.setAttribute('title', path[0]);
}

function toggleLoadingScr() {
    objCache.loadingScr.classList.toggle('d-none');
    objCache.bodyElm.classList.toggle('overflow-hidden');
}

function updateStartButtonState() {
    if (objCache.downQueObj.hasNext())
        objCache.downlStartBtn.classList.remove('btn-disabled');
    else
        objCache.downlStartBtn.classList.add('btn-disabled');
}

function unlockUIElemsForDownload() {
    updateStartButtonState();
    objCache.downlStopBtn.classList.add('btn-disabled');
    objCache.settingsModal.querySelector('#delchdfold').removeAttribute('disabled');
    objCache.settingsModal.querySelector('#downlrun-setalr').classList.add('d-none');
}

function lockUIElemsForDownload() {
    objCache.downlStartBtn.classList.add('btn-disabled');
    objCache.downlStopBtn.classList.remove('btn-disabled');
    objCache.settingsModal.querySelector('#delchdfold').setAttribute('disabled', '');
    objCache.settingsModal.querySelector('#downlrun-setalr').classList.remove('d-none');
}

function toggleDownloaderSettingsUI(selectedDownloader) {
    for (const opt of objCache.settingsDownldrOpts) {
        if (opt.classList.contains(`${selectedDownloader}-opt`))
            opt.classList.remove('d-none');
        else
            opt.classList.add('d-none');
    }
}

function isValidURL(url) {
    return url !== '' && url.includes('sharepoint') && url.substring(0, 8) === 'https://';
}

function setAsWebPlayerURL(url) {
    const urlObj = new URL(url);

    if (urlObj.searchParams.get('web') === null)
        urlObj.searchParams.set('web', '1');

    return urlObj.href;
}

function getYtdlpNVal(n) {
    return Math.min(Math.max(parseInt(n, 10), 1), 4);
}

function addVideoURLs() {
    const text = objCache.addVideoURLsList.value.trim();
    const list = text.split(/\r?\n/);
    const invalid = [];

    if (text === '' || list.length === 0)
        return;

    toggleLoadingScr();

    for (const url of list) {
        const _url = url.replaceAll('#', '%23');

        if (!isValidURL(_url)) {
            invalid.push(url);
            continue;
        }

        const vid = new video(setAsWebPlayerURL(_url));

        addVideoToUI(vid);
        objCache.downQueObj.addVideo(vid);
    }

    if (invalid.length > 0) {
        objCache.addVideoURLsList.value = invalid.join('\n');
        electron.showErrorMessage('Some URLs were invalid and they were skipped');

    } else {
        objCache.addVideoURLsList.value = '';
        objCache.addURLsModalInstance.hide();
    }

    exportAppState();
    updateStartButtonState();
    toggleLoadingScr();
}

async function importURLsFromFolder() {
    const text = objCache.importURLsFoldList.value.trim();
    const folderList = text.split(/\r?\n/);

    if (text === '' || folderList.length === 0)
        return;

    toggleLoadingScr();

    const curSettings = Object.assign({}, globalSettings);
    const recursive = document.getElementById('importfoldsubfolds').checked;
    const urlsSortType = parseInt(document.getElementById('importfoldurlssort').value, 10);
    const invalid = [];
    let urlList;

    for (const folderURL of folderList) {
        if (!isValidURL(folderURL))
            invalid.push(folderURL);
    }

    for (const inv of invalid)
        folderList.splice(folderList.indexOf(inv), 1);

    urlList = await electron.getURLListFromFolder(folderList, recursive, urlsSortType, curSettings);

    if (urlList === null || urlList.length === 0) {
        toggleLoadingScr();
        return;
    }

    for (const url of urlList)
        objCache.addVideoURLsList.value += `${url}\n`;

    objCache.importURLsFoldList.value = '';

    if (invalid.length > 0) {
        objCache.importURLsFoldList.value = invalid.join('\n');

        electron.showErrorMessage('Some URLs were invalid and they were skipped');

    } else {
        objCache.importURLsFoldModalInstance.hide();
        objCache.addURLsModalInstance.show();
    }

    toggleLoadingScr();
}

function addVideoToUI(vid) {
    const node = objCache.template.cloneNode(true);
    const progBar = node.querySelector('.shdprogbar');
    const span = progBar.querySelector('span');
    const copyURLBtn = node.querySelector('.copy-btn');
    const children = objCache.downQueElm.children;
    let firstComplete = null;

    span.textContent = vid.url;
    span.setAttribute('title', vid.url);
    copyURLBtn.setAttribute('data-vurl', vid.url);
    progBar.addEventListener('click', e => toggleDownloadStats(e.currentTarget.querySelector('span')));
    node.querySelector('.input-group').setAttribute('data-video-id', vid.id);
    node.querySelector('.deque-btn').addEventListener('click', e => removeVideoFromQue(e.currentTarget));
    copyURLBtn.addEventListener('click', e => electron.copyURLToClipboard(e.currentTarget.getAttribute('data-vurl')));

    for (const n of children) {
        if (!n.querySelector('.progress-bar').classList.contains('w-100'))
            continue;

        firstComplete = n;
        break;
    }

    if (firstComplete === null)
        objCache.downQueElm.appendChild(node);
    else
        objCache.downQueElm.insertBefore(node, firstComplete);

    objCache.queLenElm.textContent = (parseInt(objCache.queLenElm.textContent, 10) + 1).toString(10);
}

function toggleDownloadStats(elem) {
    const vid = parseInt(elem.parentElement.parentElement.getAttribute('data-video-id'), 10);

    if (vid !== objCache.downloading?.id)
        return;

    if (!objCache.showDetailedProgress) {
        elem.setAttribute('data-original-text', elem.textContent);
        electron.setShowDlInfo(true);

        objCache.showDetailedProgress = true;
        elem.textContent = 'Waiting for download data..';

    } else {
        const origText = elem.getAttribute('data-original-text');

        electron.setShowDlInfo(false);
        objCache.showDetailedProgress = false;
        elem.textContent = origText === '' || origText === null ? 'Error: no text':origText;
    }
}

function updateDownloadProgress(progress) {
    if (objCache.downloading === null || objCache.downloadingProgBar === null)
        return;

    const perc = Math.max(0, progress);

    objCache.downloadingProgBar.style.width = perc > 100 ? '100%' : `${progress}%`;
}

function updateDetailedDownloadInfo(text) {
    if (objCache.downloading === null || objCache.downloadingProgBarTx === null)
        return;

    objCache.downloadingProgBarTx.textContent = text;
}

function removeVideoFromQue(removeBtn) {
    if (removeBtn.classList.contains('btn-disabled'))
        return;

    const parent = removeBtn.parentElement;
    const newQueLen = parseInt(objCache.queLenElm.textContent, 10) - 1;

    toggleLoadingScr();

    if (parent.querySelector('.progress-bar').classList.contains('w-100')) {
        const newComplC = parseInt(objCache.completeCElm.textContent, 10) - 1;

        objCache.completeCElm.textContent = (newComplC < 0 ? 0 : newComplC).toString(10);

    } else {
        objCache.queLenElm.textContent = (newQueLen < 0 ? 0 : newQueLen).toString(10);
    }

    objCache.downQueObj.remove(parent.getAttribute('data-video-id'));
    parent.parentElement.remove();
    exportAppState();
    updateStartButtonState();
    toggleLoadingScr();
}

function loadGlobalSettings() {
    const outdir = objCache.settingsModal.querySelector('#soutdirp');
    const ytdlpTmpOutD = objCache.settingsModal.querySelector('#ytdlptmpdp');

    if (globalSettings.logging)
        electron.enableLog()
    else
        electron.disableLog();

    outdir.setAttribute('title', globalSettings.outputPath);
    ytdlpTmpOutD.setAttribute('title', globalSettings.ytdlpTmpOut);

    outdir.value = globalSettings.outputPath;
    ytdlpTmpOutD.value = globalSettings.ytdlpTmpOut;
    objCache.settingsModal.querySelector('#shddownloader').value = globalSettings.downloader;
    objCache.settingsModal.querySelector('#ytdlpn').value = globalSettings.ytdlpN;
    objCache.settingsModal.querySelector('#keeptmponfail').checked = globalSettings.keepYtdlpTmpOnFail;
    objCache.settingsModal.querySelector('#directn').value = globalSettings.directN;
    objCache.settingsModal.querySelector('#chuserdata').checked = globalSettings.userdataFold;
    objCache.settingsModal.querySelector('#shlogs').value = globalSettings.logging ? '1':'0';
    objCache.settingsModal.querySelector('#retryonfail').checked = globalSettings.retryOnFail;
    objCache.settingsModal.querySelector('#cuschromep').value = globalSettings.customChromePath;
    objCache.settingsModal.querySelector('#keepbrowopen').checked = globalSettings.keepBrowserOpen;

    toggleDownloaderSettingsUI(globalSettings.downloader);
}

async function saveGlobalSettings() {
    toggleLoadingScr();

    globalSettings.outputPath = objCache.settingsModal.querySelector('#soutdirp').value;
    globalSettings.ytdlpTmpOut = objCache.settingsModal.querySelector('#ytdlptmpdp').value;
    globalSettings.userdataFold = objCache.settingsModal.querySelector('#chuserdata').checked;
    globalSettings.retryOnFail = objCache.settingsModal.querySelector('#retryonfail').checked;
    globalSettings.downloader = objCache.settingsModal.querySelector('#shddownloader').value;
    globalSettings.ytdlpN = getYtdlpNVal(objCache.settingsModal.querySelector('#ytdlpn').value);
    globalSettings.keepYtdlpTmpOnFail = objCache.settingsModal.querySelector('#keeptmponfail').checked;
    globalSettings.directN = getYtdlpNVal(objCache.settingsModal.querySelector('#directn').value);
    globalSettings.logging = objCache.settingsModal.querySelector('#shlogs').value === '1';
    globalSettings.customChromePath = objCache.settingsModal.querySelector('#cuschromep').value;
    globalSettings.keepBrowserOpen = objCache.settingsModal.querySelector('#keepbrowopen').checked;

    if (globalSettings.logging)
        electron.enableLog()
    else
        electron.disableLog();

    exportAppSettings();
    toggleLoadingScr();
    objCache.settingsModalSaveMsg.show();
}

function exportAppSettings() {
    electron.saveAppSettings(JSON.stringify(globalSettings));
}

async function importAppSettings() {
    const sett = await electron.loadAppSettings();

    if (sett === '')
        return;

    const data = JSON.parse(sett);

    globalSettings.outputPath = data.outputPath ?? '';
    globalSettings.ytdlpTmpOut = data.ytdlpTmpOut ?? '';
    globalSettings.userdataFold = data.userdataFold ?? false;
    globalSettings.retryOnFail = data.retryOnFail ?? false;
    globalSettings.downloader = data.downloader ?? 'yt-dlp';
    globalSettings.ytdlpN = getYtdlpNVal(data.ytdlpN ?? 4);
    globalSettings.keepYtdlpTmpOnFail = data.keepYtdlpTmpOnFail ?? false;
    globalSettings.directN = getYtdlpNVal(data.directN ?? 4);
    globalSettings.logging = data.logging ?? false;
    globalSettings.customChromePath = data.customChromePath ?? '';
    globalSettings.keepBrowserOpen = data.keepBrowserOpen ?? false;

    if (data['version'] < globalSettings['version'])
        exportAppSettings(); // update settings version
}

function exportAppState() {
    const data = {
        downque: objCache.downQueObj.exportDownloadQue(),
        downloading: JSON.stringify(objCache.downloading)
    }

    electron.saveAppState(JSON.stringify(data));
}

async function importAppState() {
    const json = await electron.loadAppState();

    if (json === '')
        return;

    try {
        const data = JSON.parse(json);

        data['downque'].push(data['downloading'])

        if (!objCache.downQueObj.importDownloadQue(data['downque']))
            electron.showErrorMessage('Some URLs could not be loaded');

        for (const v of objCache.downQueObj.getQue())
            addVideoToUI(v);

    } catch (e) {
        electron.showErrorMessage(`Failed to load app state from disk.\n\n${e.message}`)
    }
}

async function downloadVideo(videoElem) {
    return new Promise(async (res, rej) => {
        const curSettings = Object.assign({}, globalSettings);
        let vdata;
        let ret;

        videoElem.querySelector('.deque-btn').classList.add('btn-disabled');

        if (!(await electron.makeOutputDirectory(curSettings.outputPath)))
            return rej();

        toggleLoadingScr();
        vdata = await electron.getVideoData(objCache.downloading, curSettings);
        toggleLoadingScr();

        if (vdata !== null)
            electron.writeLog('has vdata');
        else
            return rej();

        if (vdata.t === '') { // unnamed video ??, give it a name and try to download
            vdata.t = `sharedownVideo${vdata.id}`;

            electron.writeLog(`video has empty title!? new title: ${vdata.t}`);
        }

        // generate output file path (apply user settings, if any)
        objCache.downloadingOutPath = await electron.getUniqueOutputFilePath(curSettings.outputPath, vdata.t);

        if (curSettings.downloader === 'ffmpeg')
            ret = await electron.ffmpegDownload(vdata, objCache.downloading, objCache.downloadingOutPath);
        else
            ret = await electron.ytdlpDownload(vdata, objCache.downloading, objCache.downloadingOutPath, curSettings);

        return !ret ? rej() : res();
    });
}

async function startDownload() {
    electron.writeLog('startDownload: start');

    if (objCache.downlStartBtn.classList.contains('btn-disabled')) {
        electron.writeLog('startDownload: button is disabled');
        return;

    } else if (!objCache.downQueObj.hasNext()) {
        electron.writeLog('startDownload: queue is empty');
        return;
    }

    const nextVid = objCache.downQueObj.getNext();
    const videoElem = document.querySelector(`[data-video-id="${nextVid.id}"]`);

    objCache.downloading = nextVid;
    objCache.downloadingProgBar = videoElem.querySelector('.progress-bar');
    objCache.downloadingProgBarTx = objCache.downloadingProgBar.parentNode.querySelector('.progtext');

    downloadVideo(videoElem).then(() => {
        lockUIElemsForDownload();
        electron.writeLog(`startDownload: selected ${objCache.downloading.id}`);

    }).catch((e) => {
        videoElem.querySelector('.deque-btn').classList.remove('btn-disabled');
        objCache.downQueObj.reinsert(objCache.downloading); // add back video to que
        electron.stopDownload();
        electron.writeLog(`startDownload: failed\n${e?.message}`);

        objCache.downloading = null;
    });
}

function stopDownload() {
    electron.writeLog('stopDownload: called');

    if (objCache.downlStopBtn.classList.contains('btn-disabled')) {
        electron.writeLog('stopDownload: button is disabled');
        return;
    }

    toggleLoadingScr();

    const videoElem = document.querySelector(`[data-video-id="${objCache.downloading.id}"]`);

    electron.stopDownload();
    unlockUIElemsForDownload();
    videoElem.querySelector('.deque-btn').classList.remove('btn-disabled');
    objCache.downQueObj.reinsert(objCache.downloading); // add back video to que

    if (objCache.showDetailedProgress)
        toggleDownloadStats(videoElem.querySelector('span'));

    objCache.downloading = null;
    videoElem.querySelector('.progress-bar').style.width = '0%';

    toggleLoadingScr();
}

function downloadSuccess() {
    const videoElm = document.querySelector(`[data-video-id="${objCache.downloading.id}"]`);
    const newQueLen = parseInt(objCache.queLenElm.textContent, 10) - 1;

    electron.writeLog(`DownloadSuccess event for ${objCache.downloading.id}`);

    if (objCache.showDetailedProgress)
        toggleDownloadStats(videoElm.querySelector('span'));

    unlockUIElemsForDownload();
    videoElm.querySelector('.deque-btn').classList.remove('btn-disabled');
    videoElm.querySelector('.progress-bar').classList.add('w-100');
    objCache.downQueElm.appendChild(videoElm.parentElement);

    objCache.completeCElm.textContent = (parseInt(objCache.completeCElm.textContent, 10) + 1).toString(10);
    objCache.queLenElm.textContent = (newQueLen < 0 ? 0 : newQueLen).toString(10);
    objCache.downloading = null;

    exportAppState();
    updateStartButtonState();
    startDownload(); // start next download, if any
}

function downloadFail(error) {
    electron.writeLog(`DownloadFail event:\n${error}`);

    if (globalSettings.retryOnFail && objCache.downloading instanceof video) {
        const videoElem = document.querySelector(`[data-video-id="${objCache.downloading.id}"]`);

        if (objCache.showDetailedProgress)
            toggleDownloadStats(videoElem.querySelector('span'));

        objCache.downQueObj.reinsert(objCache.downloading); // add back video to que
        videoElem.querySelector('.progress-bar').style.width = '0%';
        unlockUIElemsForDownload();
        objCache.downloading = null;

        startDownload();

    } else {
        stopDownload();
        electron.showErrorMessage(`Download failed.\n\n${error}`);
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    objCache = makeObjCache();

    electron.deleteUserdataFold(); // if for some reason the quit event failed, delete now

    if (!(await electron.hasFFmpeg()) || !(await electron.hasYTdlp())) {
        await electron.showErrorMessage('ffmpeg or yt-dlp is not installed, check sharedown wiki for instructions.\nApplication will now close.');
        electron.quitApp();
        return;
    }

    await importAppSettings();
    await importAppState();
    loadGlobalSettings();
    updateStartButtonState();

    document.getElementById('soutdirp').setAttribute('placeholder', await electron.getDefaultDownloadPath());
    document.getElementById('clearimporturlsbtn').addEventListener('click', () => { objCache.addVideoURLsList.value = ''; });
    document.getElementById('importurlsbtn').addEventListener('click', () => addVideoURLs());
    document.getElementById('clearimportfoldurlsbtn').addEventListener('click', () => { objCache.importURLsFoldList.value = ''; });
    document.getElementById('importfoldurlsbtn').addEventListener('click', () => importURLsFromFolder());
    objCache.downlStartBtn.addEventListener('click', () => startDownload());
    objCache.downlStopBtn.addEventListener('click', () => stopDownload());
    objCache.settingsModal.querySelector('#gsett-save').addEventListener('click', () => saveGlobalSettings());
    objCache.settingsModal.querySelector('#boutdir').addEventListener('click', e => selectOutputFolderDialog(e.currentTarget));
    objCache.settingsModal.querySelector('#ytdlptmpdir').addEventListener('click', e => selectOutputFolderDialog(e.currentTarget));
    objCache.settingsModal.querySelector('#cuschromepb').addEventListener('click', e => selectCustomBrowserDialog(e.currentTarget));
    objCache.settingsModal.querySelector('#shddownloader').addEventListener('change', e => toggleDownloaderSettingsUI(e.currentTarget.value));
    objCache.settingsModal.querySelector('#ologdir').addEventListener('click', e => electron.openLogFolder());
    electron.onDownloadProgress(updateDownloadProgress);
    electron.onDetailedDownloadProgress(updateDetailedDownloadInfo);
    electron.onDownloadSuccess(downloadSuccess);
    electron.onDownloadFail(downloadFail);

    objCache.settingsModal.querySelector('#delchdfold').addEventListener('click', e => {
        if (e.target.hasAttribute('disabled') || objCache.downloading !== null)
            return;

        toggleLoadingScr();
        electron.deleteUserdataFold();
        toggleLoadingScr();
    });

    toggleLoadingScr();
});

window.addEventListener('beforeunload', () => {
    electron.disableLog();
    electron.deleteUserdataFold();
});