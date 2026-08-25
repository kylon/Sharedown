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

const UIUtils = (() => {
    const _sharedownApi = window.sharedown;
    let _keepChromeOpenChkb;
    let _chromeUsrDataChkb;
    let _loginModuleInpt;
    let _keytarInpt;
    let _msIDInpt;
    let _globalSetModal;
    const UIutil = {};

    UIutil.init = (globalSetModal) => {
        _chromeUsrDataChkb = globalSetModal.querySelector('#chuserdata');
        _keepChromeOpenChkb = globalSetModal.querySelector('#keepbrowopen');
        _loginModuleInpt = globalSetModal.querySelector('#loginmodlist');
        _keytarInpt = globalSetModal.querySelector('#keytar');
        _msIDInpt = globalSetModal.querySelector('#username');
        _globalSetModal = globalSetModal;
    }

    UIutil.initLoginModuleSelect = () => {
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

    UIutil.addLoginModuleFields = () => {
        const container = _globalSetModal.querySelector('.logfieldscont');
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

    UIutil.fillLoginFieldsFromPwdManager = async (curLoginModule) => {
        const creds = await _sharedownApi.keytarGetLogin();
        const lmCreds = creds.lm;

        _msIDInpt.value = creds.msid ?? '';

        if (curLoginModule === '0' || lmCreds === null) {
            _sharedownApi.writeLog(`fillLoginFieldsFromPwdManager: no credentials found for module ${curLoginModule}, skip..`);
            return;
        }

        const loginModuleFieldsC = _sharedownApi.sharedownLoginModule.getFieldsCount();
        const pwdManLoginModule = lmCreds.pop();

        if (pwdManLoginModule !== curLoginModule) {
            return;

        } else if (loginModuleFieldsC !== lmCreds.length) {
            _sharedownApi.showMessage(messageBoxType.Error, SharedownMessage.EPwdManLoginModuleFormat, 'Sharedown');
            return;
        }

        for (let i=0; i<loginModuleFieldsC; ++i)
            _globalSetModal.querySelector(`#loginModuleField${i}`).value = lmCreds[i];
    }

    UIutil.disableAutoLoginOptionsForAny = (isChecked) => {
        if (isChecked) {
            if (_loginModuleInpt.value !== 0) {
                _loginModuleInpt.value = 0;
                _loginModuleInpt.dispatchEvent(new Event('change'));
            }

            _keytarInpt.checked = false;
            _msIDInpt.setAttribute('disabled', '');
            _loginModuleInpt.setAttribute('disabled', '');
            _keytarInpt.setAttribute('disabled', '');

        } else {
            _msIDInpt.removeAttribute('disabled');
            _loginModuleInpt.removeAttribute('disabled');
            _keytarInpt.removeAttribute('disabled');
        }
    }

    UIutil.disableAutoLoginOptionsForChromeUsrData = (isChecked) => {
        if (!_keepChromeOpenChkb.checked)
            UIutil.disableAutoLoginOptionsForAny(isChecked);
    }

    UIutil.disableAutoLoginOptionsForKeepChromeOpen = (isChecked) => {
        if (!_chromeUsrDataChkb.checked)
            UIutil.disableAutoLoginOptionsForAny(isChecked);
    }

    UIutil.keytarCheckChangeEvt = async (isChecked, curLoginModule) => {
        if (isChecked) {
            if (_chromeUsrDataChkb.checked) {
                _chromeUsrDataChkb.checked = false;
                _chromeUsrDataChkb.dispatchEvent(new Event('change'));
            }

            if (_keepChromeOpenChkb.checked) {
                _keepChromeOpenChkb.checked = false;
                _keepChromeOpenChkb.dispatchEvent(new Event('change'));
            }

            _chromeUsrDataChkb.setAttribute('disabled', '');
            _keepChromeOpenChkb.setAttribute('disabled', '');
            await UIutil.fillLoginFieldsFromPwdManager(curLoginModule);

        } else {
            _chromeUsrDataChkb.removeAttribute('disabled');
            _keepChromeOpenChkb.removeAttribute('disabled');
        }
    }

    Object.freeze(UIutil);
    return UIutil;
})();