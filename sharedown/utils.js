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

const SharedownMessage = (() => {
    return Object.freeze({
        EFFmpegNotFound: 'FFmpeg was not found on your system.\nSharedown requires FFmpeg to work, please install it.\n\nSharedown will now exit.',
        OpenFFmpegWiki: 'Open Sharedown Wiki for instructions on how to install FFmpeg?',
        EYTdlpNotFound: 'yt-dlp was not found on your system.\nSharedown requires yt-dlp to work, please install it.\n\nSharedown will now exit.',
        OpenYtdlpWiki: 'Open Sharedown Wiki for instructions on how to install YT-dlp?',
        EDownloadQueFromDisk: 'Unable to load download queue from disk',
        EImportAppState: 'Could not import app state from disk',
        EDownloadFail: 'Download failed',
        EInvalidURLsInAddList: 'Some URLs were invalid and they were skipped',
        EImportFromFolderCanceled: 'Import from folder canceled!',
        EInvalidID: 'Invalid video ID',
        EGeneric: 'Sharedown error',
        EJsonParse: 'JSON parse error',
    });
})();

const Utils = (() => {
    const _sharedownApi = window.sharedown;
    const util = {};

    util.getVideoData = async (globalSettingsModal, video, settings) => {//todo
        return ( await _sharedownApi.runPuppeteerGetVideoData(video, null, settings) );
    }

    util.getFolderURLsList = async (globalSettingsModal, foldersList, includeSubFolds, urlsSortType, settings) => {//todo
        return ( await _sharedownApi.runPuppeteerGetURLListFromFolder(foldersList, includeSubFolds, urlsSortType, settings) );
    }

    util.getOutputFolder = (globalFolder, videoFolder) => {
        if (globalFolder === '')
            globalFolder = sharedownApi.getDefaultOutputFolder();

        return videoFolder === '' ? globalFolder:videoFolder;
    }

    util.getOutputFileName = (videoTitle, videoSaveAs) => {
        return videoSaveAs === '' ? videoTitle : `${videoSaveAs}.mp4`;
    }

    util.showSelectOutputFolderDialog = elm => {
        const path = _sharedownApi.showSelectFolderDialog();

        if (path === undefined)
            return false;

        const inpt = elm.parentElement.querySelector('.outpath');

        inpt.value = path[0];
        inpt.setAttribute('title', path[0]);
    }

    util.showSelectCustomChromeDialog = elm => {
        const path = _sharedownApi.showSelectChromeBinDialog();

        if (path === undefined)
            return false;

        const inpt = elm.parentElement.querySelector('.binpath');

        inpt.value = path[0];
        inpt.setAttribute('title', path[0]);
    }

    util.isValidURL = url => {
        return url !== '' && url.includes('sharepoint') && url.substring(0, 8) === 'https://';
    }

    util.setAsWebPlayerURL = url => {
        const urlObj = new URL(url);

        if (urlObj.searchParams.get('web') === null)
            urlObj.searchParams.set('web', '1');

        return urlObj.href;
    }

    util.getYtdlpNVal = n => {
        return Math.min(Math.max(parseInt(n, 10), 1), 5);
    }

    Object.freeze(util);
    return util;
})();