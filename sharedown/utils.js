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

const Utils = (() => {
    const _sharedownApi = window.sharedown;
    const util = {};

    util.getVideoData = async (globalSettingsModal, video, settings) => {//todo
        return ( await _sharedownApi.SharedownAPI.runPuppeteerGetVideoData(video, null, settings) );
    }

    util.getFolderURLsList = async (globalSettingsModal, foldersList, includeSubFolds, urlsSortType, settings) => {//todo
        return ( await _sharedownApi.SharedownAPI.runPuppeteerGetURLListFromFolder(foldersList, includeSubFolds, urlsSortType, settings) );
    }

    util.getOutputFolder = (globalFolder, videoFolder) => {
        if (globalFolder === '')
            globalFolder = _sharedownApi.SharedownAPI.getDefaultOutputFolder();

        return videoFolder === '' ? globalFolder:videoFolder;
    }

    util.getOutputFileName = (videoTitle, videoSaveAs) => {
        return videoSaveAs === '' ? videoTitle : `${videoSaveAs}.mp4`;
    }

    util.showSelectOutputFolderDialog = elm => {
        const path = _sharedownApi.SharedownAPI.showSelectFolderDialog();

        if (path === undefined)
            return false;

        const inpt = elm.parentElement.querySelector('.outpath');

        inpt.value = path[0];
        inpt.setAttribute('title', path[0]);
    }

    util.showSelectCustomChromeDialog = elm => {
        const path = _sharedownApi.SharedownAPI.showSelectChromeBinDialog();

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