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
const {ipcRenderer} = require('electron');
const SHDMainCMD = require('./sharedown/enums/shdMainCMD');

function sendMainIPC(obj) {
    return ipcRenderer.sendSync('shdipcmain', obj);
}

function showMessage(msgType, msg) {
    return sendMainIPC({
        cmd: SHDMainCMD.MessageBox,
        type: msgType,
        content: msg
    });
}

module.exports = {
    sendMainIPC,
    showMessage
};
