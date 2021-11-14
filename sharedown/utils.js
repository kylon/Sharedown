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
        EInvalidURL: 'Invalid video URL',
        EInvalidID: 'Invalid video ID',
        EGeneric: 'Sharedown error',
        EJsonParse: 'JSON parse error',
        ELoginModule: 'Login Module Error'
    });
})();

const Utils = (() => {
    const _sharedownApi = window.sharedown;
    const util = {};

    function getLoginData(globalSettingsModal) {
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

    util.initLoginModuleSelect = () => {
        const mselect = document.getElementById('loginmodlist');
        const mlist = _sharedownApi.sharedownLoginModule.getModuleList;
        const frag = new DocumentFragment();
        let i = 0;

        for (const m of mlist) {
            const node = document.createElement('option');

            node.value = (i++).toString();
            node.text = m;

            frag.append(node);
        }

        mselect.appendChild(frag);
    }

    util.addLoginModuleFields = (globalSettingsModal) => {
        const container = globalSettingsModal.querySelector('.logfieldscont');
        const fields = _sharedownApi.sharedownLoginModule.getFields();

        container.innerHTML = '';

        if (!fields.length)
            return;

        const frag = new DocumentFragment();
        let i = 0;

        for (const inp of fields) {
            const col = document.createElement('div');
            const div = document.createElement('div');
            const label = document.createElement('label');
            const input = document.createElement('input');

            col.classList.add('col-12');
            div.classList.add('mb-3');
            label.classList.add('form-label');
            input.classList.add('form-control');

            label.textContent = inp.label;
            input.type = inp.type;
            input.id = 'loginModuleField' + (i++).toString();

            div.appendChild(label);
            div.appendChild(input);

            if (inp.desc !== '') {
                const desc = document.createElement('div');

                desc.classList.add('form-text');
                desc.textContent = inp.desc;
                div.appendChild(desc);
            }

            col.appendChild(div);
            frag.appendChild(col);
        }

        container.appendChild(frag);
    }

    util.getVideoData = async (globalSettingsModal, video, timeout, enableUserdataFold, isDirect) => {
        if (enableUserdataFold)
            return ( await _sharedownApi.runPuppeteerGetVideoData(video, null, timeout, true, isDirect) );

        const loginD = getLoginData(globalSettingsModal);

        if (loginD.hasOwnProperty('custom') && !Object.keys(loginD.custom).length) {
            const ret = _sharedownApi.showMessage(messageBoxType.Question, SharedownMessage.EEmptyCustomLoginField, SharedownMessage.ELoginModule);

            if (ret === 0) // ret: 0 - cancel button, 1 - ok
                return null;

            delete loginD.custom; // disable automatic login and proceed
        }

        return ( await _sharedownApi.runPuppeteerGetVideoData(video, loginD, timeout, false, isDirect) );
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
        return url.includes('sharepoint') && url.substring(0, 8) === 'https://';
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