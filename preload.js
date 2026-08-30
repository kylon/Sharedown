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

const {contextBridge, ipcRenderer} = require('electron');

ipcRenderer.on('getFolderListInFolder', (e, pageContent) => {
    try {
        const pre = new DOMParser().parseFromString(pageContent, 'text/html').body.getElementsByTagName('pre');

        if (pre.length === 0) {
            ipcRenderer.send('writeLog', `unexpected folder API result:\n${pageContent}`);
            ipcRenderer.send('folderListInFolder', []);
            return;
        }

        const xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');
        const ret = [];

        for (const entry of xmlDoc.querySelectorAll('entry')) {
            const foldName = entry.querySelector('content').getElementsByTagName('d:Name');

            if (foldName.length === 0) {
                ipcRenderer.send('writeLog', `no name found for folder item:\n${entry.innerHTML}`);
                continue;
            }

            ret.push(foldName[0].textContent);
        }

        ipcRenderer.send('folderListInFolder', ret);

    } catch (e) {
        ipcRenderer.send('writeLog', `get folder list error\n${e.message}`);
        ipcRenderer.send('folderListInFolder', []);
    }
});

ipcRenderer.on('getVideosInFold', (e, pageContent, urlOrigin) => {
    try {
        const pre = new DOMParser().parseFromString(pageContent, 'text/html').body.getElementsByTagName('pre');

        if (pre.length === 0) {
            ipcRenderer.send('writeLog', `unexpected files API result:\n${pageContent}`);
            ipcRenderer.send('videosInFold', null);
            return;
        }

        const xmlDoc = new DOMParser().parseFromString(pre[0].textContent, 'text/xml');
        const ret = [];

        for (const entry of xmlDoc.querySelectorAll('entry')) {
            const entryContent = entry.querySelector('content');
            const relUrlElm = entryContent.getElementsByTagName('d:ServerRelativeUrl');
            const timeCreatedElm = entryContent.getElementsByTagName('d:TimeCreated');
            const timeLastModfElm = entryContent.getElementsByTagName('d:TimeLastModified');
            let relUrl;

            if (relUrlElm.length === 0) {
                ipcRenderer.send('writeLog', `getVideosInFold: No URL for this entry:\n${entry.innerHTML}`);
                continue;
            }

            relUrl = relUrlElm[0].textContent;

            if (!relUrl.endsWith('.mp4')) {
                ipcRenderer.send('writeLog', `getVideosInFold: unhandled file format: ${relUrl}`);
                continue;
            }

            ret.push({
                url: `${urlOrigin}${relUrl}`,
                created: timeCreatedElm.length === 0 ? 0 : new Date(timeCreatedElm[0].textContent).getTime(),
                lastModf: timeLastModfElm.length === 0 ? 0 : new Date(timeLastModfElm[0].textContent).getTime()
            });
        }

        ipcRenderer.send('videosInFold', ret);

    } catch (e) {
        ipcRenderer.send('writeLog', `get video in folder error\n${e.message}`);
        ipcRenderer.send('videosInFold', null);
    }
});

ipcRenderer.on('getVideoDuration', (e, xml) => {
    try {
        const manifest = new DOMParser().parseFromString(xml, 'text/xml');
        const rawDuration = manifest.getElementsByTagName('MPD')[0].getAttribute('mediaPresentationDuration');

        ipcRenderer.send('videoDuration', rawDuration);

    } catch (e) {
        ipcRenderer.send('writeLog', `get video duration error\n${e.message}`);
        ipcRenderer.send('videoDuration', 0);
    }
});

contextBridge.exposeInMainWorld('sharedown', {
    showErrorMessage: msg => ipcRenderer.invoke('errorMessage', msg),
    quitApp: () => ipcRenderer.send('quit'),
    copyURLToClipboard: url => ipcRenderer.send('clipboard', url),
    deleteUserdataFold: () => ipcRenderer.send('rmUserdataDir'),
    openLogFolder: () => ipcRenderer.send('openLogsFolder'),
    hasFFmpeg: () => ipcRenderer.invoke('hasFfmpeg'),
    hasYTdlp: () => ipcRenderer.invoke('hasYtdlp'),
    enableLog: () => ipcRenderer.send('enableLog'),
    disableLog: () => ipcRenderer.send('disableLog'),
    writeLog: msg => ipcRenderer.send('writeLog', msg),
    setShowDlInfo: enable => ipcRenderer.send('setShowDlInfo', enable),
    selectFolderDialog: () => ipcRenderer.invoke('folderDialog'),
    selectCustomBrowserDialog: () => ipcRenderer.invoke('browserDialog'),
    saveAppSettings: data => ipcRenderer.send('writeAppSett', data),
    loadAppSettings: () => ipcRenderer.invoke('loadAppSett'),
    saveAppState: data => ipcRenderer.send('writeAppState', data),
    loadAppState: () => ipcRenderer.invoke('loadAppState'),
    getDefaultDownloadPath: () => ipcRenderer.invoke('defaultDownloadPath'),
    makeOutputDirectory: path => ipcRenderer.invoke('makeOutDir', path),
    getURLListFromFolder: (folderList, recursive, sortType, settings) => ipcRenderer.invoke('getUrlListFromFold', folderList, recursive, sortType, settings),
    getVideoData: (video, settings) => ipcRenderer.invoke('getVideoData', video, settings),
    getUniqueOutputFilePath: (outFolder, fileName) => ipcRenderer.invoke('getUniqueOutFilePath', outFolder, fileName),
    ffmpegDownload: (videoData, video, outFile) => ipcRenderer.invoke('ffmpegDownload', videoData, video, outFile),
    ytdlpDownload: (videoData, video, outFile, settings) => ipcRenderer.invoke('ytdlpDownload', videoData, video, outFile, settings),
    stopDownload: () => ipcRenderer.send('stopDownload'),

    onDownloadProgress: cb => ipcRenderer.on('downloadProg', (e, prog) => cb(prog)),
    onDetailedDownloadProgress: cb => ipcRenderer.on('detailedProg', (e, txt) => cb(txt)),
    onDownloadSuccess: cb => ipcRenderer.on('downloadSuccess', () => cb()),
    onDownloadFail: cb => ipcRenderer.on('downloadFail', (e, error) => cb(error)),
});
