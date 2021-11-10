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

const sharedownApi = window.sharedown;

const globalSettings = {
    _version: 7, // internal
    outputPath: '',
    downloader: 'yt-dlp',
    ytdlpN: 5,
    timeout: 30, // 30 secs, puppeteer default
    loginModule: 0,
    retryOnFail: false,
    userdataFold: false,
    autoSaveState: true,
    logging: false
};

const resources = {
    downQueObj: new downloadQue(),
    downloading: null,
    downloadingFPath: '',
    template: null,
    videoSettModal: null,
    videoSettModalInstance: null,
    videoSettModalSaveMsg: null,
    globalSetModal: null,
    globalSetDownldrOpts: null,
    globalSetModalSaveMsg: null,
    downlStartBtn: null,
    downlStopBtn: null,
    downQueElm: null,
    queLenElm: null,
    completeCElm: null,
    loadingScr: null
};

function initResources() {
    resources.template                = document.getElementById('videoitem').content;
    resources.videoSettModal          = document.getElementById('videosett');
    resources.videoSettModalInstance  = new bootstrap.Modal(resources.videoSettModal);
    resources.videoSettModalSaveMsg   = new timeoutMessage(resources.videoSettModal.querySelector('#save-succ-str'));
    resources.globalSetModal          = document.getElementById('sharedownsett');
    resources.globalSetDownldrOpts    = resources.globalSetModal.querySelectorAll('.downldr-opt');
    resources.globalSetModalSaveMsg   = new timeoutMessage(resources.globalSetModal.querySelector('#gsett-succ-str'));
    resources.downlStartBtn           = document.getElementById('start-dwnl');
    resources.downlStopBtn            = document.getElementById('stop-dwnl');
    resources.downQueElm              = document.getElementById('dque');
    resources.queLenElm               = document.getElementById('quelen');
    resources.completeCElm            = document.getElementById('completec');
    resources.loadingScr              = document.getElementById('loadingscr');
}

function toggleLoadingScr() {
    resources.loadingScr.classList.toggle('d-none');
}

function setDownloaderSettingsUI(selectedDownloader) {
    for (const opt of resources.globalSetDownldrOpts) {
        const clList = opt.classList;

        if (clList.contains(`${selectedDownloader}-opt`))
            clList.remove('d-none');
        else
            clList.add('d-none');
    }
}

function addVideoURL() {
    const btn = document.getElementById('addurlbtn');

    if (btn.classList.contains('btn-disabled'))
        return;

    const urlInpt = btn.parentElement.querySelector('#addurlinp');
    const url = urlInpt.value;

    if (url === '' || !Utils.isValidURL(url)) {
        if (url !== '')
            sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EInvalidURL, SharedownMessage.EGeneric);

        return;
    }

    toggleLoadingScr();

    const vid = new video(Utils.setAsWebPlayerURL(url));

    addVideoToUI(vid);
    resources.downQueObj.addVideo(vid);
    urlInpt.value = '';

    exportAppState();
    toggleLoadingScr();
}

function addVideoToUI(vid) {
    const node = resources.template.cloneNode(true);
    const span = node.querySelector('.progress').querySelector('span');
    const children = resources.downQueElm.children;
    let firstComplete = null;

    span.textContent = vid.url;
    span.setAttribute('title', vid.url);
    node.querySelector('.input-group').setAttribute('data-video-id', vid.id);
    node.querySelector('.deque-btn').addEventListener('click', e => removeVideoFromQue(e.currentTarget));
    node.querySelector('.vsett-btn').addEventListener('click', e => loadVideoSettings(e.currentTarget));
    node.querySelector('.copy-btn').addEventListener('click', e => sharedownApi.copyURLToClipboard(e.currentTarget.parentElement.querySelector('.progtext').textContent));

    for (const n of children) {
        if (!n.querySelector('.progress-bar').classList.contains('w-100'))
            continue;

        firstComplete = n;
        break;
    }

    if (firstComplete === null)
        resources.downQueElm.appendChild(node);
    else
        resources.downQueElm.insertBefore(node, firstComplete);

    resources.queLenElm.textContent = parseInt(resources.queLenElm.textContent, 10) + 1;
}

function removeVideoFromQue(removeBtn) {
    if (removeBtn.classList.contains('btn-disabled'))
        return;

    const parent = removeBtn.parentElement;
    const newQueLen = parseInt(resources.queLenElm.textContent, 10) - 1;

    toggleLoadingScr();

    if (parent.querySelector('.progress-bar').classList.contains('w-100')) {
        const newComplC = parseInt(resources.completeCElm.textContent, 10) - 1;

        resources.completeCElm.textContent = newComplC < 0 ? 0:newComplC;

    } else {
        resources.queLenElm.textContent = newQueLen < 0 ? 0:newQueLen;
    }

    resources.downQueObj.remove(parent.getAttribute('data-video-id'));
    parent.parentElement.remove();
    exportAppState();
    toggleLoadingScr();
}

function loadVideoSettings(elem) {
    if (elem.classList.contains('btn-disabled'))
        return;

    const videoId = elem.parentElement.getAttribute('data-video-id');
    const video = resources.downQueObj.getByID(videoId);

    if (video === null) {
        sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EInvalidID, SharedownMessage.EGeneric);
        return false;
    }

    toggleLoadingScr();

    const saveas = resources.videoSettModal.querySelector('#saveas');
    const outdir = resources.videoSettModal.querySelector('#voutdirp');

    saveas.value = video.settings.saveas;
    outdir.value = video.settings.outputPath;

    saveas.setAttribute('title', video.settings.saveas);
    outdir.setAttribute('title', video.settings.outputPath);
    resources.videoSettModal.querySelector('#save-sett').setAttribute('data-video-id', videoId);
    resources.videoSettModalSaveMsg.reset();
    toggleLoadingScr();

    resources.videoSettModalInstance.show();
}

function saveVideoSettings(elem) {
    const video = resources.downQueObj.getByID(elem.getAttribute('data-video-id'));

    if (video === null) {
        sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EInvalidID, SharedownMessage.EGeneric);
        return false;
    }

    toggleLoadingScr();
    video.settings.saveas = resources.videoSettModal.querySelector('#saveas').value;
    video.settings.outputPath = resources.videoSettModal.querySelector('#voutdirp').value;
    exportAppState();
    toggleLoadingScr();
    resources.videoSettModalSaveMsg.show();
}

function loadGlobalSettings() {
    toggleLoadingScr();

    const outdir = resources.globalSetModal.querySelector('#soutdirp');
    const loginModuleInpt = resources.globalSetModal.querySelector('#loginmodlist');

    if (!globalSettings.userdataFold) {
        sharedownApi.sharedownLoginModule.setModule(globalSettings.loginModule);
        loginModuleInpt.value = globalSettings.loginModule;

    } else {
        sharedownApi.sharedownLoginModule.setModule(0);
        loginModuleInpt.setAttribute('disabled', '');
        resources.globalSetModal.querySelector('#username').setAttribute('disabled', '');
    }

    Utils.addLoginModuleFields(resources.globalSetModal);
    outdir.setAttribute('title', globalSettings.outputPath);

    outdir.value = globalSettings.outputPath;
    resources.globalSetModal.querySelector('#shddownloader').value = globalSettings.downloader;
    resources.globalSetModal.querySelector('#ytdlpn').value = globalSettings.ytdlpN;
    resources.globalSetModal.querySelector('#chuserdata').checked = globalSettings.userdataFold;
    resources.globalSetModal.querySelector('#autosavestate').checked = globalSettings.autoSaveState;
    resources.globalSetModal.querySelector('#ppttmout').value = globalSettings.timeout;
    resources.globalSetModal.querySelector('#shlogs').value = globalSettings.logging ? '1':'0';
    resources.globalSetModal.querySelector('#retryonfail').checked = globalSettings.retryOnFail;

    setDownloaderSettingsUI(globalSettings.downloader);
    toggleLoadingScr();
}

function saveGlobalSettings() {
    toggleLoadingScr();
    const timeout = parseInt(resources.globalSetModal.querySelector('#ppttmout').value, 10);

    globalSettings.outputPath = resources.globalSetModal.querySelector('#soutdirp').value;
    globalSettings.userdataFold = resources.globalSetModal.querySelector('#chuserdata').checked;
    globalSettings.autoSaveState = resources.globalSetModal.querySelector('#autosavestate').checked;
    globalSettings.loginModule = resources.globalSetModal.querySelector('#loginmodlist').value;
    globalSettings.retryOnFail = resources.globalSetModal.querySelector('#retryonfail').checked;
    globalSettings.downloader = resources.globalSetModal.querySelector('#shddownloader').value;
    globalSettings.ytdlpN = Utils.getYtdlpNVal(resources.globalSetModal.querySelector('#ytdlpn').value);
    globalSettings.timeout = isNaN(timeout) || timeout < 0 ? 30 : timeout;
    globalSettings.logging = resources.globalSetModal.querySelector('#shlogs').value === '1';

    exportAppSettings();
    toggleLoadingScr();
    resources.globalSetModalSaveMsg.show();
}

function exportAppSettings() {
    sharedownApi.saveAppSettings(JSON.stringify(globalSettings));
}

function importAppSettings() {
    const sett = sharedownApi.loadAppSettings();

    if (sett === '')
        return;

    const data = JSON.parse(sett);

    globalSettings.outputPath = data.outputPath ?? '';
    globalSettings.userdataFold = data.userdataFold ?? false;
    globalSettings.autoSaveState = data.autoSaveState ?? true;
    globalSettings.loginModule = data.loginModule ?? 0;
    globalSettings.retryOnFail = data.retryOnFail ?? false;
    globalSettings.downloader = data.downloader ?? 'yt-dlp';
    globalSettings.ytdlpN = Utils.getYtdlpNVal(data.ytdlpN ?? 5);
    globalSettings.timeout = data.timeout ?? 30000;
    globalSettings.logging = data.logging ?? false;

    if (data['_version'] < globalSettings['_version']) {
        sharedownApi.upgradeSett(data['_version']);
        exportAppSettings(); // update settings version
    }
}

function exportAppState(force = false) {
    if (!globalSettings.autoSaveState && !force)
        return;

    const data = {
        downque: resources.downQueObj.exportDownloadQue(),
        downloading: JSON.stringify(resources.downloading)
    }

    return sharedownApi.saveAppState(JSON.stringify(data));
}

function importAppState() {
    const json = sharedownApi.loadAppState();

    if (json === '')
        return;

    try {
        const data = JSON.parse(json);

        data['downque'].push(data['downloading'])

        const ret = resources.downQueObj.importDownloadQue(data['downque']);
        if (!ret)
            sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EDownloadQueFromDisk, SharedownMessage.EJsonParse);

        const videoList = resources.downQueObj.getQue();
        for (const v of videoList)
            addVideoToUI(v);

    } catch (e) {
        sharedownApi.showMessage(messageBoxType.Error, `${SharedownMessage.EImportAppState}\n\n${e.message}`, SharedownMessage.EJsonParse)
    }
}

async function downloadVideo() {
    return new Promise(async (res, rej) => {
        const curSettings = Object.assign({}, globalSettings);
        const videoElem = document.querySelector(`[data-video-id="${resources.downloading.id}"]`);
        const outputFolder = Utils.getOutputFolder(curSettings.outputPath, resources.downloading.settings.outputPath);
        let vdata;
        let ret;

        videoElem.querySelector('.vsett-btn').classList.add('btn-disabled');
        videoElem.querySelector('.deque-btn').classList.add('btn-disabled');

        ret = sharedownApi.makeOutputDirectory(outputFolder);
        if (!ret)
            return rej();

        toggleLoadingScr();
        sharedownApi.setLogging(globalSettings.logging);
        vdata = await Utils.getVideoManifestAndTitle(resources.globalSetModal, resources.downloading, globalSettings.timeout, globalSettings.userdataFold);
        toggleLoadingScr();

        if (!vdata)
            return rej();

        if (vdata.t === '') // unnamed video ??, give it a name and try to download
            vdata.t = 'sharedownVideo' + sharedownApi.md5sum(Date.now().toString().substring(5));

        // generate output file path (apply user settings, if any)
        resources.downloadingFPath = sharedownApi.getNormalizedUniqueOutputFilePath(outputFolder, Utils.getOutputFileName(vdata.t, resources.downloading.settings.saveas));

        if (curSettings.downloader === 'ffmpeg')
            ret = await sharedownApi.downloadWithFFmpeg(vdata, resources.downloading, resources.downloadingFPath);
        else
            ret = sharedownApi.downloadWithYtdlp(vdata, resources.downloading, resources.downloadingFPath, curSettings);

        return !ret ? rej() : res();
    });
}

async function startDownload() {
    if (resources.downlStartBtn.classList.contains('btn-disabled') || !resources.downQueObj.hasNext())
        return;

    resources.downloading = resources.downQueObj.getNext();

    downloadVideo().then(() => {
        resources.downlStartBtn.classList.add('btn-disabled');
        resources.downlStopBtn.classList.remove('btn-disabled');
        resources.globalSetModal.querySelector('#delchdfold').setAttribute('disabled', '');
        resources.globalSetModal.querySelector('#mexportstate').setAttribute('disabled', '');
        resources.globalSetModal.querySelector('#downlrun-setalr').classList.remove('d-none');

    }).catch(() => {
        const elem = document.querySelector('[data-video-id="'+resources.downloading.id+'"]');

        elem.querySelector('.vsett-btn').classList.remove('btn-disabled');
        elem.querySelector('.deque-btn').classList.remove('btn-disabled');
        resources.downQueObj.reinsert(resources.downloading); // add back video to que

        resources.downloading = null;
    });
}

function stopDownload() {
    if (resources.downlStopBtn.classList.contains('btn-disabled'))
        return;

    toggleLoadingScr();
    const videoElem = document.querySelector(`[data-video-id="${resources.downloading.id}"]`);

    sharedownApi.stopDownload();

    resources.downlStopBtn.classList.add('btn-disabled');
    resources.downlStartBtn.classList.remove('btn-disabled');
    resources.globalSetModal.querySelector('#downlrun-setalr').classList.add('d-none');
    resources.globalSetModal.querySelector('#delchdfold').removeAttribute('disabled');
    resources.globalSetModal.querySelector('#mexportstate').removeAttribute('disabled');
    videoElem.querySelector('.vsett-btn').classList.remove('btn-disabled');
    videoElem.querySelector('.deque-btn').classList.remove('btn-disabled');
    resources.downQueObj.reinsert(resources.downloading); // add back video to que

    resources.downloading = null;
    videoElem.querySelector('.progress-bar').style.width = '0%';

    toggleLoadingScr();
}

window.addEventListener('DOMContentLoaded', async () => {
    initResources();

    toggleLoadingScr();

    sharedownApi.deleteUserdataFold(); // if for some reasons the quit event failed, delete it now

    if (!sharedownApi.hasFFmpeg()) {
        sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EFFmpegNotFound, SharedownMessage.EGeneric);

        const ret = sharedownApi.showMessage(messageBoxType.Question, SharedownMessage.OpenFFmpegWiki, SharedownMessage.EGeneric);
        if (ret === 1)
            sharedownApi.openLink('https://github.com/kylon/Sharedown/wiki/How-to-install-FFmpeg');

        sharedownApi.quitApp();
    }

    if (!sharedownApi.hasYTdlp()) {
        sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EYTdlpNotFound, SharedownMessage.EGeneric);

        const ret = sharedownApi.showMessage(messageBoxType.Question, SharedownMessage.OpenYtdlpWiki, SharedownMessage.EGeneric);
        if (ret === 1)
            sharedownApi.openLink('https://github.com/kylon/Sharedown/wiki/How-to-install-YTdlp');

        sharedownApi.quitApp();
    }

    Utils.initLoginModuleSelect();
    importAppSettings();
    importAppState();
    loadGlobalSettings();

    document.getElementById('addurlbtn').addEventListener('click', () => addVideoURL());
    resources.videoSettModal.querySelector('#save-sett').addEventListener('click', e => saveVideoSettings(e.currentTarget));
    resources.videoSettModal.querySelector('#voutdirinp').addEventListener('click', e => Utils.showSelectOutputFolderDialog(e.currentTarget));
    resources.downlStartBtn.addEventListener('click', () => startDownload());
    resources.downlStopBtn.addEventListener('click', () => stopDownload());
    resources.globalSetModal.querySelector('#gsett-save').addEventListener('click', () => saveGlobalSettings());
    resources.globalSetModal.querySelector('#soutdirinp').addEventListener('click', e => Utils.showSelectOutputFolderDialog(e.currentTarget));
    resources.globalSetModal.querySelector('#shddownloader').addEventListener('change', e => setDownloaderSettingsUI(e.currentTarget.value));

    document.getElementById('loginmodlist').addEventListener('change', e => {
        const v = e.currentTarget.value;

        globalSettings.loginModule = v;
        sharedownApi.sharedownLoginModule.setModule(v);
        Utils.addLoginModuleFields(resources.globalSetModal);
    });

    resources.globalSetModal.querySelector('#mexportstate').addEventListener('click', e => {
        if (e.target.hasAttribute('disabled'))
            return;

        toggleLoadingScr();

        if (exportAppState(true))
            resources.globalSetModalSaveMsg.show();

        toggleLoadingScr();
    });

    resources.globalSetModal.querySelector('#chuserdata').addEventListener('change', e => {
        const msidInpt = resources.globalSetModal.querySelector('#username');
        const loginModuleInpt = resources.globalSetModal.querySelector('#loginmodlist');

        if (e.target.checked) {
            msidInpt.setAttribute('disabled', '');

            loginModuleInpt.value = 0;
            loginModuleInpt.dispatchEvent(new Event('change'));
            loginModuleInpt.setAttribute('disabled', '');

        } else {
            msidInpt.removeAttribute('disabled');
            loginModuleInpt.removeAttribute('disabled');
        }
    });

    resources.globalSetModal.querySelector('#delchdfold').addEventListener('click', e => {
        if (e.target.hasAttribute('disabled') || resources.downloading !== null)
            return;

        toggleLoadingScr();
        sharedownApi.deleteUserdataFold();
        toggleLoadingScr();
    });

    toggleLoadingScr();
});

window.addEventListener('DownloadFail', (e) => {
    if (globalSettings.retryOnFail) {
        const videoElem = document.querySelector(`[data-video-id="${resources.downloading.id}"]`);

        resources.downlStartBtn.classList.remove('btn-disabled');
        resources.downlStopBtn.classList.add('btn-disabled');
        resources.globalSetModal.querySelector('#downlrun-setalr').classList.add('d-none');
        resources.downQueObj.reinsert(resources.downloading); // add back video to que
        videoElem.querySelector('.progress-bar').style.width = '0%';
        resources.downloading = null;

        startDownload();

    } else {
        stopDownload();
        sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EDownloadFail + '\n\n' + e.detail, SharedownMessage.EGeneric);
    }
});

window.addEventListener('DownloadSuccess', () => {
    const videoElm = document.querySelector('[data-video-id="'+resources.downloading.id+'"]');
    const newQueLen = parseInt(resources.queLenElm.textContent, 10) - 1;

    resources.downlStartBtn.classList.remove('btn-disabled');
    resources.downlStopBtn.classList.add('btn-disabled');
    resources.globalSetModal.querySelector('#downlrun-setalr').classList.add('d-none');
    videoElm.querySelector('.deque-btn').classList.remove('btn-disabled');
    videoElm.querySelector('.progress-bar').classList.add('w-100');
    resources.downQueElm.appendChild(videoElm.parentElement);
    resources.completeCElm.textContent = parseInt(resources.completeCElm.textContent, 10) + 1;
    resources.queLenElm.textContent = newQueLen < 0 ? 0:newQueLen;
    resources.downloading = null;

    exportAppState(true);
    startDownload(); // start next download, if any
});

window.addEventListener('beforeunload', () => {
    sharedownApi.deleteUserdataFold();
});

window.addEventListener('appmenu', (e) => {
    switch (e.detail.cmd) {
        case 'odlfold':
            sharedownApi.openFolder(Utils.getOutputFolder(globalSettings.outputPath, ''));
            break;
        case 'ologsfold':
            sharedownApi.openLogsFolder();
            break;
        case 'owiki':
            sharedownApi.openLink('https://github.com/kylon/Sharedown/wiki');
            break;
        case 'osrc':
            sharedownApi.openLink('https://github.com/kylon/Sharedown');
            break;
        default:
            break;
    }
});