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
        EEmptyCustomLoginField: 'A required login field is empty!\nAutomatic login will be disabled.\n\nDo you want to continue?',
        EImportAppState: 'Could not import app state from disk',
        EDownloadFail: 'Download failed',
        EInvalidURLsInAddList: 'Some URLs were invalid and they were skipped',
        EImportFromFolderCanceled: 'Import from folder canceled!',
        EInvalidID: 'Invalid video ID',
        EGeneric: 'Sharedown error',
        EJsonParse: 'JSON parse error',
        ELoginModule: 'Login Module Error',
        EPwdManLoginModuleFormat: 'Invalid credential format for login module!\n\nPlease, delete your credentials and save them again.'
    });
})();

const Utils = (() => {
    const _sharedownApi = window.sharedown;
    const util = {};

    function _getLoginData(globalSettingsModal) {
        const customFieldsLen = _sharedownApi.sharedownLoginModule.getFields()?.length;
        const loginData = {
            msid: globalSettingsModal.querySelector('#username').value
        };

        if (!customFieldsLen) // login module has no fields or not set
            return loginData;

        loginData.custom = {}; // add custom field

        for (let i=0; i<customFieldsLen; ++i) {
            const val = globalSettingsModal.querySelector('#loginModuleField'+i).value;

            if (val === '') {
                loginData.custom = {};
                break;
            }

            loginData.custom["field"+i] = val;
        }

        return loginData;
    }

    function _isValidCustomLogin(loginData) {
        if (loginData.hasOwnProperty('custom') && !Object.keys(loginData.custom).length) {
            const ret = _sharedownApi.showMessage(messageBoxType.Question, SharedownMessage.EEmptyCustomLoginField, SharedownMessage.ELoginModule);

            if (ret === 0) // ret: 0 - cancel button, 1 - ok
                return false;

            delete loginData.custom; // disable automatic login and proceed
        }

        return true;
    }

    util.keytarSaveCredentials = async (globalSettingsModal, loginModule) => {
        const loginModuleVals = [];

        for (let i=0,l=_sharedownApi.sharedownLoginModule.getFieldsCount(); i<l; ++i)
            loginModuleVals.push(globalSettingsModal.querySelector(`#loginModuleField${i}`).value);

        loginModuleVals.push(loginModule);

        await _sharedownApi.keytarSaveLogin({
            msid: globalSettingsModal.querySelector('#username').value,
            lm: loginModuleVals.length > 1 ? loginModuleVals.join(':') : ''
        });
    }

    util.keytarDeleteCredentials = async () => {
        await _sharedownApi.keytarRemoveLogin();
    }

    util.getVideoData = async (globalSettingsModal, video, timeout, enableUserdataFold, isDirect) => {
        if (enableUserdataFold)
            return ( await _sharedownApi.runPuppeteerGetVideoData(video, null, timeout, true, isDirect) );

        const loginD = _getLoginData(globalSettingsModal);

        if (!_isValidCustomLogin(loginD))
            return null;

        return ( await _sharedownApi.runPuppeteerGetVideoData(video, loginD, timeout, false, isDirect) );
    }

    util.getFolderURLsList = async (globalSettingsModal, folderURL, includeSubFolds, timeout, enableUserdataFold) => {
        if (enableUserdataFold)
            return ( await _sharedownApi.runPuppeteerGetURLListFromFolder(folderURL, includeSubFolds, null, timeout, true) );

        const loginD = _getLoginData(globalSettingsModal);

        if (!_isValidCustomLogin(loginD))
            return null;

        return ( await _sharedownApi.runPuppeteerGetURLListFromFolder(folderURL, includeSubFolds, loginD, timeout, false) );
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